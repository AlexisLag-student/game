const socket = io();

const COLOR_FR = { RED: 'ROUGE', BLUE: 'BLEU', GREEN: 'VERT', YELLOW: 'JAUNE', WHITE: 'BLANC', BLACK: 'NOIR' };
const ROLE_LABELS = { bomber: '💣 DÉMINEUR', expert: '📖 EXPERT', relay: '🔇 RELAIS' };

let myRole = sessionStorage.getItem('role') || 'bomber';
let myRoomId = sessionStorage.getItem('roomId');
let gameState = null;
let holdTimer = null;
let isDeaf = myRole === 'relay';

// ─── Init ─────────────────────────────────────────────────────────────────

if (!myRoomId) {
  window.location.href = '/';
}

socket.on('connect', () => {
  if (myRoomId && myRole) {
    socket.emit('reconnectGame', {
      roomId: myRoomId,
      role: myRole,
      name: sessionStorage.getItem('playerName') || 'Joueur',
    });
  }
});

socket.on('gameState', (state) => {
  gameState = state;
  renderGameState(state);
});

socket.on('timerTick', ({ timeLeft }) => {
  if (gameState) gameState.timeLeft = timeLeft;
  updateTimer(timeLeft);
});

socket.on('chatMessage', (msg) => {
  appendChat(msg);
  if (!isDeaf) playTick();
});

socket.on('simonFlash', ({ moduleIndex, color, step, total, strikes }) => {
  flashSimonColor(moduleIndex, color);
  if (!isDeaf) playTick();
});

socket.on('gameEnd', ({ won, message }) => {
  showGameOver(won, message);
});

socket.on('gameStarted', () => {
  // Reconnected into new game
  document.getElementById('gameOverOverlay').classList.add('hidden');
});

socket.on('error', ({ message }) => {
  alert(message);
  window.location.href = '/';
});

// ─── Render ───────────────────────────────────────────────────────────────

function renderGameState(state) {
  // Serial
  document.getElementById('serialDisplay').textContent = state.serial || (state.bomb?.serial) || state.manual?.serial || '------';

  // Players HUD
  const playersEl = document.getElementById('hudPlayers');
  playersEl.innerHTML = (state.players || []).map(p =>
    `<span class="hud-player ${p.role}">${ROLE_LABELS[p.role] || p.role}: ${p.name}</span>`
  ).join('');

  // Strikes
  updateStrikes(state.strikes || 0, state.maxStrikes || 3);

  // Timer
  updateTimer(state.timeLeft || 0);

  // Chat role label
  document.getElementById('chatRoleLabel').textContent = ROLE_LABELS[myRole] || myRole;
  if (isDeaf) document.getElementById('deafIndicator').classList.remove('hidden');

  if (state.view === 'manual') {
    renderManual(state.manual, state.strikes || 0);
    document.getElementById('manualView').classList.remove('hidden');
    document.getElementById('bombView').classList.add('hidden');
    document.getElementById('expertSignalArea').classList.remove('hidden');
    document.getElementById('chatInputArea').classList.add('hidden');
  } else {
    renderBomb(state.bomb, state.strikes || 0);
    document.getElementById('bombView').classList.remove('hidden');
    document.getElementById('manualView').classList.add('hidden');
    document.getElementById('chatInputArea').classList.remove('hidden');
    document.getElementById('expertSignalArea').classList.add('hidden');

    const title = document.getElementById('viewTitle');
    if (myRole === 'relay') {
      title.textContent = '🔇 VUE RELAIS — Aidez l\'équipe';
    } else {
      title.textContent = '💣 BOMBE';
    }
  }
}

// ─── Bomb render ──────────────────────────────────────────────────────────

function renderBomb(bomb, strikes) {
  if (!bomb) return;
  document.getElementById('serialDisplay').textContent = bomb.serial || '------';
  const container = document.getElementById('modulesContainer');
  container.innerHTML = '';
  bomb.modules.forEach((mod, i) => {
    const card = document.createElement('div');
    card.className = `module-card${mod.solved ? ' solved' : ''}`;
    card.id = `module-${i}`;

    if (mod.type === 'wires') card.innerHTML = renderWiresModule(mod, i, strikes);
    if (mod.type === 'button') card.innerHTML = renderButtonModule(mod, i);
    if (mod.type === 'simon') card.innerHTML = renderSimonModule(mod, i);

    container.appendChild(card);
    attachModuleEvents(mod, i);
  });
}

