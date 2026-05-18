/**
 * GET /api/stream — Polling endpoint (SSE not supported on serverless).
 */
const { getSnapshot } = require('./_store.js');

function checkBasicAuth(req, res) {
  const user = process.env.BASIC_USER || '';
  const pass = process.env.BASIC_PASS || '';
  if (!user || !pass) return true;
  const auth = req.headers['authorization'] || '';
  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  if (auth === expected) return true;
  res.setHeader('WWW-Authenticate', 'Basic realm="C8 Dashboard", charset="UTF-8"');
  res.status(401).end('Unauthorized');
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkBasicAuth(req, res)) return;
  try {
    const snapshot = await getSnapshot();
    res.setHeader('Cache-Control', 'no-cache, no-store');
    return res.status(200).json(snapshot);
  } catch (err) {
    console.error('[stream] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
