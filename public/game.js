const socket = io();
const COLOR_FR = { RED: 'ROUGE', BLUE: 'BLEU', GREEN: 'VERT', YELLOW: 'JAUNE', WHITE: 'BLANC', BLACK: 'NOIR' };
const ROLE_LABELS = { bomber: 'DEMINEUR', expert: 'EXPERT', relay: 'RELAIS' };

let myRole = sessionStorage.getItem('role') || 'bomber';
let myRoomId = sessionStorage.getItem('roomId');
let gameState = null, holdTimer = null;
let isDeaf = myRole === 'relay';

if (!myRoomId) window.location.href = '/';

socket.on('connect', () => {
  if (myRoomId && myRole) {
    socket.emit('reconnectGame', {
      roomId: myRoomId, role: myRole,
      name: sessionStorage.getItem('playerName') || 'Joueur',
    });
  }
});

socket.on('gameState', (state) => { gameState = state; renderGameState(state); });
socket.on('timerTick', ({ timeLeft }) => { if (gameState) gameState.timeLeft = timeLeft; updateTimer(timeLeft); });
socket.on('chatMessage', (msg) => { appendChat(msg); if (!isDeaf) playTick(); });
socket.on('simonFlash', ({ moduleIndex, color }) => { flashSimonColor(moduleIndex, color); if (!isDeaf) playTick(); });
socket.on('gameEnd', ({ won, message }) => showGameOver(won, message));
socket.on('gameStarted', () => document.getElementById('gameOverOverlay').classList.add('hidden'));
socket.on('error', ({ message }) => { alert(message); window.location.href = '/'; });

function renderGameState(state) {
  document.getElementById('serialDisplay').textContent = (state.bomb && state.bomb.serial) || (state.manual && state.manual.serial) || '------';
  document.getElementById('hudPlayers').innerHTML = (state.players || []).map(p =>
    '<span class="hud-player ' + p.role + '">' + (ROLE_LABELS[p.role]||p.role) + ': ' + p.name + '</span>'
  ).join('');
  updateStrikes(state.strikes || 0);
  updateTimer(state.timeLeft || 0);
  document.getElementById('chatRoleLabel').textContent = ROLE_LABELS[myRole] || myRole;
  if (isDeaf) document.getElementById('deafIndicator').classList.remove('hidden');
  if (state.view === 'manual') {
    renderManual(state.manual, state.strikes || 0);
    document.getElementById('manualView').classList.remove('hidden');
    document.getElementById('bombView').classList.add('hidden');
    document.getElementById('expertSignalArea').classList.remove('hidden');
    document.getElementById('chatInputArea').classList.add('hidden');
  } else {
    renderBomb(state.bomb);
    document.getElementById('bombView').classList.remove('hidden');
    document.getElementById('manualView').classList.add('hidden');
    document.getElementById('chatInputArea').classList.remove('hidden');
    document.getElementById('expertSignalArea').classList.add('hidden');
    document.getElementById('viewTitle').textContent = myRole === 'relay' ? 'VUE RELAIS - Aidez l equipe' : 'BOMBE';
  }
}

function renderBomb(bomb) {
  if (!bomb) return;
  const container = document.getElementById('modulesContainer');
  container.innerHTML = '';
  bomb.modules.forEach((mod, i) => {
    const card = document.createElement('div');
    card.className = 'module-card' + (mod.solved ? ' solved' : '');
    card.id = 'module-' + i;
    if (mod.type === 'wires') card.innerHTML = renderWiresModule(mod, i);
    if (mod.type === 'button') card.innerHTML = renderButtonModule(mod, i);
    if (mod.type === 'simon') card.innerHTML = renderSimonModule(mod, i);
    container.appendChild(card);
    if (mod.type === 'wires' && !mod.solved) {
      card.querySelectorAll('[data-wire]').forEach(el => {
        el.addEventListener('click', () => cutWire(i, parseInt(el.dataset.wire)));
      });
    }
  });
}

function renderWiresModule(mod, idx) {
  const rows = (mod.wires || []).map((color, i) =>
    '<div class="wire-row">' +
    '<span class="wire-number">' + (i+1) + '</span>' +
    '<div class="wire-visual wire-' + color + (mod.solved?' cut':'') + '" data-wire="' + i + '"></div>' +
    '<span class="wire-label">' + (COLOR_FR[color]||color) + '</span>' +
    (!mod.solved ? '<button class="wire-btn wire-' + color + '" onclick="cutWire(' + idx + ',' + i + ')" style="background:var(--wire-' + color + ');color:' + (color==='WHITE'||color==='YELLOW'?'#000':'#fff') + '">COUPER</button>' : '') +
    '</div>'
  ).join('');
  return '<div class="module-title">MODULE ' + (idx+1) + ' - FILS</div><div class="wires-grid">' + rows + '</div>';
}

