/**
 * POST /api/push — Receives data from VPS bots.
 * Validates X-API-Key header. ZERO crypto — never touches mnemonics.
 */
const { saveVpsPush } = require('./_store.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'] || '';
  const expectedKey = process.env.API_KEY || 'c8bot-secret-key-change-me';
  if (apiKey !== expectedKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  try {
    const data = req.body;
    const vpsId = data.vpsId || 'default';

    const safeAccounts = (data.accounts || []).map(a => ({
      name: a.name || '',
      cc: Number(a.cc) || 0,
      usdcx: Number(a.usdcx) || 0,
      ceth: Number(a.ceth) || 0,
      monthReward: Number(a.monthReward) || 0,
      monthVolume: Number(a.monthVolume) || 0,
      monthTxns: Number(a.monthTxns) || 0,
      totalReward: Number(a.totalReward) || 0,
      pendingReward: Number(a.pendingReward) || 0,
      claimedReward: Number(a.claimedReward) || 0,
      rank: Number(a.rank) || 0,
      status: String(a.status || 'idle').slice(0, 50),
      totalSwaps: Number(a.totalSwaps) || 0,
      diffReward: Number(a.diffReward) || 0,
      lastSwapDir: String(a.lastSwapDir || '').slice(0, 20),
      logs: (a.logs || []).slice(-5).map(l => String(l).slice(0, 200)),
      error: a.error ? String(a.error).slice(0, 200) : null,
    }));

    await saveVpsPush(vpsId, {
      accounts: safeAccounts,
      prices: data.prices || null,
      botUptime: Number(data.botUptime) || 0,
      totalAccounts: safeAccounts.length,
    });

    return res.status(200).json({ ok: true, received: safeAccounts.length, vpsId });
  } catch (err) {
    console.error('[push] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
