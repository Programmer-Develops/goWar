const { method, publicRealtimeConfig, send, sendError } = require('./_room-store');

module.exports = async function publicConfigRoute(req, res) {
  if (!method(req, res, 'GET')) return;
  try { send(res, 200, { realtime: await publicRealtimeConfig() }); }
  catch (error) { sendError(res, error); }
};
