const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory scoreboard (간단 데모용)
const topScores = []; // { name, ms, at }

function submitScore({ name, ms }) {
  const cleanName = (name || '???').toString().slice(0, 20);
  const time = Number(ms) || 0;
  if (time <= 0 || time > 60 * 60 * 1000) return; // 1h 초과/0 이하는 무시
  topScores.push({ name: cleanName, ms: time, at: new Date().toISOString() });
  topScores.sort((a, b) => a.ms - b.ms);
  if (topScores.length > 10) topScores.length = 10;
}

io.on('connection', (socket) => {
  // 현재 접속자 수 방송
  io.emit('stats:viewers', io.engine.clientsCount);

  // 초기 스코어보드 송신
  socket.emit('scoreboard', topScores);

  // 점수 제출
  socket.on('score:submit', (payload) => {
    try {
      submitScore(payload || {});
      io.emit('scoreboard', topScores);
    } catch (e) {
      // noop
    }
  });

  socket.on('disconnect', () => {
    io.emit('stats:viewers', io.engine.clientsCount);
  });
});

const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  console.log(`Boss server on http://localhost:${port}`);
});