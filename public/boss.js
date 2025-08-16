(() => {
 const DIFFS = {
    easy:   { base: 90,  phaseBoost: 18, dodgeCooldown: 600, graceMs: 1800, stun1: 0.10, stun2: 0.20, stun3: 0.35, cloneMax: 1, fakeProb: 0.20 },
    normal: { base: 140, phaseBoost: 30, dodgeCooldown: 280, graceMs: 900,  stun1: 0.25, stun2: 0.40, stun3: 0.50, cloneMax: 3, fakeProb: 0.35 },
    hard:   { base: 170, phaseBoost: 36, dodgeCooldown: 180, graceMs: 600,  stun1: 0.35, stun2: 0.55, stun3: 0.70, cloneMax: 5, fakeProb: 0.50 }
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
    lastDodge: 0
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

    state.started = true; state.finished = false; state.hp = MaxHP;
    state.startAt = Date.now(); 
    state.graceUntil = state.startAt + state.cfg.graceMs;
    updatePhase();
    arena.classList.remove('shake');
    if (hpEl) hpEl.style.width = '100%';
    // Timer
    state.timerId = setInterval(()=>{
      const ms = Date.now() - state.startAt;
      setTimer(ms);
    }, 30);
  }

  function doReset(){
  console.log('[reset] doReset');
  state.started = false;
  state.finished = false;
  state.hp = MaxHP;
  state.phase = 1;
  state.stunUntil = 0;
  state.lastDodgeAt = 0;
  state.graceUntil = 0;

  // 타이머 정지 및 초기화
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  setTimer(0);

  // HP바 원복
  if (hpEl) hpEl.style.width = '100%';

  // 오버레이/클론 정리
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  $$('.clone').forEach(n => n.remove());

  // 버튼 중앙 복귀 (레이아웃 갱신 후)
  requestAnimationFrame(() => {
    placeButton(0.5, 0.5);
  });
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
    const p = state.phase;
  const cfg = state.cfg;
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

  // 1) 그레이스 기간엔 회피 금지
  if (now < state.graceUntil) return;

  // 2) 쿨다운: 직전 회피 이후 일정 시간은 회피 금지
  if (now - state.lastDodgeAt < state.cfg.dodgeCooldown) return;

  // 거리 계산
  const btnRect = agreeBtn.getBoundingClientRect();
  const mouse = { x: e.clientX, y: e.clientY };
  const btnCenter = { x: btnRect.left + btnRect.width/2, y: btnRect.top + btnRect.height/2 };
  const dist = Math.hypot(mouse.x - btnCenter.x, mouse.y - btnCenter.y);

  // 3) 램핑: 시작 후 8초 동안은 threshold가 점진적으로 증가
  const elapsed = now - state.startAt;
  const rampSec = 8000;
  const ramp = Math.max(0.4, Math.min(1, elapsed / rampSec)); // 0.4~1 사이
  const threshold = (state.cfg.base + state.phase * state.cfg.phaseBoost) * ramp;

  if (now < state.stunUntil) return; // 스턴 중엔 회피 X

  if (dist < threshold) {
    const p = randPos();
    agreeBtn.style.left = p.x + 'px';
    agreeBtn.style.top  = p.y + 'px';
    state.lastDodgeAt = now; // 쿨다운 시작
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