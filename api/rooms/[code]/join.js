const { addPlayer, newId, publicState } = require('../../../server');
const { getRoom, method, mutateRoom, readJson, send, sendError } = require('../../_room-store');

module.exports = async function joinRoomRoute(req, res) {
  if (!method(req, res, 'POST')) return;
  try {
    const body = await readJson(req);
    const code = String(req.query.code || '').toUpperCase();
    const playerId = body.playerId || newId();
    const state = await mutateRoom(code, (room) => {
      const player = addPlayer(room, body.name, playerId);
      return publicState(room, player.id);
    });
    send(res, 200, { state, playerId });
  } catch (error) { sendError(res, error); }
};
