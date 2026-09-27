const { createRoom, publicState } = require('../../server');
const { method, readJson, saveRoom, send, sendError, redis } = require('../_room-store');

module.exports = async function createRoomRoute(req, res) {
  if (!method(req, res, 'POST')) return;
  try {
    const body = await readJson(req);
    let created;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = createRoom(body.name);
      if (await redis(['GET', `gowar:room:${candidate.room.code}`])) continue;
      created = candidate;
      break;
    }
    if (!created) throw Object.assign(new Error('Could not reserve a room code. Try again.'), { status: 503 });
    await saveRoom(created.room);
    send(res, 201, { state: publicState(created.room, created.player.id), playerId: created.player.id });
  } catch (error) { sendError(res, error); }
};