function renderButtonModule(mod, idx) {
  const c = mod.color || 'RED';
  return '<div class="module-title">MODULE ' + (idx+1) + ' - BOUTON</div>' +
    '<div class="button-display">' +
    '<p style="font-size:0.8rem;color:var(--text-dim);margin-bottom:8px;">Couleur: <strong style="color:var(--wire-' + c + ')">' + (COLOR_FR[c]||c) + '</strong> - Etiquette: <strong>' + mod.label + '</strong> - Piles: <strong>' + mod.batteries + '</strong></p>' +
    '<button id="bigBtn-' + idx + '" class="big-button btn-' + c + '"' + (mod.solved?' disabled':'') + '>' + mod.label + '</button>' +
    '<div class="button-actions">' +
    '<button class="btn-action press" onclick="pressButton(' + idx + ')"' + (mod.solved?' disabled':'') + '>APPUYER</button>' +
    '<button class="btn-action hold" onmousedown="startHold(' + idx + ')" onmouseup="releaseHold(' + idx + ')" ontouchstart="startHold(' + idx + ')" ontouchend="releaseHold(' + idx + ')"' + (mod.solved?' disabled':'') + '>MAINTENIR</button>' +
    '</div></div>';
}

function renderSimonModule(mod, idx) {
  const btns = ['RED','BLUE','GREEN','YELLOW'].map(c =>
    '<button class="simon-btn ' + c + '" id="simon-' + idx + '-' + c + '" onclick="pressSimon(' + idx + ',\'' + c + '\')"' + (mod.solved?' disabled':'') + '>' + (COLOR_FR[c]||c) + '</button>'
  ).join('');
  return '<div class="module-title">MODULE ' + (idx+1) + ' - SIMON</div>' +
    '<div class="simon-display">' +
    '<p class="simon-info">Appuyez sur FLASH pour voir la sequence - Reproduisez dans le bon ordre</p>' +
    '<div class="simon-grid">' + btns + '</div>' +
    '<div class="simon-progress">Etape : <span>' + (mod.current||0) + '</span>/<span>' + (mod.length||'?') + '</span></div>' +
    (!mod.solved ? '<button class="btn-action hold" style="margin-top:8px" onclick="requestSimonFlash(' + idx + ')">FLASH</button>' : '') +
    '</div>';
}

function renderManual(manual, strikes) {
  if (!manual) return;
  document.getElementById('serialDisplay').textContent = manual.serial || '------';
  const container = document.getElementById('manualContainer');
  container.innerHTML = '';
  manual.modules.forEach((mod, i) => {
    const div = document.createElement('div');
    div.className = 'manual-module' + (mod.solved ? ' solved' : '');
    if (mod.type === 'wires') div.innerHTML = renderWiresManual(mod, i, manual);
    if (mod.type === 'button') div.innerHTML = renderButtonManual(mod, i);
    if (mod.type === 'simon') div.innerHTML = renderSimonManual(mod, i, strikes);
    container.appendChild(div);
  });
}

function chip(color) {
  return '<span class="manual-highlight mh-' + color.toLowerCase() + '">' + (COLOR_FR[color]||color) + '</span>';
}