function renderWiresModule(mod, idx, strikes) {
  const colors = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'WHITE', 'BLACK'];
  const wires = mod.wires || [];
  const rows = wires.map((color, i) => `
    <div class="wire-row">
      <span class="wire-number">${i + 1}</span>
      <div class="wire-visual wire-${color} ${mod.solved ? 'cut' : ''}"
           id="wire-${idx}-${i}"
           data-module="${idx}" data-wire="${i}"
           title="Cliquer pour couper le fil ${i + 1} (${COLOR_FR[color] || color})">
      </div>
      <span class="wire-label">${COLOR_FR[color] || color}</span>
      ${!mod.solved ? `<button class="wire-btn wire-${color}" onclick="cutWire(${idx},${i})" style="background:var(--wire-${color});color:${color==='WHITE'||color==='YELLOW'?'#000':'#fff'}">COUPER</button>` : ''}
    </div>
  `).join('');
  return `<div class="module-title">MODULE ${idx + 1} — FILS</div><div class="wires-grid">${rows}</div>`;
}

function renderButtonModule(mod, idx) {
  const btnColor = mod.color || 'RED';
  return `
    <div class="module-title">MODULE ${idx + 1} — BOUTON</div>
    <div class="button-display">
      <p style="font-size:0.8rem;color:var(--text-dim);margin-bottom:8px;">
        Couleur: <strong style="color:var(--wire-${btnColor})">${COLOR_FR[btnColor]}</strong> ·
        Étiquette: <strong>${mod.label || '?'}</strong> ·
        Piles: <strong>${mod.batteries ?? '?'}</strong>
      </p>
      <button id="bigBtn-${idx}" class="big-button btn-${btnColor} ${mod.solved ? 'disabled' : ''}"
              ${mod.solved ? 'disabled' : ''}>
        ${mod.label || '?'}
      </button>
      <div class="button-actions">
        <button class="btn-action press" onclick="pressButton(${idx})" ${mod.solved ? 'disabled' : ''}>
          👆 APPUYER
        </button>
        <button class="btn-action hold" id="holdBtn-${idx}" onmousedown="startHold(${idx})" onmouseup="releaseHold(${idx})" ontouchstart="startHold(${idx})" ontouchend="releaseHold(${idx})" ${mod.solved ? 'disabled' : ''}>
          ✋ MAINTENIR
        </button>
      </div>
    </div>
  `;
}

function renderSimonModule(mod, idx) {
  const colors = ['RED', 'BLUE', 'GREEN', 'YELLOW'];
  const btns = colors.map(c => `
    <button class="simon-btn ${c}" id="simon-${idx}-${c}"
            onclick="pressSimon(${idx},'${c}')"
            ${mod.solved ? 'disabled' : ''}>
      ${COLOR_FR[c] || c}
    </button>
  `).join('');
  return `
    <div class="module-title">MODULE ${idx + 1} — SIMON</div>
    <div class="simon-display">
      <p class="simon-info">Appuyez sur FLASH pour voir la séquence · Reproduisez dans le bon ordre</p>
      <div class="simon-grid">${btns}</div>
      <div class="simon-progress">Étape : <span>${mod.current ?? 0}</span>/<span>${mod.length ?? '?'}</span></div>
      ${!mod.solved ? `<button class="btn-action hold" style="margin-top:8px" onclick="requestSimonFlash(${idx})">▶ FLASH</button>` : ''}
    </div>
  `;
}

function attachModuleEvents(mod, idx) {
  // Wire click on visual
  if (mod.type === 'wires' && !mod.solved) {
    const wires = document.querySelectorAll(`[data-module="${idx}"]`);
    wires.forEach(el => {
      el.addEventListener('click', () => {
        const wireIdx = parseInt(el.dataset.wire);
        cutWire(idx, wireIdx);
      });
    });
  }
}

// ─── Manual render ────────────────────────────────────────────────────────

function renderManual(manual, strikes) {
  if (!manual) return;
  document.getElementById('serialDisplay').textContent = manual.serial || '------';
  const container = document.getElementById('manualContainer');
  container.innerHTML = '';

  manual.modules.forEach((mod, i) => {
    const div = document.createElement('div');
    div.className = `manual-module${mod.solved ? ' solved' : ''}`;
    div.id = `manual-module-${i}`;

    if (mod.type === 'wires') div.innerHTML = renderWiresManual(mod, i, manual);
    if (mod.type === 'button') div.innerHTML = renderButtonManual(mod, i, manual);
    if (mod.type === 'simon') div.innerHTML = renderSimonManual(mod, i, strikes);

    container.appendChild(div);
  });
}

function colorChip(color) {
  return `<span class="manual-highlight mh-${color.toLowerCase()}">${COLOR_FR[color] || color}</span>`;
}

