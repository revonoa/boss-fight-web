(() => {
 const DIFFS = {
  // 쉬움: 회피 반경 ↓, 그레이스 ↑, 쿨다운 ↑, 슬라이드 이동
  easy: {
    base: 60, phaseBoost: 10,
    dodgeCooldown: 700, graceMs: 1800,
    stun1: 0.05, stun2: 0.12, stun3: 0.20,
    cloneMax: 1, fakeProb: 0.15,
    rampStart: 0.15, rampSec: 12000,  // 천천히 어려워짐
    slideMs: 200,                     // 순간이동 대신 부드럽게 이동
    maxDodgesInWindow: 3, dodgeWindowMs: 2000, // 2초에 최대 3회 회피
    safeHoverMs: 500                  // 마우스가 거의 안 움직이면 회피 금지
  },

  // 보통: 확실히 쉬워짐
  normal: {
    base: 90, phaseBoost: 18,
    dodgeCooldown: 420, graceMs: 1200,
    stun1: 0.18, stun2: 0.30, stun3: 0.48,
    cloneMax: 2, fakeProb: 0.25,
    rampStart: 0.25, rampSec: 10000,
    slideMs: 140,
    maxDodgesInWindow: 4, dodgeWindowMs: 2000,
    safeHoverMs: 450
  },

  // 어려움: 기존 난이도 느낌 유지
  hard: {
    base: 130, phaseBoost: 30,
    dodgeCooldown: 180, graceMs: 700,
    stun1: 0.30, stun2: 0.50, stun3: 0.70,
    cloneMax: 5, fakeProb: 0.50,
    rampStart: 0.40, rampSec: 8000,
    slideMs: 0,             // 하드는 텔레포트 유지
    maxDodgesInWindow: 999, dodgeWindowMs: 1000,
    safeHoverMs: 0
  }
};

    const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Socket
  const socket = io();
  socket.on('stats:viewers', (n) => { const el = $('#viewers'); if (el) el.textContent = `👀 ${n}`; });
  socket.on('scoreboard', (rows=[]) => {
    const ul = $('#board'); if (!ul) return;
    ul.innerHTML = rows.map((r,i)=>`<li>${i+1}. <b>${escapeHtml(r.name)}</b> — ${(r.ms/1000).toFixed(3)}s</li>`).join('') || '<li>아직 기록 없음</li>';
  });

  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

  // Game State
  const MaxHP = 100;
  const state = {
    hp: MaxHP,
    started: false,
    finished: false,
    startAt: 0,
    timerId: null,
    phase: 1,
    arenaRect: null,
    realBtn: '#agreeBtn',
    stunUntil: 0,
    cfg: DIFFS.normal, 
    graceUntil: 0,
    lastDodge: 0,
    cfg: DIFFS.normal,
graceUntil: 0,
lastDodgeAt: 0,
lastMoves: [],
lastMouse: { x: 0, y: 0, t: 0 },
stillSince: 0
  };

  // Elements
  const hpEl = $('#hp');
  const agreeBtn = $('#agreeBtn');
  const arena = $('#arena');
  const overlay = $('#overlay');
  const phaseEl = $('#phase');
  const timerEl = $('#timer');

  // Controls
  $('#startBtn')?.addEventListener('click', start);
  //$('#resetBtn')?.addEventListener('click', reset); 
  const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[reset] clicked');
    doReset(); // 👈 새 함수
  });
} else {
  console.warn('[reset] #resetBtn not found');
}
  agreeBtn?.addEventListener('click', onHit);
  arena?.addEventListener('mousemove', onMove);

  function start(){
  if (state.started) return;

  const sel = document.getElementById('difficulty');
  const level = (sel?.value || 'normal');
  state.cfg = DIFFS[level] || DIFFS.normal;

  state.started = true; state.finished = false;
  state.hp = MaxHP; state.phase = 1;
  state.startAt = Date.now();
  state.graceUntil = state.startAt + state.cfg.graceMs;
  state.lastDodgeAt = 0; state.lastMoves = [];
  state.lastMouse = { x: 0, y: 0, t: Date.now() };
  state.stillSince = 0;

  // 슬라이드 이동(쉬움/보통)
  const ms = state.cfg.slideMs || 0;
  agreeBtn.style.transition = ms ? `left ${ms}ms ease, top ${ms}ms ease` : '';

  if (hpEl) hpEl.style.width = '100%';
  updatePhase();
  state.timerId = setInterval(()=> setTimer(Date.now() - state.startAt), 30);
}


  function doReset(){
  state.started = false; state.finished = false;
  state.hp = MaxHP; state.phase = 1;
  state.stunUntil = 0; state.lastDodgeAt = 0;
  state.lastMoves = []; state.stillSince = 0;
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  setTimer(0);
  if (hpEl) hpEl.style.width = '100%';
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  $$('.clone').forEach(n=>n.remove());
  requestAnimationFrame(()=> placeButton(0.5, 0.5));
}


  function setTimer(ms){ if (!timerEl) return; const s = (ms/1000).toFixed(3).padStart(7, '0'); timerEl.textContent = s; }

  function updatePhase(){
    const hp = state.hp;
    let p = 1;
    if (hp <= 40) p = 3; else if (hp <= 70) p = 2; else p = 1;
    state.phase = p;
    if (phaseEl) phaseEl.textContent = `Phase ${p}`;
  }

  function onHit(e){
    if (!state.started || state.finished) return;

    // 진짜 버튼만 유효 (3페이즈엔 가짜 등장)
    if (state.phase >= 3 && e?.target && !e.target.matches(state.realBtn)) {
      punishFake();
      return;
    }

    // 피격 판정: 스턴 중엔 큰 데미지
    const now = Date.now();
    const base = (now < state.stunUntil) ? 6 : 3;
    damage(base);
  }

  function damage(n){
    state.hp = Math.max(0, state.hp - n);
    const ratio = state.hp / MaxHP;
    if (hpEl) hpEl.style.width = `${Math.max(0, ratio*100)}%`;
    arena?.classList.add('shake'); setTimeout(()=> arena?.classList.remove('shake'), 240);
    updatePhase();
    patternTick();
    if (state.hp <= 0) return win();
  }

  function win(){
    state.finished = true; state.started = false;
    clearInterval(state.timerId); state.timerId = null;
    const ms = Date.now() - state.startAt;
    setTimer(ms);
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.innerHTML = `<div class="panel" style="text-align:center">
        <h2>승리! 🎉</h2>
        <p>기록: <b>${(ms/1000).toFixed(3)}s</b></p>
        <p><input id="nameInput" placeholder="이름" style="padding:8px;border-radius:8px;border:1px solid #334;"/></p>
        <p><button id="saveScore" class="start">기록 저장</button></p>
        <p><button id="closeOverlay" class="ghost">닫기</button></p>
      </div>`;
      $('#saveScore')?.addEventListener('click', ()=>{
        const name = $('#nameInput')?.value || '';
        socket.emit('score:submit', { name, ms });
        closeOverlay();
      });
      $('#closeOverlay')?.addEventListener('click', closeOverlay);
    }
  }

  function closeOverlay(){ overlay?.classList.add('hidden'); overlay.innerHTML=''; }

  // === 패턴 시스템 ===
  function patternTick(){
  const p = state.phase, cfg = state.cfg;
  if (p === 1) {
    if (Math.random() < cfg.stun1) doStun(500);
  } else if (p === 2) {
    if (Math.random() < cfg.stun2) doStun(700);
    if (Math.random() < cfg.fakeProb) fakePopup();
  } else {
    if ($$('.clone').length < cfg.cloneMax) spawnClone();
    if (Math.random() < cfg.stun3) doStun(900);
    if (Math.random() < cfg.fakeProb) fakePopup();
  }
}


  function doStun(ms){ state.stunUntil = Date.now() + ms; }

  function fakePopup(){
    if (!overlay) return;
    overlay.classList.remove('hidden');
    const m = document.createElement('div');
    m.className = 'panel';
    m.style.maxWidth = '320px';
    m.innerHTML = `<h4>시스템 경고</h4><p>의심스러운 활동이 감지되었습니다.</p><button id="ok${Date.now()}" class="start">확인</button>`;
    overlay.innerHTML = ''; overlay.appendChild(m);
    const btn = m.querySelector('button');
    btn?.addEventListener('click', ()=> overlay.classList.add('hidden'));
    // 2초 후 자동 사라짐
    setTimeout(()=> overlay.classList.add('hidden'), 2000);
  }

  function spawnClone(){
  if (!arena) return;
  const c = document.createElement('button');
  c.className = 'clone';
  c.textContent = ['승인','동의','확인'][Math.floor(Math.random()*3)];
  const pos = randPos();
  c.style.left = pos.x + 'px'; c.style.top = pos.y + 'px';
  c.addEventListener('click', (e)=>{ e.stopPropagation(); punishFake(); });
  arena.appendChild(c);

  if (Math.random() < 0.3) { state.realBtn = '.clone'; setTimeout(()=>{ state.realBtn = '#agreeBtn'; }, 1500); }
  setTimeout(()=> c.remove(), 6000);
}


  function punishFake(){
    // 페널티: HP 회복 + 화면 흔들기 + 버튼 더 빠짐
    state.hp = Math.min(MaxHP, state.hp + 3);
    const ratio = state.hp / MaxHP;
    if (hpEl) hpEl.style.width = `${Math.max(0, ratio*100)}%`;
    arena?.classList.add('shake'); setTimeout(()=> arena?.classList.remove('shake'), 280);
  }

  // === 이동 패턴 ===
  function onMove(e){
  if (!state.started || state.finished) return;
  if (!arena || !agreeBtn) return;

  state.arenaRect = arena.getBoundingClientRect();
  const now = Date.now();
  const cfg = state.cfg;

  // 1) 그레이스 기간: 회피 안 함
  if (now < state.graceUntil) return;

  // 2) 회피 쿨다운
  if (now - state.lastDodgeAt < cfg.dodgeCooldown) return;

  // 3) 마우스 속도 기반: 거의 정지 상태면 보호
  const mouse = { x: e.clientX, y: e.clientY };
  const dt = now - state.lastMouse.t;
  const speed = dt > 0 ? Math.hypot(mouse.x - state.lastMouse.x, mouse.y - state.lastMouse.y) / dt : 0; // px/ms
  state.lastMouse = { x: mouse.x, y: mouse.y, t: now };
  if (cfg.safeHoverMs) {
    if (speed < 0.2) {
      if (!state.stillSince) state.stillSince = now;
      if (now - state.stillSince >= cfg.safeHoverMs) return;
    } else {
      state.stillSince = 0;
    }
  }

  // 거리 계산
  const btnRect = agreeBtn.getBoundingClientRect();
  const btnCenter = { x: btnRect.left + btnRect.width/2, y: btnRect.top + btnRect.height/2 };
  const dist = Math.hypot(mouse.x - btnCenter.x, mouse.y - btnCenter.y);

  // 4) 램핑: 일정 시간 동안 회피 반경이 점진적으로 커짐
  const elapsed = now - state.startAt;
  const ramp = Math.max(cfg.rampStart, Math.min(1, elapsed / cfg.rampSec));
  const threshold = (cfg.base + state.phase * cfg.phaseBoost) * ramp;

  if (now < state.stunUntil) return; // 스턴 중엔 회피 X

  if (dist < threshold) {
    // 5) 회피 빈도 제한: 최근 N초 내 회피 횟수 제한
    state.lastMoves = state.lastMoves.filter(t => now - t < cfg.dodgeWindowMs);
    if (state.lastMoves.length >= (cfg.maxDodgesInWindow || 999)) return;

    const p = randPos();
    agreeBtn.style.left = p.x + 'px';
    agreeBtn.style.top  = p.y + 'px';

    state.lastDodgeAt = now;
    state.lastMoves.push(now);
  }
}



  function randPos(){
    const rect = state.arenaRect || arena.getBoundingClientRect();
    const pad = 30; // 경계 padding
    const x = Math.floor(Math.random() * (rect.width  - 160 - pad*2)) + pad;
    const y = Math.floor(Math.random() * (rect.height - 80  - pad*2)) + pad + 40; // HP바 아래
    return { x, y };
  }

  function placeButton(nx, ny){ // 0..1 비율 위치
    const rect = arena.getBoundingClientRect();
    const x = Math.floor(rect.width*nx) - 60;
    const y = Math.floor(rect.height*ny) - 20;
    agreeBtn.style.left = x + 'px';
    agreeBtn.style.top  = y + 'px';
  }

  // 초기화
  placeButton(0.5, 0.55);
})();