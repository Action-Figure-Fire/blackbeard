#!/usr/bin/env node
/**
 * Blackbeard 🏴‍☠️ — Velocity Tracker
 * Takes weekly snapshots of artist metrics and calculates growth velocity.
 * 
 * Stored in data/velocity-snapshots.json:
 * {
 *   "Artist Name": {
 *     "snapshots": [
 *       { "date": "2026-03-10", "monthlyListeners": 5000000, "spotifyFollowers": 800000,
 *         "tiktokFollowers": 500000, "instagramFollowers": 200000, "youtubeSubscribers": 100000 }
 *     ],
 *     "velocity": {
 *       "listeners7d": 12.5,   // % change in 7 days
 *       "listeners30d": 45.2,  // % change in 30 days  
 *       "listeners90d": 200.0, // % change in 90 days
 *       "tiktok30d": 15.0,
 *       "instagram30d": 8.0,
 *       "overallVelocity": 65.2 // weighted composite
 *     }
 *   }
 * }
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    }
  }
} catch (e) {}

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'velocity-snapshots.json');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Blackbeard-Velocity/1.0', ...options.headers },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseNumber(str) {
  if (!str) return 0;
  str = str.toString().toLowerCase().replace(/,/g, '');
  const m = str.match(/([\d.]+)\s*(m|million|k|thousand|b|billion)?/i);
  if (!m) return 0;
  let num = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'm' || unit === 'million') num *= 1000000;
  else if (unit === 'k' || unit === 'thousand') num *= 1000;
  else if (unit === 'b' || unit === 'billion') num *= 1000000000;
  return Math.round(num);
}

function loadSnapshots() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch (e) { return {}; }
}

function saveSnapshots(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2));
}

// ---- Get current metrics for an artist ----

async function getArtistMetrics(artistName) {
  const metrics = {
    monthlyListeners: 0,
    spotifyFollowers: 0,
    tiktokFollowers: 0,
    instagramFollowers: 0,
    youtubeSubscribers: 0,
  };

  // SerpAPI for monthly listeners
  const serpKey = process.env.SERPAPI_KEY;
  if (serpKey) {
    try {
      const q = encodeURIComponent(`${artistName} spotify monthly listeners`);
      const url = `https://serpapi.com/search.json?engine=google&q=${q}&api_key=${serpKey}&num=5`;
      const res = await fetch(url);
      if (res.status === 200) {
        const data = JSON.parse(res.data);
        const combined = [
          JSON.stringify(data.knowledge_graph || {}),
          ...(data.organic_results || []).map(r => `${r.title} ${r.snippet || ''}`)
        ].join(' ');
        const mlMatch = combined.match(/(\d[\d,.]*)\s*(million|m|billion|b|k|thousand)?\s*monthly\s*listeners/i);
        if (mlMatch) metrics.monthlyListeners = parseNumber(mlMatch[1] + (mlMatch[2] || ''));
        const sfMatch = combined.match(/(\d[\d,.]*)\s*(million|m|k|thousand)?\s*(?:spotify\s*)?followers/i);
        if (sfMatch) metrics.spotifyFollowers = parseNumber(sfMatch[1] + (sfMatch[2] || ''));
      }
    } catch (e) {}
    await delay(300);
  }

  // Check existing data for social metrics we already have
  try {
    const rs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json'), 'utf8'));
    const match = (rs.artists || []).find(a => a.name?.toLowerCase() === artistName.toLowerCase());
    if (match) {
      if (match.tiktokFollowers > metrics.tiktokFollowers) metrics.tiktokFollowers = match.tiktokFollowers;
      if (match.instagramFollowers > metrics.instagramFollowers) metrics.instagramFollowers = match.instagramFollowers;
      if (match.youtubeSubscribers > metrics.youtubeSubscribers) metrics.youtubeSubscribers = match.youtubeSubscribers;
      if (match.spotifyFollowers > metrics.spotifyFollowers) metrics.spotifyFollowers = match.spotifyFollowers;
      if (match.monthlyListeners > metrics.monthlyListeners) metrics.monthlyListeners = match.monthlyListeners;
    }
  } catch (e) {}

  return metrics;
}

// ---- Calculate velocity from snapshots ----

function calculateVelocity(snapshots) {
  if (!snapshots || snapshots.length < 2) return null;

  const latest = snapshots[snapshots.length - 1];
  const now = new Date(latest.date);

  function findClosest(daysAgo) {
    const target = new Date(now.getTime() - daysAgo * 86400000);
    let best = null, bestDiff = Infinity;
    for (const s of snapshots) {
      const diff = Math.abs(new Date(s.date).getTime() - target.getTime());
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    // Only use if within 50% of target range
    if (bestDiff > daysAgo * 86400000 * 0.5) return null;
    return best;
  }

  function pctChange(oldVal, newVal) {
    if (!oldVal || oldVal === 0) return null;
    return ((newVal - oldVal) / oldVal) * 100;
  }

  const snap7 = findClosest(7);
  const snap30 = findClosest(30);
  const snap90 = findClosest(90);

  const velocity = {
    listeners7d: snap7 ? pctChange(snap7.monthlyListeners, latest.monthlyListeners) : null,
    listeners30d: snap30 ? pctChange(snap30.monthlyListeners, latest.monthlyListeners) : null,
    listeners90d: snap90 ? pctChange(snap90.monthlyListeners, latest.monthlyListeners) : null,
    tiktok30d: snap30 ? pctChange(snap30.tiktokFollowers, latest.tiktokFollowers) : null,
    instagram30d: snap30 ? pctChange(snap30.instagramFollowers, latest.instagramFollowers) : null,
    youtube30d: snap30 ? pctChange(snap30.youtubeSubscribers, latest.youtubeSubscribers) : null,
    spotify30d: snap30 ? pctChange(snap30.spotifyFollowers, latest.spotifyFollowers) : null,
  };

  // Composite velocity — weighted average of available signals
  const weights = [
    { val: velocity.listeners30d, w: 0.35 },  // Streaming growth = strongest signal
    { val: velocity.listeners90d, w: 0.20 },   // Longer trend
    { val: velocity.tiktok30d, w: 0.20 },      // TikTok growth = viral predictor
    { val: velocity.instagram30d, w: 0.10 },
    { val: velocity.spotify30d, w: 0.15 },      // Follower growth = committed fans
  ];

  let totalWeight = 0, weightedSum = 0;
  for (const { val, w } of weights) {
    if (val !== null) { weightedSum += val * w; totalWeight += w; }
  }
  velocity.overallVelocity = totalWeight > 0 ? weightedSum / totalWeight : null;

  return velocity;
}

// ---- Classify velocity into breakout stage ----

function classifyVelocity(velocity) {
  if (!velocity || velocity.overallVelocity === null) return { stage: 'INSUFFICIENT_DATA', emoji: '⬜' };

  const v = velocity.overallVelocity;
  const l90 = velocity.listeners90d;

  if (v >= 100 || (l90 && l90 >= 300)) {
    return { stage: 'EXPLOSIVE', emoji: '🚀', desc: 'Growth rate matches pre-breakout patterns' };
  } else if (v >= 50 || (l90 && l90 >= 150)) {
    return { stage: 'ACCELERATING', emoji: '⚡', desc: 'Rapid acceleration — watch closely' };
  } else if (v >= 20 || (l90 && l90 >= 50)) {
    return { stage: 'BUILDING', emoji: '📈', desc: 'Steady upward trajectory' };
  } else if (v >= 5) {
    return { stage: 'GROWING', emoji: '↗️', desc: 'Moderate growth' };
  } else if (v >= -5) {
    return { stage: 'STABLE', emoji: '➡️', desc: 'Flat — no momentum' };
  } else {
    return { stage: 'DECLINING', emoji: '📉', desc: 'Losing momentum' };
  }
}

// ---- Take snapshot for a list of artists ----

async function takeSnapshots(artistNames, options = {}) {
  const limit = options.limit || 30; // SerpAPI calls per run
  const db = loadSnapshots();
  const today = new Date().toISOString().split('T')[0];
  let apiCalls = 0;

  console.log(`📸 Velocity Tracker — Taking snapshots for ${artistNames.length} artists (limit: ${limit})`);

  for (const name of artistNames) {
    if (apiCalls >= limit) {
      console.log(`  ⚠️ API limit reached (${limit})`);
      break;
    }

    // Skip if already snapshotted today
    if (db[name]?.snapshots?.some(s => s.date === today)) {
      continue;
    }

    console.log(`  📊 ${name}...`);
    const metrics = await getArtistMetrics(name);
    apiCalls++;

    // Only save if we got meaningful data
    if (metrics.monthlyListeners > 0 || metrics.spotifyFollowers > 0) {
      if (!db[name]) db[name] = { snapshots: [] };

      db[name].snapshots.push({
        date: today,
        ...metrics,
      });

      // Keep max 52 snapshots (1 year of weekly)
      if (db[name].snapshots.length > 52) {
        db[name].snapshots = db[name].snapshots.slice(-52);
      }

      // Recalculate velocity
      db[name].velocity = calculateVelocity(db[name].snapshots);
      db[name].velocityStage = classifyVelocity(db[name].velocity);

      console.log(`     ${metrics.monthlyListeners > 0 ? (metrics.monthlyListeners/1e6).toFixed(1)+'M listeners' : 'no listener data'} | velocity: ${db[name].velocity?.overallVelocity?.toFixed(1) || 'n/a'}%`);
    }

    await delay(500);
  }

  saveSnapshots(db);
  console.log(`  ✅ ${apiCalls} API calls used, ${Object.keys(db).length} artists tracked`);
  return db;
}

// ---- Get velocity for prediction scoring ----

function getVelocityScore(artistName) {
  const db = loadSnapshots();
  const artist = db[artistName];
  if (!artist) return { score: 0, factors: [], velocity: null };

  const v = artist.velocity;
  if (!v) return { score: 0, factors: [], velocity: null };

  let score = 0;
  const factors = [];
  const stage = artist.velocityStage;

  // Listener velocity scoring
  if (v.listeners30d !== null) {
    if (v.listeners30d >= 50) { score += 15; factors.push(`🚀 Listeners up ${v.listeners30d.toFixed(0)}% in 30d — explosive`); }
    else if (v.listeners30d >= 20) { score += 10; factors.push(`⚡ Listeners up ${v.listeners30d.toFixed(0)}% in 30d — accelerating`); }
    else if (v.listeners30d >= 10) { score += 6; factors.push(`📈 Listeners up ${v.listeners30d.toFixed(0)}% in 30d`); }
    else if (v.listeners30d >= 5) { score += 3; factors.push(`↗️ Listeners up ${v.listeners30d.toFixed(0)}% in 30d`); }
    else if (v.listeners30d < -10) { score -= 5; factors.push(`📉 Listeners down ${v.listeners30d.toFixed(0)}% in 30d — cooling off`); }
  }

  // 90-day trend (longer arc)
  if (v.listeners90d !== null) {
    if (v.listeners90d >= 200) { score += 12; factors.push(`🔥 Listeners up ${v.listeners90d.toFixed(0)}% in 90d — breakout trajectory`); }
    else if (v.listeners90d >= 100) { score += 8; factors.push(`⚡ Listeners up ${v.listeners90d.toFixed(0)}% in 90d`); }
    else if (v.listeners90d >= 50) { score += 5; factors.push(`📈 Listeners up ${v.listeners90d.toFixed(0)}% in 90d`); }
  }

  // TikTok velocity (viral predictor)
  if (v.tiktok30d !== null) {
    if (v.tiktok30d >= 30) { score += 8; factors.push(`🎵 TikTok up ${v.tiktok30d.toFixed(0)}% in 30d — going viral`); }
    else if (v.tiktok30d >= 15) { score += 5; factors.push(`TikTok up ${v.tiktok30d.toFixed(0)}% in 30d`); }
  }

  // Spotify follower velocity (more meaningful than listeners — committed fans)
  if (v.spotify30d !== null) {
    if (v.spotify30d >= 20) { score += 6; factors.push(`Spotify followers up ${v.spotify30d.toFixed(0)}% in 30d — fan conversion`); }
    else if (v.spotify30d >= 10) { score += 3; factors.push(`Spotify followers up ${v.spotify30d.toFixed(0)}% in 30d`); }
  }

  return { score: Math.min(score, 30), factors, velocity: v, stage };
}

// ---- Discord formatting ----

function formatDiscordAlert(db) {
  const artists = Object.entries(db)
    .filter(([_, d]) => d.velocity?.overallVelocity !== null)
    .sort((a, b) => (b[1].velocity?.overallVelocity || 0) - (a[1].velocity?.overallVelocity || 0));

  if (artists.length === 0) return null;

  let msg = '📈 **VELOCITY TRACKER** 🏴‍☠️\n_Artist growth rates — who\'s accelerating?_\n\n';

  const explosive = artists.filter(([_, d]) => d.velocityStage?.stage === 'EXPLOSIVE');
  const accel = artists.filter(([_, d]) => d.velocityStage?.stage === 'ACCELERATING');
  const building = artists.filter(([_, d]) => d.velocityStage?.stage === 'BUILDING');

  if (explosive.length > 0) {
    msg += '**🚀 EXPLOSIVE GROWTH:**\n';
    for (const [name, d] of explosive) {
      msg += `• **${name}** — ${d.velocity.overallVelocity.toFixed(0)}% composite velocity`;
      if (d.velocity.listeners30d) msg += ` | listeners +${d.velocity.listeners30d.toFixed(0)}%/30d`;
      msg += '\n';
    }
    msg += '\n';
  }

  if (accel.length > 0) {
    msg += '**⚡ ACCELERATING:**\n';
    for (const [name, d] of accel.slice(0, 10)) {
      msg += `• **${name}** — ${d.velocity.overallVelocity.toFixed(0)}% velocity`;
      if (d.velocity.listeners30d) msg += ` | +${d.velocity.listeners30d.toFixed(0)}%/30d`;
      msg += '\n';
    }
    msg += '\n';
  }

  if (building.length > 0) {
    msg += '**📈 BUILDING:**\n';
    for (const [name, d] of building.slice(0, 10)) {
      msg += `• **${name}** — ${d.velocity.overallVelocity.toFixed(0)}% velocity\n`;
    }
  }

  return msg;
}

module.exports = { takeSnapshots, getVelocityScore, calculateVelocity, classifyVelocity, loadSnapshots, formatDiscordAlert };

// CLI
if (require.main === module) {
  // Load artist list from watchlist + rising stars
  const watchlist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'watchlist.json'), 'utf8'));
  const artistNames = watchlist.artists.map(a => a.name);
  
  const limit = parseInt(process.env.VELOCITY_LIMIT || '30');
  takeSnapshots(artistNames, { limit }).then(db => {
    const alert = formatDiscordAlert(db);
    if (alert) console.log('\n' + alert);
  }).catch(e => { console.error(e); process.exit(1); });
}
