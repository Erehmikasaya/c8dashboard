/**
 * POST /api/command — Submit a command from dashboard to VPS bot
 * GET  /api/command?id=xxx — Get command status/result
 * GET  /api/command?action=list — List recent commands
 * GET  /api/command?action=pending&vps=xxx — Get pending commands for VPS
 * Protected by Basic Auth (browser) + API Key (VPS bot polling).
 */
const {
  enqueueCommand, getCommand, getPendingCommands,
  updateCommandResult, addCommandProgress,
  getRecentCommands, markCommandCompleted,
} = require('./_store.js');

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

function checkApiKey(req) {
  const key = req.headers['x-api-key'] || '';
  const expected = process.env.API_KEY || 'c8bot-secret-key-change-me';
  return key === expected;
}

// Valid command types
const VALID_TYPES = [
  'withdraw', 'bot-control', 'config-change',
  'run-mode', 'consolidate', 'check-stuck', 'check-balance',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET: query commands ──
  if (req.method === 'GET') {
    // VPS bot polling uses API key, browser uses Basic Auth
    const hasApiKey = checkApiKey(req);
    if (!hasApiKey && !checkBasicAuth(req, res)) return;

    const { id, action, vps } = req.query || {};

    // Get single command by ID
    if (id) {
      const cmd = await getCommand(id);
      if (!cmd) return res.status(404).json({ error: 'Command not found' });
      return res.status(200).json(cmd);
    }

    // List pending commands (for VPS bot polling)
    if (action === 'pending') {
      const cmds = await getPendingCommands(vps || null);
      return res.status(200).json({ commands: cmds });
    }

    // List recent commands
    if (action === 'list') {
      const cmds = await getRecentCommands(20);
      return res.status(200).json({ commands: cmds });
    }

    return res.status(400).json({ error: 'Missing ?id=xxx or ?action=list|pending' });
  }

  // ── POST: submit new command ──
  if (req.method === 'POST') {
    if (!checkBasicAuth(req, res)) return;

    try {
      const data = req.body;
      if (!data || !data.type) {
        return res.status(400).json({ error: 'Missing command type' });
      }
      if (!VALID_TYPES.includes(data.type)) {
        return res.status(400).json({ error: `Invalid type. Valid: ${VALID_TYPES.join(', ')}` });
      }

      const cmd = await enqueueCommand({
        type: data.type,
        params: data.params || {},
        targetVps: data.targetVps || 'all',
        targetWallets: data.targetWallets || [],
      });

      return res.status(201).json({ ok: true, command: cmd });
    } catch (err) {
      console.error('[command] POST error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ── PUT: update command result (from VPS bot) ──
  if (req.method === 'PUT') {
    if (!checkApiKey(req)) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    try {
      const data = req.body;
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: 'Missing ?id=xxx' });

      if (data.progress) {
        await addCommandProgress(id, data.progress);
      }

      if (data.status || data.result) {
        const update = {};
        if (data.status) update.status = data.status;
        if (data.result) update.result = data.result;
        await updateCommandResult(id, update);

        if (data.status === 'completed' || data.status === 'failed') {
          await markCommandCompleted(id);
        }
      }

      const cmd = await getCommand(id);
      return res.status(200).json({ ok: true, command: cmd });
    } catch (err) {
      console.error('[command] PUT error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
