const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Game data ───────────────────────────────────────────────────────────────

const COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'WHITE', 'BLACK'];
const COLOR_FR = { RED: 'ROUGE', BLUE: 'BLEU', GREEN: 'VERT', YELLOW: 'JAUNE', WHITE: 'BLANC', BLACK: 'NOIR' };
const SIMON_COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function generateSerial() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function serialIsOdd(serial) {
  for (let i = serial.length - 1; i >= 0; i--) {
    const d = parseInt(serial[i]);
    if (!isNaN(d)) return d % 2 !== 0;
  }
  return false;
}

// ─── Module generators ───────────────────────────────────────────────────────

function generateWiresModule(serial) {
  const count = randInt(3, 5);
  const wires = Array.from({ length: count }, () => rand(COLORS));
  const solution = solveWires(wires, serial);
  return { type: 'wires', wires, solution, solved: false, strikes: 0 };
}

function solveWires(wires, serial) {
  const n = wires.length;
  const count = (c) => wires.filter(w => w === c).length;

  if (n === 3) {
    if (count('RED') === 0) return 1;
    if (wires[n - 1] === 'WHITE') return n - 1;
    if (count('BLUE') > 1) return wires.lastIndexOf('BLUE');
    return 2;
  }
  if (n === 4) {
    if (count('RED') > 1 && serialIsOdd(serial)) return wires.lastIndexOf('RED');
    if (wires[n - 1] === 'YELLOW' && count('RED') === 0) return 0;
    if (count('BLUE') === 1) return 0;
    if (count('YELLOW') > 1) return n - 1;
    return 1;
  }
  // 5 wires
  if (wires[n - 1] === 'BLACK' && serialIsOdd(serial)) return 3;
  if (count('RED') === 1 && count('YELLOW') > 1) return 0;
  if (count('BLACK') === 0) return 1;
  return 0;
}

function generateButtonModule() {
  const colors = ['RED', 'BLUE', 'YELLOW', 'WHITE'];
  const labels = ['ABORT', 'DETONATE', 'HOLD', 'PRESS'];
  const color = rand(colors);
  const label = rand(labels);
  const batteries = randInt(0, 3);
  const solution = solveButton(color, label, batteries);
  return { type: 'button', color, label, batteries, solution, solved: false, held: false };
}

function solveButton(color, label, batteries) {
  if (color === 'BLUE' && label === 'ABORT') return 'hold';
  if (batteries > 1 && label === 'DETONATE') return 'press';
  if (color === 'WHITE') return 'hold';
  if (batteries > 2 && color === 'YELLOW') return 'press';
  if (color === 'RED' && label === 'HOLD') return 'press';
  return 'hold';
}

function generateSimonModule() {
  const length = randInt(3, 5);
  const sequence = Array.from({ length }, () => rand(SIMON_COLORS));
  return { type: 'simon', sequence, current: 0, solved: false };
}

function getSimonTranslation(color, strikes) {
  const table = {
    0: { RED: 'BLUE', BLUE: 'YELLOW', GREEN: 'GREEN', YELLOW: 'RED' },
    1: { RED: 'BLUE', BLUE: 'RED', GREEN: 'YELLOW', YELLOW: 'GREEN' },
    2: { RED: 'YELLOW', BLUE: 'GREEN', GREEN: 'BLUE', YELLOW: 'RED' },
  };
  return (table[Math.min(strikes, 2)] || table[0])[color];
}

// ─── Room management ─────────────────────────────────────────────────────────

const rooms = {};

function createRoom(roomId) {
  const serial = generateSerial();
  const modules = [
    generateWiresModule(serial),
    generateButtonModule(),
    generateSimonModule(),
  ];
  rooms[roomId] = {
    id: roomId,
    players: {},
    serial,
    modules,
    strikes: 0,
    maxStrikes: 3,
    timeLeft: 300,
    started: false,
    gameOver: false,
    won: false,
    timer: null,
    chatHistory: [],
  };
  return rooms[roomId];
}

function getRoomForSocket(socketId) {
  return Object.values(rooms).find(r => r.players[socketId]);
}

function getPlayerRole(room, socketId) {
  return room.players[socketId]?.role;
}

function getRoles(room) {
  return Object.values(room.players).map(p => p.role);
}

function availableRole(room) {
  const taken = getRoles(room);
  const all = ['bomber', 'expert', 'relay'];
  return all.find(r => !taken.includes(r));
}

