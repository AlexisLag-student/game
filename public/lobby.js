const socket = io();
let myRoomId = null, myRole = null;
const ROLE_LABELS = { bomber: 'DEMINEUR', expert: 'EXPERT', relay: 'RELAIS' };
const ROLE_REMINDERS = {
  bomber: 'Vous voyez la bombe. Vous pouvez ecrire et entendre. Vous ne voyez PAS le manuel - decrivez la bombe a vos coequipiers !',
  expert: 'Vous avez le manuel. Vous NE POUVEZ PAS ecrire du texte - utilisez les boutons de signaux. Ecoutez le Demineur, puis guidez-les.',
  relay: "Vous n'entendez pas (pas d'audio). Vous pouvez ecrire. Faites le lien entre le Demineur et l'Expert.",
};
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg; el.classList.remove('hidden');
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
  if (!code) { showError('Entrez le code.'); return; }
  socket.emit('joinRoom', { roomId: code, name });
}
function copyCode() { navigator.clipboard?.writeText(myRoomId); }
function onJoined(roomId, role) {
  myRoomId = roomId; myRole = role;
  document.getElementById('waitingRoom').classList.remove('hidden');
  document.getElementById('displayRoomCode').textContent = roomId;
  const roleEl = document.getElementById('myRole');
  roleEl.textContent = ROLE_LABELS[role] || role;
  roleEl.className = 'role-tag ' + role;
  const rem = document.getElementById('roleReminder');
  rem.textContent = ROLE_REMINDERS[role] || '';
  rem.className = 'role-reminder ' + role;
}
socket.on('roomCreated', ({ roomId, role }) => onJoined(roomId, role));
socket.on('roomJoined', ({ roomId, role }) => onJoined(roomId, role));
socket.on('playerList', (players) => {
  document.getElementById('playerCount').textContent = players.length;
  document.getElementById('playerListDisplay').innerHTML = players.map(p =>
    '<div class="player-item"><span class="role-tag ' + p.role + '">' + (ROLE_LABELS[p.role]||p.role) + '</span> ' + p.name + '</div>'
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
    if (['joinCode','joinName'].includes(document.activeElement?.id)) joinRoom();
    else createRoom();
  }
});