function renderWiresManual(mod, idx, manual) {
  const serial = manual.serial || '';
  const isOdd = manual.serialIsOdd;
  const wires = mod.wires || [];
  const n = wires.length;
  const count = (c) => wires.filter(w => w === c).length;

  let rules = '';
  if (n === 3) {
    rules = `
      <div class="manual-rule">Si aucun fil ${colorChip('RED')} → <span class="action">couper le 2ème fil</span></div>
      <div class="manual-rule">Sinon si dernier fil = ${colorChip('WHITE')} → <span class="action">couper le dernier fil</span></div>
      <div class="manual-rule">Sinon si plus d'un fil ${colorChip('BLUE')} → <span class="action">couper le dernier fil BLEU</span></div>
      <div class="manual-rule">Sinon → <span class="action">couper le 3ème fil</span></div>
    `;
  } else if (n === 4) {
    rules = `
      <div class="manual-rule">Si plus d'un ${colorChip('RED')} ET numéro de série impair → <span class="action">couper le dernier fil ROUGE</span></div>
      <div class="manual-rule">Sinon si dernier fil = ${colorChip('YELLOW')} ET aucun ${colorChip('RED')} → <span class="action">couper le 1er fil</span></div>
      <div class="manual-rule">Sinon si exactement un ${colorChip('BLUE')} → <span class="action">couper le 1er fil</span></div>
      <div class="manual-rule">Sinon si plus d'un ${colorChip('YELLOW')} → <span class="action">couper le 4ème fil</span></div>
      <div class="manual-rule">Sinon → <span class="action">couper le 2ème fil</span></div>
    `;
  } else {
    rules = `
      <div class="manual-rule">Si dernier fil = ${colorChip('BLACK')} ET numéro de série impair → <span class="action">couper le 4ème fil</span></div>
      <div class="manual-rule">Sinon si exactement un ${colorChip('RED')} ET plus d'un ${colorChip('YELLOW')} → <span class="action">couper le 1er fil</span></div>
      <div class="manual-rule">Sinon si aucun ${colorChip('BLACK')} → <span class="action">couper le 2ème fil</span></div>
      <div class="manual-rule">Sinon → <span class="action">couper le 1er fil</span></div>
    `;
  }

  const wireList = wires.map((c, i) => `<span class="manual-highlight mh-${c.toLowerCase()}">${i+1}: ${COLOR_FR[c]}</span>`).join(' ');

  return `
    <h3>MODULE ${idx+1} — FILS (${n} fils)</h3>
    <p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:10px;">Fils présents : ${wireList}</p>
    <p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:10px;">N° série : <strong>${serial}</strong> (dernier chiffre : ${isOdd ? '<span style="color:var(--yellow)">IMPAIR</span>' : '<span style="color:var(--green)">PAIR</span>'})</p>
    ${rules}
  `;
}

function renderButtonManual(mod, idx, manual) {
  const color = mod.color || '?';
  const label = mod.label || '?';
  const batt = mod.batteries ?? '?';

  return `
    <h3>MODULE ${idx+1} — BOUTON</h3>
    <p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:10px;">
      Bouton : ${colorChip(color)} · Étiquette : <strong>${label}</strong> · Piles : <strong>${batt}</strong>
    </p>
    <div class="manual-rule">Si ${colorChip('BLUE')} et étiquette "ABORT" → <span class="action">MAINTENIR</span></div>
    <div class="manual-rule">Si plus d'1 pile et étiquette "DETONATE" → <span class="action">APPUYER et relâcher</span></div>
    <div class="manual-rule">Si ${colorChip('WHITE')} → <span class="action">MAINTENIR</span></div>
    <div class="manual-rule">Si plus de 2 piles et ${colorChip('YELLOW')} → <span class="action">APPUYER et relâcher</span></div>
    <div class="manual-rule">Si ${colorChip('RED')} et étiquette "HOLD" → <span class="action">APPUYER et relâcher</span></div>
    <div class="manual-rule">Sinon → <span class="action">MAINTENIR, puis relâcher</span></div>
    <div style="margin-top:12px;padding:10px;background:rgba(78,205,196,0.08);border-radius:6px;font-size:0.78rem;color:var(--expert);">
      Solution pour cette bombe : <strong style="font-size:1rem">${mod.solution === 'hold' ? '✋ MAINTENIR puis relâcher' : '👆 APPUYER (rapide)'}</strong>
    </div>
  `;
}

