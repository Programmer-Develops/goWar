const tablePath = 'gowar_rooms';
const roomTtlMs = 24 * 60 * 60 * 1000;

function credentials(needsSecret = true) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || (needsSecret && !secret)) {
    const error = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in the Vercel project.');
    error.status = 503;
    throw error;
  }
  return { url: url.replace(/\/$/, ''), secret, publishable };
}

async function supabase(path, { method = 'GET', body, prefer } = {}) {
  const { url, secret } = credentials();
  const headers = {
    apikey: secret,
    authorization: `Bearer ${secret}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || `Supabase returned ${response.status}.`;
    const error = new Error(message);
    error.status = response.status === 401 || response.status === 403 ? 503 : response.status;
    error.databaseCode = data?.code;
    if (data?.code === 'PGRST205') error.message = 'Supabase table gowar_rooms is missing. Apply db/schema.sql in the Supabase SQL Editor.';
    throw error;
  }
  return data;
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
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    try { return req.body.length ? JSON.parse(String(req.body)) : {}; }
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

function queryString(values) {
  return new URLSearchParams(values).toString();
}

async function findRoom(code) {
  const query = queryString({ code: `eq.${code}`, select: 'state,revision,expires_at' });
  const rows = await supabase(`${tablePath}?${query}`);
  const row = rows?.[0];
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    throw Object.assign(new Error('Room not found or expired.'), { status: 404 });
  }
  return row;
}

async function getRoom(code) {
  const row = await findRoom(code);
  return row.state;
}

function announceUpdate(code, revision) {
  const { url, secret } = credentials();
  const endpoint = `${url}/realtime/v1/api/broadcast/gowar:${code}/events/state`;
  return fetch(endpoint, {
    method: 'POST',
    headers: { apikey: secret, authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ revision }),
  }).catch(() => {});
}

async function saveRoom(room) {
  const now = new Date();
  await supabase(tablePath, {
    method: 'POST',
    prefer: 'return=minimal',
    body: { code: room.code, state: room, revision: 1, updated_at: now.toISOString(), expires_at: new Date(now.getTime() + roomTtlMs).toISOString() },
  });
}

async function updateRoom(room, revision) {
  const now = new Date();
  const query = queryString({ code: `eq.${room.code}`, revision: `eq.${revision}` });
  const rows = await supabase(`${tablePath}?${query}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { state: room, revision: revision + 1, updated_at: now.toISOString(), expires_at: new Date(now.getTime() + roomTtlMs).toISOString() },
  });
  if (rows?.length) await announceUpdate(room.code, revision + 1);
  return Boolean(rows?.length);
}

async function cleanupExpiredRooms() {
  const query = queryString({ expires_at: `lt.${new Date().toISOString()}` });
  await supabase(`${tablePath}?${query}`, { method: 'DELETE', prefer: 'return=minimal' });
}

async function publicRealtimeConfig() {
  const { url, publishable } = credentials(false);
  return publishable ? { url, publishableKey: publishable } : null;
}

async function mutateRoom(code, mutate) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await findRoom(code);
    const room = current.state;
    const result = await mutate(room);
    if (await updateRoom(room, Number(current.revision))) return result;
    await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 15));
  }
  throw Object.assign(new Error('The room changed too quickly. Please try that move again.'), { status: 409 });
}

module.exports = { cleanupExpiredRooms, getRoom, method, mutateRoom, publicRealtimeConfig, readJson, saveRoom, send, sendError };
