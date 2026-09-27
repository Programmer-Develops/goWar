const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const STATIC_ROOT = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const streams = new Map();
const COLORS = ['#9be7c1', '#e5ac69', '#8cb8ed', '#da91a0', '#be9ced', '#e8d37b', '#74d0d0', '#ef9874'];
const SECTORS = [
  { id: '01', name: 'Northwatch', x: 18, y: 18, type: 'highland' },
  { id: '02', name: 'Old Harbor', x: 43, y: 12, type: 'port' },
  { id: '03', name: 'Glassfield', x: 70, y: 21, type: 'plain' },
  { id: '04', name: 'Iron Pass', x: 88, y: 37, type: 'highland' },
  { id: '05', name: 'Redwater', x: 72, y: 46, type: 'port' },
  { id: '06', name: 'Cinder Vale', x: 48, y: 36, type: 'plain' },
  { id: '07', name: 'Eastreach', x: 28, y: 47, type: 'plain' },
  { id: '08', name: 'Blackridge', x: 10, y: 57, type: 'highland' },
  { id: '09', name: 'Sunken Coast', x: 21, y: 82, type: 'port' },
  { id: '10', name: 'Ashen Gate', x: 49, y: 70, type: 'highland' },
  { id: '11', name: 'Last Light', x: 77, y: 82, type: 'plain' },
  { id: '12', name: 'Driftwood', x: 91, y: 63, type: 'port' },
  { id: '13', name: 'Midland', x: 55, y: 53, type: 'plain' },
  { id: '14', name: "Warden's Rest", x: 36, y: 89, type: 'highland' },
  { id: '15', name: 'Morrow Bay', x: 87, y: 9, type: 'port' },
  { id: '16', name: 'Southline', x: 7, y: 34, type: 'plain' },
];
const EDGES = [['01','02'],['02','03'],['03','04'],['04','05'],['05','06'],['06','07'],['07','08'],['08','16'],['16','01'],['08','09'],['09','14'],['14','10'],['10','11'],['11','12'],['12','05'],['06','13'],['13','10'],['13','05'],['02','06'],['03','15'],['15','04'],['07','13'],['09','10'],['12','13']];
const HOME_SECTORS = ['01', '05', '09', '12', '03', '16', '14', '08'];