function renderSimonManual(mod, idx, strikes) {
  const tables = [
    { cond: 'Sans erreur', R: 'BLEU', B: 'JAUNE', G: 'VERT', Y: 'ROUGE' },
    { cond: '1 erreur', R: 'BLEU', B: 'ROUGE', G: 'JAUNE', Y: 'VERT' },
    { cond: '2+ erreurs', R: 'JAUNE', B: 'VERT', G: 'BLEU', Y: 'ROUGE' },
  ];
  const activeIdx = Math.min(strikes, 2);

  const rows = tables.map((t, ti) => `
    <tr style="${ti === activeIdx ? 'background:rgba(78,205,196,0.12);' : ''}">
      <td>${t.cond}${ti === activeIdx ? ' <span style="color:var(--expert)">◀ ACTUEL</span>' : ''}</td>
      <td>${colorChip('RED')} → <strong>${t.R}</strong></td>
      <td>${colorChip('BLUE')} → <strong>${t.B}</strong></td>
      <td>${colorChip('GREEN')} → <strong>${t.G}</strong></td>
      <td>${colorChip('YELLOW')} → <strong>${t.Y}</strong></td>
    </tr>
  `).join('');

  const seq = (mod.sequence || []).map((c, i) => `<span class="manual-highlight mh-${c.toLowerCase()}">${i+1}: ${COLOR_FR[c]}</span>`).join(' ');

  return `
    <h3>MODULE ${idx+1} — SIMON SAYS</h3>
    <p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:10px;">Séquence originale : ${seq}</p>
    <table class="manual-table">
      <thead><tr><th>Condition</th><th>ROUGE</th><th>BLEU</th><th>VERT</th><th>JAUNE</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:0.75rem;color:var(--text-dim);margin-top:8px;">→ Regardez la couleur qui flash sur la bombe, trouvez sa traduction, dites au Démineur quelle couleur appuyer.</p>
  `;
}

// ─── HUD Updates ──────────────────────────────────────────────────────────

function updateTimer(timeLeft) {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const display = `${mins}:${String(secs).padStart(2, '0')}`;
  const el = document.getElementById('timerDisplay');
  const hud = document.getElementById('hudTimer');
  if (el) el.textContent = display;
  if (timeLeft <= 60) hud.classList.add('danger');
  else hud.classList.remove('danger');
}

function updateStrikes(strikes, max) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById(`strike${i}`);
    if (el) {
      el.classList.toggle('hit', i <= strikes);
      el.classList.toggle('empty', i > strikes);
    }
  });
}

// ─── Bomb Actions ─────────────────────────────────────────────────────────

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
  const btn = document.getElementById(`bigBtn-${moduleIndex}`);
  if (btn) btn.classList.add('held');
  holdTimer = moduleIndex;
}

function releaseHold(moduleIndex) {
  if (myRole !== 'bomber') return;
  if (holdTimer !== moduleIndex) return;
  const btn = document.getElementById(`bigBtn-${moduleIndex}`);
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
  const btn = document.getElementById(`simon-${moduleIndex}-${color}`);
  if (btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 450);
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────

function sendChat() {
  if (myRole === 'expert') return;
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chatMessage', { text });
  input.value = '';
}

function sendSignal(signal) {
  socket.emit('expertSignal', { signal });
}

function appendChat(msg) {
  const container = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.className = `chat-msg type-${msg.type} role-${msg.role}`;
  el.innerHTML = `<div class="msg-sender">${msg.sender}</div><div class="msg-text">${escHtml(msg.text)}</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.getElementById('chatInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});

// ─── Audio ────────────────────────────────────────────────────────────────

const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
function playTick() {
  if (isDeaf || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } catch (e) {}
}

// ─── Game Over ────────────────────────────────────────────────────────────

function showGameOver(won, message) {
  if (!won) {
    const fx = document.getElementById('explosionFx');
    fx.classList.remove('hidden');
    setTimeout(() => fx.classList.add('hidden'), 900);
    if (!isDeaf && audioCtx) playExplosion();
  }
  setTimeout(() => {
    const overlay = document.getElementById('gameOverOverlay');
    const box = overlay.querySelector('.game-over-box');
    document.getElementById('gameOverIcon').textContent = won ? '🎉' : '💥';
    document.getElementById('gameOverTitle').textContent = won ? 'BOMBE DÉSAMORCÉE !' : 'EXPLOSION !';
    document.getElementById('gameOverMsg').textContent = message;
    box.className = `game-over-box ${won ? 'win' : 'lose'}`;
    overlay.classList.remove('hidden');
  }, won ? 0 : 1000);
}

function playExplosion() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 1.5);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.5);
  } catch (e) {}
}

function restartGame() {
  socket.emit('restartGame');
}

// Resume AudioContext on interaction
document.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { once: true });