function getManualData(room) {
  return {
    serial: room.serial,
    serialIsOdd: serialIsOdd(room.serial),
    modules: room.modules.map(m => {
      if (m.type === 'wires') return { type: 'wires', wires: m.wires, solution: m.solution };
      if (m.type === 'button') return { type: 'button', color: m.color, label: m.label, batteries: m.batteries, solution: m.solution };
      if (m.type === 'simon') return { type: 'simon', sequence: m.sequence };
      return m;
    }),
  };
}

function getBombData(room) {
  return {
    serial: room.serial,
    modules: room.modules.map((m, i) => {
      if (m.type === 'wires') return { type: 'wires', index: i, wires: m.wires, solved: m.solved };
      if (m.type === 'button') return { type: 'button', index: i, color: m.color, label: m.label, solved: m.solved, held: m.held };
      if (m.type === 'simon') return { type: 'simon', index: i, length: m.sequence.length, current: m.current, solved: m.solved };
      return m;
    }),
  };
}

function broadcastState(room) {
  Object.entries(room.players).forEach(([sid, player]) => {
    const base = {
      strikes: room.strikes,
      maxStrikes: room.maxStrikes,
      timeLeft: room.timeLeft,
      gameOver: room.gameOver,
      won: room.won,
      players: Object.values(room.players).map(p => ({ name: p.name, role: p.role })),
    };
    if (player.role === 'expert') {
      io.to(sid).emit('gameState', { ...base, view: 'manual', manual: getManualData(room) });
    } else {
      io.to(sid).emit('gameState', { ...base, view: 'bomb', bomb: getBombData(room) });
    }
  });
}

function addChat(room, message) {
  room.chatHistory.push(message);
  io.to(room.id).emit('chatMessage', message);
}

function checkWin(room) {
  if (room.modules.every(m => m.solved)) {
    room.gameOver = true;
    room.won = true;
    if (room.timer) clearInterval(room.timer);
    broadcastState(room);
    io.to(room.id).emit('gameEnd', { won: true, message: 'BOMBE DÉSAMORCÉE ! Félicitations !' });
  }
}

function triggerExplosion(room, reason) {
  room.gameOver = true;
  room.won = false;
  if (room.timer) clearInterval(room.timer);
  broadcastState(room);
  io.to(room.id).emit('gameEnd', { won: false, message: reason });
}

function startTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    if (room.gameOver) { clearInterval(room.timer); return; }
    room.timeLeft--;
    io.to(room.id).emit('timerTick', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) {
      triggerExplosion(room, 'TEMPS ÉCOULÉ ! La bombe a explosé !');
    }
  }, 1000);
}

