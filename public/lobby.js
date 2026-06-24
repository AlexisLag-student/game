const socket = io();
let myRoomId = null;
let myRole = null;

const ROLE_LABELS = {
  bomber: '💣 DÉMINEUR',
  expert: '📖 EXPERT',
  relay: '🔇 RELAIS',
};
const ROLE_REMINDERS = {
  bomber: 'Vous voyez la bombe. Vous pouvez écrire et entendre. Vous ne voyez PAS le manuel — décrivez la bombe à vos coéquipiers !',
  expert: 'Vous avez le manuel. Vous NE POUVEZ PAS écrire du texte — utilisez les boutons de signaux. Écoutez le Démineur et le Relais, puis guidez-les.',
  relay: 'Vous n\'entendez pas (pas d\'audio). Vous pouvez écrire. Faites le lien entre le Démineur et l\'Expert.',
};

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function createRoom() {
  const name = document.getElementById('createName').value.trim();
  if (!name) { showError('Entrez votre pseudo.'); return; }
  socket.emit('createRoom', { name });
}

function joinRoom() {
  const name = document.getElementById('joinName').value.trim();
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  if (!name) { showError('Entrez votre pseudo.'); return; }
  if (!code) { showError('Entrez le code de la salle.'); return; }
  socket.emit('joinRoom', { roomId: code, name });
}

function copyCode() {
  navigator.clipboard?.writeText(myRoomId);
}

function onJoined(roomId, role, name) {
  myRoomId = roomId;
  myRole = role;
  document.getElementById('waitingRoom').classList.remove('hidden');
  document.getElementById('displayRoomCode').textContent = roomId;
  const roleEl = document.getElementById('myRole');
  roleEl.textContent = ROLE_LABELS[role] || role;
  roleEl.className = `role-tag ${role}`;
  const rem = document.getElementById('roleReminder');
  rem.textContent = ROLE_REMINDERS[role] || '';
  rem.className = `role-reminder ${role}`;
}

socket.on('roomCreated', ({ roomId, role, name }) => onJoined(roomId, role, name));
socket.on('roomJoined', ({ roomId, role, name }) => onJoined(roomId, role, name));

socket.on('playerList', (players) => {
  document.getElementById('playerCount').textContent = players.length;
  const list = document.getElementById('playerListDisplay');
  list.innerHTML = players.map(p =>
    `<div class="player-item"><span class="role-tag ${p.role}">${ROLE_LABELS[p.role] || p.role}</span> ${p.name}</div>`
  ).join('');
});

socket.on('gameStarted', () => {
  sessionStorage.setItem('roomId', myRoomId);
  sessionStorage.setItem('role', myRole);
  const name = document.getElementById('createName').value.trim() || document.getElementById('joinName').value.trim() || 'Joueur';
  sessionStorage.setItem('playerName', name);
  window.location.href = '/game.html';
});

socket.on('error', ({ message }) => showError(message));

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const joinCode = document.getElementById('joinCode');
    if (document.activeElement === joinCode || document.getElementById('joinName') === document.activeElement) {
      joinRoom();
    } else {
      createRoom();
    }
  }
});
