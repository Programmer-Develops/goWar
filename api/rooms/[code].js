const { publicState, playerFor } = require('../../server');
const { getRoom, method, send, sendError } = require('../_room-store');

module.exports = async function getRoomRoute(req, res) {
  if (!method(req, res, 'GET')) return;
  try {
    const code = String(req.query.code || '').toUpperCase();
    const room = await getRoom(code);
    const playerId = String(req.query.playerId || '');
    if (playerId && !playerFor(room, playerId)) throw Object.assign(new Error('You are not seated in this room.'), { status: 403 });
    send(res, 200, { state: publicState(room, playerId) });
  } catch (error) { sendError(res, error); }
};
