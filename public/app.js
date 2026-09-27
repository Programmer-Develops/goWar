const $ = (id) => document.getElementById(id);
const entry = $('entry');
const warRoom = $('war-room');
const storeKey = 'gowar-room-session-v1';
const orderCopy = {
  attack: 'Select one of your sectors, then a connected target.',
  reinforce: 'Select one of your sectors to add 3 troops.',
  rocket: 'Select an adjacent rival or neutral sector to strike.',
};
let session = null;
let game = null;
let sourceSelection = null;
let targetSelection = null;
let activeKind = 'attack';
let troopCount = 1;
let syncTimer = null;
let syncInFlight = false;
let toastTimer = null;

function showToast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}
function player(id) { return game?.players.find((p) => p.id === id); }
function me() { return player(session?.playerId); }
function sector(id) { return game?.sectors.find((s) => s.id === id); }
function isAdjacent(a, b) {
  return Boolean(game?.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a)));
}
function myNeighbors() {
  return game.sectors.filter((s) => s.owner === session.playerId).map((s) => s.id);
}
function adjacencyToOurGround(targetId) {
  return myNeighbors().some((id) => isAdjacent(id, targetId));
}
function persist() {
  if (session) localStorage.setItem(storeKey, JSON.stringify(session));
  else localStorage.removeItem(storeKey);
}
async function request(path, payload) {
  const response = await fetch(path, payload ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The command did not reach the room.');
  return data;
}
function setSession(result) {
  session = { code: result.state.code, playerId: result.playerId };
  game = result.state;
  persist();
  entry.classList.add('hidden');
  warRoom.classList.remove('hidden');
  connect();
  render();
}
function connect() {
  if (syncTimer) clearInterval(syncTimer);
  if (!session) return;
  refreshRoom();
  subscribeToRoomUpdates();
  syncTimer = setInterval(refreshRoom, 5000);
}
async function refreshRoom() {
  if (!session || syncInFlight || document.visibilityState === 'hidden') return;
  syncInFlight = true;
  try {
    const result = await request(`/api/rooms/${session.code}?playerId=${encodeURIComponent(session.playerId)}`);
    const priorPhase = game?.phase;
    const priorRound = game?.round;
    game = result.state;
    if (game.round !== priorRound || game.phase !== priorPhase) {
      sourceSelection = null;
      targetSelection = null;
      troopCount = 1;
    }
    render();
  } catch {
    // Keep the last state on screen during a brief network interruption.
  } finally {
    syncInFlight = false;
  }
}
function subscribeToRoomUpdates() {
  if (session && window.goWarRealtime) {
    window.goWarRealtime.subscribe(session.code, () => refreshRoom());
  }
}
function handleVisibility() {
  if (document.visibilityState === 'visible' && session) {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    connect();
  }
}
async function createRoom(event) {
  event.preventDefault();
  const name = $('create-name').value.trim();
  try { setSession(await request('/api/rooms', { name })); }
  catch (error) { showToast(error.message, true); }
}
async function joinRoom(event) {
  event.preventDefault();
  const name = $('join-name').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return showToast('Enter the five-character room code.', true);
  const previous = JSON.parse(localStorage.getItem(storeKey) || 'null');
  const playerId = previous?.code === code ? previous.playerId : undefined;
  try { setSession(await request(`/api/rooms/${code}/join`, { name, ...(playerId ? { playerId } : {}) })); }
  catch (error) { showToast(error.message, true); }
}
async function restoreRoom(saved) {
  try {
    const result = await request(`/api/rooms/${saved.code}?playerId=${encodeURIComponent(saved.playerId)}`);
    session = saved; game = result.state;
    entry.classList.add('hidden'); warRoom.classList.remove('hidden'); connect(); render();
  } catch {
    localStorage.removeItem(storeKey);
    showToast('That operation is no longer on the server. Create a new room to continue.', true);
  }
}
async function startOperation() {
  try { const result = await request(`/api/rooms/${session.code}/start`, { playerId: session.playerId }); game = result.state; render(); }
  catch (error) { $('lobby-hint').textContent = error.message; $('lobby-hint').classList.add('error'); }
}
async function lockOrder() {
  $('order-error').classList.add('hidden');
  let order;
  if (activeKind === 'attack') order = { kind: 'attack', source: sourceSelection, target: targetSelection, troops: troopCount };
  else if (activeKind === 'reinforce') order = { kind: 'reinforce', target: targetSelection };
  else order = { kind: 'rocket', target: targetSelection };
  try { const result = await request(`/api/rooms/${session.code}/order`, { playerId: session.playerId, order }); game = result.state; render(); }
  catch (error) { $('order-error').textContent = error.message; $('order-error').classList.remove('hidden'); }
}
function selectSector(id) {
  if (game.phase !== 'planning' || me()?.ready) return;
  const selected = sector(id);
  if (!selected) return;
  const own = selected.owner === session.playerId;
  if (activeKind === 'attack') {
    if (own) {
      sourceSelection = id;
      targetSelection = null;
      troopCount = Math.max(1, Math.min(troopCount, selected.troops - 1));
    } else if (!sourceSelection) {
      $('order-error').textContent = 'Choose your launch point first.';
      $('order-error').classList.remove('hidden');
    } else if (!isAdjacent(sourceSelection, id)) {
      $('order-error').textContent = 'Ground forces must attack a connected sector.';
      $('order-error').classList.remove('hidden');
    } else {
      targetSelection = id;
      $('order-error').classList.add('hidden');
    }
  } else if (activeKind === 'reinforce') {
    if (!own) {
      $('order-error').textContent = 'Choose a sector you control.';
      $('order-error').classList.remove('hidden');
    } else { targetSelection = id; $('order-error').classList.add('hidden'); }
  } else {
    if (own) {
      $('order-error').textContent = 'Rockets need an enemy or neutral target.';
      $('order-error').classList.remove('hidden');
    } else if (!adjacencyToOurGround(id)) {
      $('order-error').textContent = 'Rockets can only strike a sector beside your forces.';
      $('order-error').classList.remove('hidden');
    } else { targetSelection = id; $('order-error').classList.add('hidden'); }
  }
  renderMap();
  renderOrder();
}
function availableTargets() {
  if (!game) return new Set();
  if (activeKind === 'attack' && sourceSelection) return new Set(game.edges.filter(([a, b]) => a === sourceSelection || b === sourceSelection).map(([a, b]) => a === sourceSelection ? b : a));
  if (activeKind === 'rocket') return new Set(game.sectors.filter((s) => s.owner !== session.playerId && adjacencyToOurGround(s.id)).map((s) => s.id));
  if (activeKind === 'reinforce') return new Set(game.sectors.filter((s) => s.owner === session.playerId).map((s) => s.id));
  return new Set();
}
function render() {
  if (!game || !session) return;
  $('header-code').textContent = game.code;
  $('lobby-code').textContent = game.code;
  const isLobby = game.phase === 'lobby';
  $('lobby-view').classList.toggle('hidden', !isLobby);
  $('game-view').classList.toggle('hidden', isLobby);
  $('winner-banner').classList.toggle('hidden', !game.winner);
  $('room-context').childNodes[0].textContent = isLobby ? 'WAR ROOM ' : 'OPERATION ';
  if (isLobby) renderLobby(); else renderGame();
  if (game.winner) {
    $('winner-title').textContent = `${game.winner.name} takes the theatre.`;
    $('winner-reason').textContent = `Victory: ${game.winner.reason}.`;
  }
}
function renderLobby() {
  const self = me();
  const host = game.hostId === session.playerId;
  $('roster-count').textContent = `${String(game.players.length).padStart(2, '0')} / 08 SEATS`;
  const seats = [...game.players.map((p, i) => `<div class="lobby-player" style="--player-color:${p.color}"><span class="player-avatar" style="color:${p.color}">${escapeHtml(initials(p.name))}</span><span class="lobby-player-copy"><b>${escapeHtml(p.name)}${p.id === session.playerId ? ' <span style="display:inline;color:#a9e0bd">(you)</span>' : ''}</b><span>${p.id === game.hostId ? 'ROOM HOST' : `COMMANDER ${String(i + 1).padStart(2, '0')}`}</span></span>${p.id === game.hostId ? '<span class="host-mark">◈</span>' : ''}</div>`),
    ...Array.from({ length: Math.max(0, 8 - game.players.length) }, (_, i) => `<div class="lobby-empty"><span class="empty-plus">+</span><span>${game.players.length + i === 0 ? 'WAITING FOR COMMANDERS' : 'OPEN SEAT'} &nbsp;·&nbsp; ${String(game.players.length + i + 1).padStart(2, '0')}</span></div>`)].slice(0, 8);
  $('lobby-players').innerHTML = seats.join('');
  $('start-button').disabled = !host || game.players.length < 2;
  $('start-button').textContent = host ? (game.players.length < 2 ? 'Waiting for a commander' : 'Deploy operation   ↗') : 'Waiting for host';
  $('lobby-hint').classList.remove('error');
  $('lobby-hint').textContent = host ? (game.players.length < 2 ? 'Minimum 2 commanders required to deploy.' : `Ready to deploy with ${game.players.length} commander${game.players.length === 1 ? '' : 's'}.`) : `Room host ${escapeHtml(player(game.hostId)?.name || 'commander')} will deploy the operation.`;
  document.querySelector('.lobby-bottom p').innerHTML = `<span class="mini-lock">◈</span> Playing as ${escapeHtml(self?.name || 'commander')}. Your orders stay private.`;
}
function renderGame() {
  $('round-number').textContent = String(game.round).padStart(2, '0');
  $('order-round').textContent = `R.${String(game.round).padStart(2, '0')}`;
  $('phase-label').textContent = game.phase === 'finished' ? 'OPERATION OVER' : 'PLANNING PHASE';
  $('map-live-status').innerHTML = game.phase === 'finished' ? '<i class="tiny-dot"></i> OPERATION ENDED' : (me()?.ready ? '<i class="tiny-dot"></i> ORDER SEALED' : '<i class="tiny-dot"></i> ORDERS OPEN');
  $('player-state-label').textContent = me()?.ready ? 'SEALED' : (me()?.eliminated ? 'ELIMINATED' : 'PLANNING');
  $('player-state-label').classList.toggle('sealed', Boolean(me()?.ready || me()?.eliminated));
  $('self-card').innerHTML = `<span class="player-avatar" style="color:${me()?.color}">${escapeHtml(initials(me()?.name || 'You'))}</span><div><div class="self-name">${escapeHtml(me()?.name || 'Commander')} <span style="color:#a9e0bd;font-size:9px">· YOU</span></div><div class="self-label">COMMANDER&nbsp; / &nbsp;${me()?.eliminated ? 'FORCE LOST' : 'ACTIVE FORCE'}</div></div><span class="self-online">● LIVE</span>`;
  $('supply-count').textContent = String(me()?.supply ?? 0).padStart(2, '0');
  $('rocket-count').textContent = String(me()?.rockets ?? 0).padStart(2, '0');
  $('territory-count').textContent = String(game.sectors.filter((s) => s.owner === session.playerId).length).padStart(2, '0');
  $('commanders-count').textContent = `${game.players.length} SEATED`;
  renderMap();
  renderOrder();
  renderPlayers();
  renderEvents();
}
function renderMap() {
  if (!game || game.phase === 'lobby') return;
  const pos = new Map(game.sectors.map((s) => [s.id, s]));
  $('map-network').innerHTML = game.edges.map(([a, b]) => {
    const first = pos.get(a); const second = pos.get(b);
    return `<line class="map-edge" x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" />`;
  }).join('');
  const targets = availableTargets();
  $('sector-layer').innerHTML = game.sectors.map((s) => {
    const owner = player(s.owner);
    const own = s.owner === session.playerId;
    const status = owner ? (own ? 'YOUR FORCES' : escapeHtml(owner.name.toUpperCase())) : 'UNCLAIMED';
    const selected = [sourceSelection, targetSelection].includes(s.id);
    const source = s.id === sourceSelection;
    const base = s.baseFor ? '<span class="sector-base" title="Command base">★</span>' : '';
    const ownerColor = owner?.color || '#738276';
    const cls = ['sector', own ? 'owned-self owner-self' : s.owner ? 'owned-rival owner-rival' : 'neutral', selected ? 'selected' : '', source ? 'source-selected' : '', targets.has(s.id) && !own ? 'target-available' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-sector="${s.id}" style="left:${s.x}%;top:${s.y}%;--owner-color:${ownerColor}" aria-label="${s.name}, ${status}, ${s.troops} troops${s.baseFor ? ', command base' : ''}"><span class="sector-id">${s.id}</span><span class="sector-name">${escapeHtml(s.name)}</span><span class="sector-status">${status}${base}</span><span class="sector-troops">${s.troops}</span></button>`;
  }).join('');
  document.querySelectorAll('[data-sector]').forEach((button) => button.addEventListener('click', () => selectSector(button.dataset.sector)));
  if (activeKind === 'attack' && sourceSelection) {
    const sourceInfo = sector(sourceSelection);
    $('map-hint').innerHTML = `<span>↖</span> ${targetSelection ? 'TARGET SELECTED — READY TO LOCK' : `CHOOSE A NEIGHBOR OF ${escapeHtml(sourceInfo?.name.toUpperCase() || '')}`}`;
  } else $('map-hint').innerHTML = `<span>↖</span> ${me()?.ready ? 'YOUR ORDER IS SEALED' : 'SELECT A SECTOR TO ISSUE ORDERS'}`;
}
function renderOrder() {
  if (!game || game.phase === 'lobby') return;
  document.querySelectorAll('.order-type').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.kind === activeKind);
    tab.setAttribute('aria-selected', String(tab.dataset.kind === activeKind));
  });
  const locked = Boolean(me()?.ready) || game.phase !== 'planning' || me()?.eliminated;
  $('order-form-wrap').classList.toggle('hidden', locked);
  $('order-wait').classList.toggle('hidden', !locked);
  $('order-lock-state').classList.toggle('hidden', locked);
  if (locked) {
    $('order-wait-text').textContent = game.phase === 'finished' ? 'The campaign has concluded.' : me()?.eliminated ? 'Your forces have left the map.' : `${game.players.filter((p) => !p.eliminated && !p.ready).length} commander${game.players.filter((p) => !p.eliminated && !p.ready).length === 1 ? '' : 's'} still planning.`;
    return;
  }
  $('order-instructions').textContent = orderCopy[activeKind];
  $('order-error').classList.add('hidden');
  const summary = $('selection-summary');
  const from = sector(sourceSelection); const to = sector(targetSelection);
  summary.classList.toggle('has-selection', Boolean(from || to));
  if (activeKind === 'attack') {
    summary.innerHTML = from ? (to ? `<b>${escapeHtml(from.name)}</b> → <b>${escapeHtml(to.name)}</b>` : `<b>${escapeHtml(from.name)}</b> · choose a target`) : 'No sector selected';
    $('troop-control').classList.remove('hidden');
    const cap = Math.max(1, (from?.troops || 1) - 1);
    troopCount = Math.min(troopCount, cap);
    $('troop-count').textContent = String(troopCount).padStart(2, '0');
    $('troop-minus').disabled = troopCount <= 1;
    $('troop-plus').disabled = troopCount >= cap;
  } else if (activeKind === 'reinforce') {
    summary.innerHTML = to ? `<b>${escapeHtml(to.name)}</b> · +3 troops` : 'No sector selected';
    $('troop-control').classList.add('hidden');
  } else {
    summary.innerHTML = to ? `<b>${escapeHtml(to.name)}</b> · −2 defenders` : 'No sector selected';
    $('troop-control').classList.add('hidden');
  }
  $('submit-order').disabled = activeKind === 'attack' ? !(from && to) : !to;
}
function renderPlayers() {
  $('players-list').innerHTML = game.players.map((p) => {
    const status = p.eliminated ? 'eliminated' : p.ready ? 'order sealed' : 'planning';
    return `<div class="commander-row"><span class="player-avatar" style="color:${p.color}">${escapeHtml(initials(p.name))}</span><span class="commander-copy"><b>${escapeHtml(p.name)}${p.id === session.playerId ? ' · YOU' : ''}</b><small>${p.eliminated ? 'OUT OF THE WAR' : `${p.bases} BASE${p.bases === 1 ? '' : 'S'} · ${p.supply} SUPPLY`}</small></span><i class="commander-readiness ${p.ready ? 'ready' : ''} ${p.eliminated ? 'out' : ''}" title="${status}"></i></div>`;
  }).join('');
}
function renderEvents() {
  const recent = [...game.events].slice(-4).reverse();
  $('event-feed').innerHTML = recent.length ? recent.map((item) => `<span class="event-item" title="${escapeHtml(item.message)}"><i></i>${escapeHtml(item.message)}<time>R.${String(item.round).padStart(2, '0')}</time></span>`).join('') : '<span class="no-events">Awaiting first dispatch.</span>';
}
function setKind(kind) {
  activeKind = kind;
  sourceSelection = null;
  targetSelection = null;
  $('order-error').classList.add('hidden');
  renderMap(); renderOrder();
}
async function leaveRoom() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  window.goWarRealtime?.unsubscribe();
  session = null; game = null; persist();
  warRoom.classList.add('hidden'); entry.classList.remove('hidden');
}
async function copyCode() {
  try { await navigator.clipboard.writeText(game.code); showToast('Room code copied. Send it to your commanders.'); }
  catch { showToast(`Room code: ${game.code}`); }
}
function bindUI() {
  $('create-form').addEventListener('submit', createRoom);
  $('join-form').addEventListener('submit', joinRoom);
  $('join-code').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
  $('start-button').addEventListener('click', startOperation);
  $('room-code-copy').addEventListener('click', copyCode);
  $('leave-button').addEventListener('click', leaveRoom);
  $('new-room-button').addEventListener('click', leaveRoom);
  document.querySelectorAll('.order-type').forEach((button) => button.addEventListener('click', () => setKind(button.dataset.kind)));
  $('submit-order').addEventListener('click', lockOrder);
  $('troop-minus').addEventListener('click', () => { troopCount = Math.max(1, troopCount - 1); renderOrder(); });
  $('troop-plus').addEventListener('click', () => { troopCount += 1; renderOrder(); });
  $('center-map').addEventListener('click', () => { $('campaign-map').scrollIntoView({ behavior: 'smooth', block: 'center' }); showToast('Map centered on the theatre.'); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { sourceSelection = null; targetSelection = null; renderMap(); renderOrder(); }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.sector')) event.preventDefault();
  });
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('gowar-realtime-ready', subscribeToRoomUpdates);
}
bindUI();
const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
if (saved?.code && saved?.playerId) restoreRoom(saved);
