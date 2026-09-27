const crypto = require('node:crypto');
const { publicState } = require('../server');

const roomKey = (code) => `gowar:room:${code}`;
const lockKey = (code) => `gowar:lock:${code}`;
const roomTtlSeconds = 60 * 60 * 24;
const releaseScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    const error = new Error('Room storage is not configured. Connect an Upstash Redis database to this Vercel project.');
    error.status = 503;
    throw error;
  }
  return { url: url.replace(/\/$/, ''), token };
}

async function redis(command) {
  const { url, token } = credentials();
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `Room storage returned ${response.status}.`);
  return data.result;
}

function send(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

function sendError(res, error) {
  send(res, error.status || 500, { error: error.message || 'The command could not be completed.' });
}

function method(req, res, expected) {
  if (req.method === expected) return true;
  res.setHeader('allow', expected);
  send(res, 405, { error: `Use ${expected} for this route.` });
  return false;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return req.body ? JSON.parse(req.body) : {}; }
    catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return req.body.length ? JSON.parse(req.body.toString('utf8')) : {}; }
    catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  try { return body ? JSON.parse(body) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

async function getRoom(code) {
  const raw = await redis(['GET', roomKey(code)]);
  if (!raw) throw Object.assign(new Error('Room not found or expired.'), { status: 404 });
  return JSON.parse(raw);
}

async function saveRoom(room) {
  await redis(['SET', roomKey(room.code), JSON.stringify(room), 'EX', String(roomTtlSeconds)]);
}

async function mutateRoom(code, mutate) {
  const key = lockKey(code);
  const token = crypto.randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await redis(['SET', key, token, 'NX', 'PX', '12000']);
    if (result === 'OK') { acquired = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 65));
  }
  if (!acquired) throw Object.assign(new Error('The room is busy. Please try that move again.'), { status: 409 });
  try {
    const room = await getRoom(code);
    const result = await mutate(room);
    await saveRoom(room);
    return result;
  } finally {
    await redis(['EVAL', releaseScript, '1', key, token]).catch(() => {});
  }
}

function playerOrError(room, id) {
  const player = room.players.find((item) => item.id === id);
  if (!player) throw Object.assign(new Error('You are not seated in this room.'), { status: 403 });
  return player;
}

module.exports = { getRoom, method, mutateRoom, playerOrError, readJson, redis, roomKey, saveRoom, send, sendError };
