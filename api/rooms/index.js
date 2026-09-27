const { createRoom, publicState } = require('../../server');
const { cleanupExpiredRooms, method, readJson, saveRoom, send, sendError } = require('../_room-store');

module.exports = async function createRoomRoute(req, res) {
  if (!method(req, res, 'POST')) return;
  try {
    const body = await readJson(req);
    await cleanupExpiredRooms();
    let created;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = createRoom(body.name);
      try {
        await saveRoom(candidate.room);
        created = candidate;
        break;
      } catch (error) {
        if (error.databaseCode === '23505' || error.status === 409) continue;
        throw error;
      }
    }
    if (!created) throw Object.assign(new Error('Could not reserve a room code. Try again.'), { status: 503 });
    send(res, 201, { state: publicState(created.room, created.player.id), playerId: created.player.id });
  } catch (error) { sendError(res, error); }
};