// ─── Socket handlers ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
    const room = createRoom(roomId);
    const role = 'bomber';
    room.players[socket.id] = { id: socket.id, name, role };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, role, name });
    io.to(roomId).emit('playerList', Object.values(room.players));
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error', { message: 'Salle introuvable.' }); return; }
    if (Object.keys(room.players).length >= 3) { socket.emit('error', { message: 'Salle pleine (3 joueurs max).' }); return; }
    if (room.started) { socket.emit('error', { message: 'Partie déjà en cours.' }); return; }

    const role = availableRole(room);
    room.players[socket.id] = { id: socket.id, name, role };
    socket.join(roomId);
    socket.emit('roomJoined', { roomId, role, name });
    io.to(roomId).emit('playerList', Object.values(room.players));

    if (Object.keys(room.players).length === 3) {
      room.started = true;
      setTimeout(() => {
        startTimer(room);
        broadcastState(room);
        io.to(roomId).emit('gameStarted', {});
      }, 1000);
    }
  });

  socket.on('reconnectGame', ({ roomId, role, name }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error', { message: 'Salle introuvable.' }); return; }
    // Re-register this socket with its role
    const existing = Object.values(room.players).find(p => p.role === role);
    if (existing) {
      delete room.players[existing.id];
    }
    room.players[socket.id] = { id: socket.id, name: name || 'Joueur', role };
    socket.join(roomId);
    broadcastState(room);
  });

  socket.on('chatMessage', ({ text }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.gameOver) return;
    const player = room.players[socket.id];
    if (!player) return;
    if (player.role === 'expert') return; // expert ne peut pas écrire

    const msg = { sender: player.name, role: player.role, text, type: 'chat', timestamp: Date.now() };
    addChat(room, msg);
  });

  socket.on('expertSignal', ({ signal }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.gameOver) return;
    const player = room.players[socket.id];
    if (!player || player.role !== 'expert') return;

    const msg = { sender: player.name, role: 'expert', text: signal, type: 'signal', timestamp: Date.now() };
    addChat(room, msg);
  });

  socket.on('action', ({ moduleIndex, action, data }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.gameOver) return;
    const player = room.players[socket.id];
    if (!player || player.role !== 'bomber') return;

    const mod = room.modules[moduleIndex];
    if (!mod || mod.solved) return;

    let success = false;
    let feedbackMsg = '';

    if (mod.type === 'wires') {
      const cut = parseInt(data.wireIndex);
      if (cut === mod.solution) {
        mod.solved = true;
        success = true;
        feedbackMsg = `✅ Fil ${cut + 1} coupé — Module FILS désamorcé !`;
      } else {
        room.strikes++;
        feedbackMsg = `❌ Mauvais fil coupé ! Strike ${room.strikes}/${room.maxStrikes}`;
      }
    }

    if (mod.type === 'button') {
      if (action === 'press') {
        if (mod.solution === 'press') {
          mod.solved = true;
          success = true;
          feedbackMsg = `✅ Bouton pressé — Module BOUTON désamorcé !`;
        } else {
          room.strikes++;
          feedbackMsg = `❌ Il fallait maintenir ! Strike ${room.strikes}/${room.maxStrikes}`;
        }
      } else if (action === 'holdRelease') {
        if (mod.solution === 'hold') {
          mod.solved = true;
          success = true;
          feedbackMsg = `✅ Bouton maintenu et relâché — Module BOUTON désamorcé !`;
        } else {
          room.strikes++;
          feedbackMsg = `❌ Il fallait juste appuyer ! Strike ${room.strikes}/${room.maxStrikes}`;
        }
      }
    }

    if (mod.type === 'simon') {
      const expected = mod.sequence[mod.current];
      const translated = getSimonTranslation(expected, room.strikes);
      if (data.color === translated) {
        mod.current++;
        if (mod.current >= mod.sequence.length) {
          mod.solved = true;
          success = true;
          feedbackMsg = `✅ Séquence complète — Module SIMON désamorcé !`;
        } else {
          feedbackMsg = `✅ Bonne couleur ! Étape ${mod.current}/${mod.sequence.length}`;
          broadcastState(room);
          const sysMsg = { sender: 'SYSTÈME', role: 'system', text: feedbackMsg, type: 'system', timestamp: Date.now() };
          addChat(room, sysMsg);
          return;
        }
      } else {
        mod.current = 0;
        room.strikes++;
        feedbackMsg = `❌ Mauvaise couleur, séquence réinitialisée ! Strike ${room.strikes}/${room.maxStrikes}`;
      }
    }

    const sysMsg = { sender: 'SYSTÈME', role: 'system', text: feedbackMsg, type: 'system', timestamp: Date.now() };
    addChat(room, sysMsg);
    broadcastState(room);

    if (room.strikes >= room.maxStrikes) {
      triggerExplosion(room, 'TROP D\'ERREURS ! La bombe a explosé !');
      return;
    }
    checkWin(room);
  });

  socket.on('simonFlash', ({ moduleIndex }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.gameOver) return;
    const mod = room.modules[moduleIndex];
    if (!mod || mod.type !== 'simon' || mod.solved) return;
    const color = mod.sequence[mod.current];
    io.to(room.id).emit('simonFlash', { moduleIndex, color, step: mod.current, total: mod.sequence.length, strikes: room.strikes });
  });

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (player && room.started && !room.gameOver) {
      triggerExplosion(room, `${player.name} a quitté la partie. La bombe a explosé !`);
    }
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0 && !room.started) {
      if (room.timer) clearInterval(room.timer);
      delete rooms[room.id];
    } else if (Object.keys(room.players).length > 0) {
      io.to(room.id).emit('playerList', Object.values(room.players));
    }
  });

  socket.on('restartGame', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.gameOver) return;
    const players = { ...room.players };
    const newRoom = createRoom(room.id);
    newRoom.players = players;
    rooms[room.id] = newRoom;
    newRoom.started = true;
    setTimeout(() => {
      startTimer(newRoom);
      broadcastState(newRoom);
      io.to(room.id).emit('gameStarted', {});
    }, 1000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bomb Defusal server running on port ${PORT}`));
