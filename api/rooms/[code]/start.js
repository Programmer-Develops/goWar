const { playerFor, publicState, startGame } = require('../../../server');
const { method, mutateRoom, readJson, send, sendError } = require('../../_room-store');

module.exports = async function startRoomRoute(req, res) {
  if (!method(req, res, 'POST')) return;
  try {
    const body = await readJson(req);
    const code = String(req.query.code || '').toUpperCase();
    const state = await mutateRoom(code, (room) => {
      const player = playerFor(room, body.playerId);
      if (!player) throw Object.assign(new Error('You are not seated in this room.'), { status: 403 });
      if (body.playerId !== room.hostId) throw Object.assign(new Error('Only the room host can deploy the operation.'), { status: 403 });
      startGame(room);
      return publicState(room, body.playerId);
    });
    send(res, 200, { state });
  } catch (error) { sendError(res, error); }
};
