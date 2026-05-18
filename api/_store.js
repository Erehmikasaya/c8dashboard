/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  Shared State Store                                 ║
 * ║  Mode 1: Upstash Redis (recommended, persistent)    ║
 * ║  Mode 2: In-memory fallback (works without Redis)   ║
 * ║  ZERO crypto — never touches mnemonics              ║
 * ╚══════════════════════════════════════════════════════╝
 */

// ── In-memory fallback (global — survives warm starts) ───────────────────
if (!globalThis.__c8store) {
  globalThis.__c8store = {
    vpsSources: {},
    prices: { ccUsd: 0, cethUsd: 0 },
    lastPush: null,
  };
}
const mem = globalThis.__c8store;

// ── Detect Redis availability ────────────────────────────────────────────
const HAS_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
let redis = null;

function getRedis() {
  if (redis) return redis;
  if (!HAS_REDIS) return null;
  try {
    // Use require for CJS compatibility with Vercel
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redis;
  } catch (e) {
    console.warn('[store] Redis init failed:', e.message);
    return null;
  }
}

const KEY_PREFIX = 'c8dash:';
const VPS_TTL = 300; // 5 minutes

// ── Redis helpers ────────────────────────────────────────────────────────
async function redisSet(key, value, ttl) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), { ex: ttl });
  } catch (e) {
    console.warn('[store] Redis SET failed:', e.message);
  }
}

async function redisGet(key) {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn('[store] Redis GET failed:', e.message);
    return null;
  }
}

async function redisSadd(key, member) {
  const r = getRedis();
  if (!r) return;
  try { await r.sadd(key, member); } catch { }
}

async function redisSmembers(key) {
  const r = getRedis();
  if (!r) return [];
  try { return await r.smembers(key) || []; } catch { return []; }
}

// ── Save VPS push data ──────────────────────────────────────────────────
async function saveVpsPush(vpsId, data) {
  const payload = {
    accounts: data.accounts || [],
    botUptime: data.botUptime || 0,
    lastPush: new Date().toISOString(),
    connected: true,
    totalAccounts: data.totalAccounts || 0,
  };

  // Always save to memory
  mem.vpsSources[vpsId] = payload;
  if (data.prices) mem.prices = data.prices;
  mem.lastPush = payload.lastPush;

  // Also save to Redis if available
  const r = getRedis();
  if (r) {
    await redisSet(`${KEY_PREFIX}vps:${vpsId}`, payload, VPS_TTL);
    await redisSadd(`${KEY_PREFIX}vps_ids`, vpsId);
    if (data.prices) {
      await redisSet(`${KEY_PREFIX}prices`, data.prices, 600);
    }
    await redisSet(`${KEY_PREFIX}lastPush`, payload.lastPush, VPS_TTL);
  }
}

// ── Get snapshot ────────────────────────────────────────────────────────
async function getSnapshot() {
  let allAccounts = [];
  let sources = [];
  let maxUptime = 0;
  let anyConnected = false;
  let prices = { ccUsd: 0, cethUsd: 0 };
  let lastPush = null;

  const r = getRedis();

  if (r) {
    // Try Redis first
    const vpsIds = await redisSmembers(`${KEY_PREFIX}vps_ids`);

    for (const vpsId of vpsIds) {
      const vps = await redisGet(`${KEY_PREFIX}vps:${vpsId}`);
      if (!vps) {
        sources.push({ id: vpsId, connected: false, accounts: 0, lastPush: null, uptime: 0 });
        continue;
      }
      const connected = !!vps.connected;
      if (connected) anyConnected = true;
      if (vps.botUptime > maxUptime) maxUptime = vps.botUptime;

      sources.push({
        id: vpsId, connected, accounts: (vps.accounts || []).length,
        lastPush: vps.lastPush, uptime: vps.botUptime || 0,
      });
      for (const a of (vps.accounts || [])) {
        allAccounts.push({ ...a, _vpsId: vpsId });
      }
    }

    const rPrices = await redisGet(`${KEY_PREFIX}prices`);
    if (rPrices) prices = rPrices;
    lastPush = await redisGet(`${KEY_PREFIX}lastPush`);
  }

  // Also merge memory data (covers warm-start data not in Redis)
  for (const [vpsId, vps] of Object.entries(mem.vpsSources)) {
    // Skip if already loaded from Redis
    if (r && sources.some(s => s.id === vpsId)) continue;

    const age = vps.lastPush ? (Date.now() - new Date(vps.lastPush).getTime()) / 1000 : Infinity;
    const connected = age < VPS_TTL;

    if (vps.botUptime > maxUptime) maxUptime = vps.botUptime;
    if (connected) anyConnected = true;

    sources.push({
      id: vpsId, connected, accounts: (vps.accounts || []).length,
      lastPush: vps.lastPush, uptime: vps.botUptime || 0,
    });
    for (const a of (vps.accounts || [])) {
      allAccounts.push({ ...a, _vpsId: vpsId });
    }
  }

  if (!r) {
    prices = mem.prices;
    lastPush = mem.lastPush;
  }

  // Build results
  const results = allAccounts.map(a => ({
    name: a.name,
    status: a.error ? 'error' : 'ok',
    cc: a.cc || 0,
    usdcx: a.usdcx || 0,
    ceth: a.ceth || 0,
    monthReward: a.monthReward || 0,
    monthVolume: a.monthVolume || 0,
    monthTxns: a.monthTxns || 0,
    totalReward: a.totalReward || 0,
    pendingReward: a.pendingReward || 0,
    claimedReward: a.claimedReward || 0,
    rank: a.rank || 0,
    delta: a.diffReward ?? null,
    lastMonthReward: a.lastMonthReward || 0,
    lastMonthVolume: a.lastMonthVolume || 0,
    lastMonthTxns: a.lastMonthTxns || 0,
    partyId: '',
    error: a.error || null,
    totalSwaps: a.totalSwaps || 0,
    lastSwapDir: a.lastSwapDir || '',
    botStatus: a.status || 'idle',
    logs: a.logs || [],
    vpsId: a._vpsId || '',
  }));

  return {
    running: false,
    done: results.length,
    total: allAccounts.length,
    results,
    prices,
    lastUpdate: lastPush,
    includeLastMonth: false,
    useProxy: false,
    proxyAvailable: false,
    accountCount: allAccounts.length,
    botConnected: anyConnected,
    botUptime: maxUptime,
    vpsSources: sources.length,
    sources,
    storeMode: r ? 'redis' : 'memory',
  };
}

// ── Health check ────────────────────────────────────────────────────────
async function getHealth() {
  const snapshot = await getSnapshot();
  return {
    status: 'ok',
    botConnected: snapshot.botConnected,
    lastPush: snapshot.lastUpdate,
    accounts: snapshot.accountCount,
    vpsSources: snapshot.vpsSources,
    storeMode: getRedis() ? 'redis' : 'memory',
  };
}

module.exports = { saveVpsPush, getSnapshot, getHealth };