function renderWiresManual(mod, idx, manual) {
  const wires = mod.wires || [], n = wires.length;
  const isOdd = manual.serialIsOdd;
  let rules = '';
  if (n === 3) {
    rules = '<div class="manual-rule">Si aucun fil ' + chip('RED') + ' : <span class="action">couper le 2eme</span></div>' +
      '<div class="manual-rule">Sinon si dernier = ' + chip('WHITE') + ' : <span class="action">couper le dernier</span></div>' +
      '<div class="manual-rule">Sinon si plusieurs ' + chip('BLUE') + ' : <span class="action">couper le dernier BLEU</span></div>' +
      '<div class="manual-rule">Sinon : <span class="action">couper le 3eme</span></div>';
  } else if (n === 4) {
    rules = '<div class="manual-rule">Si plusieurs ' + chip('RED') + ' ET serie impaire : <span class="action">couper le dernier ROUGE</span></div>' +
      '<div class="manual-rule">Sinon si dernier = ' + chip('YELLOW') + ' ET aucun ' + chip('RED') + ' : <span class="action">couper le 1er</span></div>' +
      '<div class="manual-rule">Sinon si exactement un ' + chip('BLUE') + ' : <span class="action">couper le 1er</span></div>' +
      '<div class="manual-rule">Sinon si plusieurs ' + chip('YELLOW') + ' : <span class="action">couper le 4eme</span></div>' +
      '<div class="manual-rule">Sinon : <span class="action">couper le 2eme</span></div>';
  } else {
    rules = '<div class="manual-rule">Si dernier = ' + chip('BLACK') + ' ET serie impaire : <span class="action">couper le 4eme</span></div>' +
      '<div class="manual-rule">Sinon si un ' + chip('RED') + ' ET plusieurs ' + chip('YELLOW') + ' : <span class="action">couper le 1er</span></div>' +
      '<div class="manual-rule">Sinon si aucun ' + chip('BLACK') + ' : <span class="action">couper le 2eme</span></div>' +
      '<div class="manual-rule">Sinon : <span class="action">couper le 1er</span></div>';
  }
  const wireList = wires.map(c => chip(c)).join(' ');
  return '<h3>MODULE ' + (idx+1) + ' - FILS (' + n + ' fils)</h3>' +
    '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px;">Fils : ' + wireList + ' - Serie <strong>' + manual.serial + '</strong> (' + (isOdd ? '<span style="color:var(--yellow)">IMPAIR</span>' : '<span style="color:var(--green)">PAIR</span>') + ')</p>' +
    rules;
}

function renderButtonManual(mod, idx) {
  const c = mod.color || 'RED';
  return '<h3>MODULE ' + (idx+1) + ' - BOUTON</h3>' +
    '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px;">Bouton ' + chip(c) + ' - Etiquette <strong>' + mod.label + '</strong> - Piles <strong>' + mod.batteries + '</strong></p>' +
    '<div class="manual-rule">Si ' + chip('BLUE') + ' et "ABORT" : <span class="action">MAINTENIR</span></div>' +
    '<div class="manual-rule">Si plus d 1 pile et "DETONATE" : <span class="action">APPUYER</span></div>' +
    '<div class="manual-rule">Si ' + chip('WHITE') + ' : <span class="action">MAINTENIR</span></div>' +
    '<div class="manual-rule">Si plus de 2 piles et ' + chip('YELLOW') + ' : <span class="action">APPUYER</span></div>' +
    '<div class="manual-rule">Si ' + chip('RED') + ' et "HOLD" : <span class="action">APPUYER</span></div>' +
    '<div class="manual-rule">Sinon : <span class="action">MAINTENIR puis relacher</span></div>' +
    '<div style="margin-top:12px;padding:10px;background:rgba(78,205,196,0.08);border-radius:6px;font-size:0.82rem;color:var(--expert);">Solution : <strong>' + (mod.solution==='hold' ? 'MAINTENIR puis relacher' : 'APPUYER (rapide)') + '</strong></div>';
}

function renderSimonManual(mod, idx, strikes) {
  const tables = [
    { cond: 'Sans erreur', R:'BLEU', B:'JAUNE', G:'VERT', Y:'ROUGE' },
    { cond: '1 erreur',    R:'BLEU', B:'ROUGE', G:'JAUNE', Y:'VERT' },
    { cond: '2+ erreurs',  R:'JAUNE', B:'VERT', G:'BLEU', Y:'ROUGE' },
  ];
  const ai = Math.min(strikes, 2);
  const rows = tables.map((t, ti) =>
    '<tr style="' + (ti===ai ? 'background:rgba(78,205,196,0.12);' : '') + '">' +
    '<td>' + t.cond + (ti===ai ? ' <span style="color:var(--expert)">ACTUEL</span>' : '') + '</td>' +
    '<td>' + chip('RED') + ' : <strong>' + t.R + '</strong></td>' +
    '<td>' + chip('BLUE') + ' : <strong>' + t.B + '</strong></td>' +
    '<td>' + chip('GREEN') + ' : <strong>' + t.G + '</strong></td>' +
    '<td>' + chip('YELLOW') + ' : <strong>' + t.Y + '</strong></td>' +
    '</tr>'
  ).join('');
  const seq = (mod.sequence||[]).map(c => chip(c)).join(' ');
  return '<h3>MODULE ' + (idx+1) + ' - SIMON SAYS</h3>' +
    '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px;">Sequence : ' + seq + '</p>' +
    '<table class="manual-table"><thead><tr><th>Condition</th><th>ROUGE</th><th>BLEU</th><th>VERT</th><th>JAUNE</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="font-size:0.75rem;color:var(--text-dim);margin-top:8px;">Couleur qui flash sur la bombe - trouvez la traduction - signalez au Demineur.</p>';
}

