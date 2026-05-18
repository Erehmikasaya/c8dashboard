/**
 * GET /health — Public health check, no auth required.
 */
const { getHealth } = require('./_store.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const health = await getHealth();
    return res.status(200).json(health);
  } catch (err) {
    console.error('[health] Error:', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
};