function safeName(value) {
  const name = String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
  return name || 'Commander';
}
function newId() { return crypto.randomBytes(12).toString('hex'); }
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}
function playerFor(room, id) { return room.players.find((p) => p.id === id); }
function publicState(room, playerId) {
  const me = playerFor(room, playerId);
  const orders = room.orders || {};
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    createdAt: room.createdAt,
    winner: room.winner || null,
    players: room.players.map((p) => ({ id: p.id, name: p.name, color: p.color, online: p.online, ready: Boolean(orders[p.id]), eliminated: p.eliminated, bases: room.sectors.filter((s) => s.baseFor === p.id && s.owner === p.id).length, supply: p.supply, rockets: p.rockets })),
    sectors: room.sectors.map((s) => ({ ...s })),
    edges: EDGES,
    myPlayerId: me?.id || null,
    myOrder: me ? orders[me.id] || null : null,
    events: room.events.slice(-8),
  };
}
function publish(room) {
  const watchers = streams.get(room.code);
  if (!watchers) return;
  for (const watcher of watchers) {
    if (!playerFor(room, watcher.playerId)) continue;
    watcher.res.write(`event: state\ndata: ${JSON.stringify(publicState(room, watcher.playerId))}\n\n`);
  }
}
function log(room, message) {
  room.events.push({ id: newId().slice(0, 8), round: room.round, time: Date.now(), message });
  room.events = room.events.slice(-30);
}
function addPlayer(room, name, id) {
  const existing = playerFor(room, id);
  if (existing) { existing.online = true; existing.name = safeName(name || existing.name); return existing; }
  if (room.players.length >= 8) throw new Error('This room is full.');
  if (room.phase !== 'lobby') throw new Error('This war room is already in progress.');
  const player = { id, name: safeName(name), color: COLORS[room.players.length], online: true, eliminated: false, supply: 3, rockets: 2, score: 0 };
  room.players.push(player);
  if (room.players.length === 1) room.hostId = id;
  log(room, `${player.name} joined the command room.`);
  return player;
}
function createRoom(name, playerId = newId(), code = newCode()) {
  const room = { code, hostId: playerId, phase: 'lobby', round: 0, createdAt: Date.now(), players: [], sectors: SECTORS.map((s) => ({ ...s, owner: null, baseFor: null, troops: 0 })), orders: {}, events: [] };
  const player = addPlayer(room, name, playerId);
  return { room, player };
}
function startGame(room) {
  if (room.players.length < 2) throw new Error('Invite at least one other commander to deploy.');
  if (room.phase !== 'lobby') throw new Error('This operation has already started.');
  room.phase = 'planning';
  room.round = 1;
  room.players.forEach((p, i) => {
    p.supply = 3;
    p.rockets = 2;
    const home = room.sectors.find((s) => s.id === HOME_SECTORS[i]);
    home.owner = p.id;
    home.baseFor = p.id;
    home.troops = 5;
  });
  room.sectors.forEach((s, i) => { if (!s.owner) s.troops = i % 3 === 0 ? 2 : 1; });
  log(room, 'Operation Iron Veil has begun. Issue one sealed order this round.');
  publish(room);
}
function ownsAdjacent(room, playerId, sectorId) {
  const neighbors = EDGES.filter(([a, b]) => a === sectorId || b === sectorId).map(([a, b]) => a === sectorId ? b : a);
  return neighbors.some((id) => room.sectors.find((s) => s.id === id)?.owner === playerId);
}
function validateOrder(room, player, order) {
  if (!order || typeof order !== 'object') throw new Error('Choose an order before locking it in.');
  const sector = (id) => room.sectors.find((s) => s.id === String(id));
  if (order.kind === 'pass') return { kind: 'pass' };
  if (order.kind === 'reinforce') {
    const target = sector(order.target);
    if (!target || target.owner !== player.id) throw new Error('Reinforcements must go to one of your sectors.');
    if (player.supply < 1) throw new Error('You need one supply to reinforce.');
    return { kind: 'reinforce', target: target.id };
  }
  if (order.kind === 'rocket') {
    const target = sector(order.target);
    if (!target || target.owner === player.id) throw new Error('Choose a sector outside your control.');
    if (!ownsAdjacent(room, player.id, target.id)) throw new Error('Rockets can only strike an adjacent sector.');
    if (player.rockets < 1) throw new Error('No rockets remain in your arsenal.');
    return { kind: 'rocket', target: target.id };
  }
  if (order.kind === 'attack') {
    const source = sector(order.source); const target = sector(order.target);
    const count = Math.floor(Number(order.troops));
    if (!source || source.owner !== player.id) throw new Error('Choose a sector you control as the launch point.');
    if (!target || target.owner === player.id) throw new Error('Choose a sector outside your control.');
    if (!EDGES.some(([a, b]) => (a === source.id && b === target.id) || (b === source.id && a === target.id))) throw new Error('Ground forces must attack an adjacent sector.');
    if (!Number.isFinite(count) || count < 1 || count > source.troops - 1) throw new Error('Leave at least one troop defending the launch point.');
    return { kind: 'attack', source: source.id, target: target.id, troops: count };
  }
  throw new Error('Unknown order type.');
}
function resolveRound(room) {
  const orders = room.orders;
  const livePlayers = room.players.filter((p) => !p.eliminated);
  const priority = Array.from({ length: room.players.length }, (_, offset) => room.players[(room.round - 1 + offset) % room.players.length]).filter((p) => !p.eliminated);
  const orderLines = [];
  // Rockets land first, then ground operations are resolved in seat order.
  for (const p of priority) {
    const order = orders[p.id];
    if (order?.kind !== 'rocket') continue;
    const target = room.sectors.find((s) => s.id === order.target);
    if (target && target.owner !== p.id) {
      target.troops = Math.max(0, target.troops - 2);
      p.rockets = Math.max(0, p.rockets - 1);
      orderLines.push(`${p.name} launched a rocket at ${target.name}.`);
    }
  }
  for (const p of priority) {
    const order = orders[p.id];
    if (!order) continue;
    if (order.kind === 'reinforce') {
      const target = room.sectors.find((s) => s.id === order.target);
      if (target?.owner === p.id && p.supply > 0) { target.troops += 3; p.supply -= 1; orderLines.push(`${p.name} reinforced ${target.name} (+3).`); }
    }
  }
  const attacks = priority.map((p) => ({ player: p, order: orders[p.id] })).filter((x) => x.order?.kind === 'attack');
  for (const { player: p, order } of attacks) {
    const source = room.sectors.find((s) => s.id === order.source);
    const target = room.sectors.find((s) => s.id === order.target);
    if (!source || source.owner !== p.id || source.troops <= order.troops || !target || target.owner === p.id) continue;
    source.troops -= order.troops;
    const defendingPlayer = room.players.find((x) => x.id === target.owner);
    const defenders = target.troops;
    if (order.troops > defenders) {
      const previous = defendingPlayer?.name || 'neutral forces';
      target.owner = p.id;
      target.troops = Math.max(1, order.troops - defenders);
      orderLines.push(`${p.name} captured ${target.name} from ${previous}.`);
    } else {
      target.troops = Math.max(1, defenders - order.troops);
      orderLines.push(`${p.name} struck ${target.name}; defenders held.`);
    }
  }
  // Income is awarded for territory held at the start of the next planning phase.
  for (const p of livePlayers) {
    const controlled = room.sectors.filter((s) => s.owner === p.id);
    if (!controlled.length) {
      p.eliminated = true;
      orderLines.push(`${p.name} has lost all territory and is out of the war.`);
      continue;
    }
    p.supply = Math.min(6, p.supply + Math.max(1, Math.floor(controlled.length / 3)));
    if (controlled.some((s) => s.type === 'port')) p.rockets = Math.min(4, p.rockets + 1);
  }
  const active = room.players.filter((p) => !p.eliminated);
  const baseCounts = new Map(active.map((p) => [p.id, room.sectors.filter((s) => s.baseFor && s.owner === p.id).length]));
  const majority = Math.floor(room.players.length / 2) + 1;
  const leading = active.find((p) => (baseCounts.get(p.id) || 0) >= majority);
  if (leading) {
    room.phase = 'finished';
    room.winner = { id: leading.id, name: leading.name, reason: `secured ${baseCounts.get(leading.id)} command bases` };
  } else if (active.length === 1) {
    room.phase = 'finished';
    room.winner = { id: active[0].id, name: active[0].name, reason: 'last force standing' };
  } else {
    room.round += 1;
    room.orders = {};
  }
  log(room, `Round ${room.round - (room.phase === 'planning' ? 1 : 0)} resolved.`);
  orderLines.forEach((line) => log(room, line));
  publish(room);
}
function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 100_000) throw new Error('Request is too large.'); }
  return body ? JSON.parse(body) : {};
}
function mime(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' })[path.extname(file)] || 'application/octet-stream';
}
const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const body = await readBody(req); const { room, player } = createRoom(body.name);
      rooms.set(room.code, room); publish(room);
      return sendJson(res, 201, { state: publicState(room, player.id), playerId: player.id });
    }
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const room = rooms.get(joinMatch[1]); if (!room) return sendJson(res, 404, { error: 'No room found with that code.' });
      const body = await readBody(req); const playerId = body.playerId || newId();
      const player = addPlayer(room, body.name, playerId); publish(room);
      return sendJson(res, 200, { state: publicState(room, player.id), playerId });
    }
    const startMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/start$/);
    if (req.method === 'POST' && startMatch) {
      const room = rooms.get(startMatch[1]); if (!room) return sendJson(res, 404, { error: 'Room not found.' });
      const body = await readBody(req); if (body.playerId !== room.hostId) return sendJson(res, 403, { error: 'Only the room host can deploy the operation.' });
      startGame(room); return sendJson(res, 200, { state: publicState(room, body.playerId) });
    }
    const orderMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/order$/);
    if (req.method === 'POST' && orderMatch) {
      const room = rooms.get(orderMatch[1]); if (!room) return sendJson(res, 404, { error: 'Room not found.' });
      const body = await readBody(req); const player = playerFor(room, body.playerId);
      if (!player) return sendJson(res, 403, { error: 'You are not seated in this room.' });
      if (player.eliminated) return sendJson(res, 403, { error: 'Your force has been eliminated.' });
      if (room.phase !== 'planning') return sendJson(res, 409, { error: 'The operation is not accepting orders.' });
      if (room.orders[player.id]) return sendJson(res, 409, { error: 'Your order is already locked for this round.' });
      try { room.orders[player.id] = validateOrder(room, player, body.order); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      if (room.players.filter((p) => !p.eliminated).every((p) => room.orders[p.id])) resolveRound(room); else publish(room);
      return sendJson(res, 200, { state: publicState(room, player.id) });
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
    if (req.method === 'GET' && roomMatch) {
      const room = rooms.get(roomMatch[1]); if (!room) return sendJson(res, 404, { error: 'Room not found or game server restarted.' });
      const reconnectingPlayer = playerFor(room, url.searchParams.get('playerId'));
      if (reconnectingPlayer) { reconnectingPlayer.online = true; publish(room); }
      return sendJson(res, 200, { state: publicState(room, url.searchParams.get('playerId')) });
    }
    const streamMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/events$/);
    if (req.method === 'GET' && streamMatch) {
      const room = rooms.get(streamMatch[1]); const playerId = url.searchParams.get('playerId');
      if (!room || !playerFor(room, playerId)) return sendJson(res, 404, { error: 'Room not found or player is not seated.' });
      const connectedPlayer = playerFor(room, playerId);
      connectedPlayer.online = true;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      res.write(`event: state\ndata: ${JSON.stringify(publicState(room, playerId))}\n\n`);
      const list = streams.get(room.code) || new Set(); const watcher = { res, playerId }; list.add(watcher); streams.set(room.code, list);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
      res.on('close', () => { clearInterval(keepAlive); list.delete(watcher); if (!list.size) streams.delete(room.code); const p = playerFor(room, playerId); if (p) p.online = false; publish(room); });
      return;
    }
    const requested = path.normalize(path.join(STATIC_ROOT, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname)));
    const relative = path.relative(STATIC_ROOT, requested);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return sendJson(res, 403, { error: 'Forbidden.' });
    fs.readFile(requested, (error, data) => {
      if (error) return sendJson(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'content-type': mime(requested), 'cache-control': 'no-cache' }); res.end(data);
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message || 'Request failed.' });
  }
});
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`goWar command server listening on http://localhost:${PORT}`));
}

module.exports = { addPlayer, createRoom, log, newCode, newId, playerFor, publicState, resolveRound, startGame, validateOrder };