function updateTimer(timeLeft) {
  const m = Math.floor(timeLeft/60), s = timeLeft%60;
  const el = document.getElementById('timerDisplay'), hud = document.getElementById('hudTimer');
  if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  if (timeLeft <= 60) hud.classList.add('danger'); else hud.classList.remove('danger');
}

function updateStrikes(strikes) {
  [1,2,3].forEach(i => {
    const el = document.getElementById('strike' + i);
    if (el) { el.classList.toggle('hit', i<=strikes); el.classList.toggle('empty', i>strikes); }
  });
}

function cutWire(moduleIndex, wireIndex) {
  if (myRole !== 'bomber') return;
  socket.emit('action', { moduleIndex, action: 'cutWire', data: { wireIndex } });
}
function pressButton(moduleIndex) {
  if (myRole !== 'bomber') return;
  socket.emit('action', { moduleIndex, action: 'press', data: {} });
}
function startHold(moduleIndex) {
  if (myRole !== 'bomber') return;
  var btn = document.getElementById('bigBtn-' + moduleIndex);
  if (btn) btn.classList.add('held');
  holdTimer = moduleIndex;
}
function releaseHold(moduleIndex) {
  if (myRole !== 'bomber' || holdTimer !== moduleIndex) return;
  var btn = document.getElementById('bigBtn-' + moduleIndex);
  if (btn) btn.classList.remove('held');
  holdTimer = null;
  socket.emit('action', { moduleIndex, action: 'holdRelease', data: {} });
}
function pressSimon(moduleIndex, color) {
  if (myRole !== 'bomber') return;
  socket.emit('action', { moduleIndex, action: 'simon', data: { color } });
}
function requestSimonFlash(moduleIndex) {
  socket.emit('simonFlash', { moduleIndex });
}
function flashSimonColor(moduleIndex, color) {
  var btn = document.getElementById('simon-' + moduleIndex + '-' + color);
  if (btn) { btn.classList.add('flash'); setTimeout(function(){ btn.classList.remove('flash'); }, 450); }
}

function sendChat() {
  if (myRole === 'expert') return;
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text) return;
  socket.emit('chatMessage', { text });
  input.value = '';
}
function sendSignal(signal) { socket.emit('expertSignal', { signal }); }

function appendChat(msg) {
  var container = document.getElementById('chatMessages');
  var el = document.createElement('div');
  el.className = 'chat-msg type-' + msg.type + ' role-' + msg.role;
  el.innerHTML = '<div class="msg-sender">' + msg.sender + '</div><div class="msg-text">' + esc(msg.text) + '</div>';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.getElementById('chatInput').addEventListener('keydown', function(e) { if (e.key==='Enter') sendChat(); });

var audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
function playTick() {
  if (isDeaf || !audioCtx) return;
  try {
    var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start(); osc.stop(audioCtx.currentTime + 0.1);
  } catch(e) {}
}

function showGameOver(won, message) {
  if (!won) {
    var fx = document.getElementById('explosionFx');
    fx.classList.remove('hidden');
    setTimeout(function(){ fx.classList.add('hidden'); }, 900);
    if (!isDeaf && audioCtx) playExplosion();
  }
  setTimeout(function() {
    var overlay = document.getElementById('gameOverOverlay');
    var box = overlay.querySelector('.game-over-box');
    document.getElementById('gameOverIcon').textContent = won ? 'VICTOIRE' : 'BOOM';
    document.getElementById('gameOverTitle').textContent = won ? 'BOMBE DESAMORCEE !' : 'EXPLOSION !';
    document.getElementById('gameOverMsg').textContent = message;
    box.className = 'game-over-box ' + (won ? 'win' : 'lose');
    overlay.classList.remove('hidden');
  }, won ? 0 : 1000);
}

function playExplosion() {
  if (!audioCtx) return;
  try {
    var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 1.5);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);
    osc.start(); osc.stop(audioCtx.currentTime + 1.5);
  } catch(e) {}
}

function restartGame() { socket.emit('restartGame'); }

document.addEventListener('click', function() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { once: true });
