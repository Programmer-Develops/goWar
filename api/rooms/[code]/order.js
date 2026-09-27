const { playerFor, publicState, resolveRound, validateOrder } = require('../../../server');
const { method, mutateRoom, readJson, send, sendError } = require('../../_room-store');

module.exports = async function orderRoomRoute(req, res) {
  if (!method(req, res, 'POST')) return;
  try {
    const body = await readJson(req);
    const code = String(req.query.code || '').toUpperCase();
    const state = await mutateRoom(code, (room) => {
      const player = playerFor(room, body.playerId);
      if (!player) throw Object.assign(new Error('You are not seated in this room.'), { status: 403 });
      if (player.eliminated) throw Object.assign(new Error('Your force has been eliminated.'), { status: 403 });
      if (room.phase !== 'planning') throw Object.assign(new Error('The operation is not accepting orders.'), { status: 409 });
      if (room.orders[player.id]) throw Object.assign(new Error('Your order is already locked for this round.'), { status: 409 });
      try { room.orders[player.id] = validateOrder(room, player, body.order); }
      catch (error) { throw Object.assign(error, { status: 400 }); }
      if (room.players.filter((item) => !item.eliminated).every((item) => room.orders[item.id])) resolveRound(room);
      return publicState(room, player.id);
    });
    send(res, 200, { state });
  } catch (error) { sendError(res, error); }
};
