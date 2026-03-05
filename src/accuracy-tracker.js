#!/usr/bin/env node
/**
 * Blackbeard Accuracy Tracker v1.0
 * 
 * Logs every RED HOT / WARM pick with timestamp + initial data.
 * On subsequent runs, checks back on previous picks to see if:
 * - Price went UP (we were right — ticket demand confirmed)
 * - Price went DOWN (we were wrong — overhyped)
 * - Shows sold out (ultimate confirmation)
 * - Shows added dates (demand signal confirmed)
 * 
 * This builds our track record for monetization.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKER_FILE = path.join(DATA_DIR, 'accuracy-tracker.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadTracker() {
  try { return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8')); }
  catch { return { picks: [], stats: { total: 0, confirmed: 0, busted: 0, pending: 0 } }; }
}

function saveTracker(t) {
  // Recalculate stats
  t.stats = {
    total: t.picks.length,
    confirmed: t.picks.filter(p => p.outcome === 'confirmed').length,
    busted: t.picks.filter(p => p.outcome === 'busted').length,
    pending: t.picks.filter(p => p.outcome === 'pending').length,
    hitRate: null
  };
  const decided = t.stats.confirmed + t.stats.busted;
  if (decided > 0) t.stats.hitRate = Math.round(t.stats.confirmed / decided * 100);
  t.lastUpdated = new Date().toISOString();
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(t, null, 2));
}

// Log a new pick
function logPick(tracker, pick) {
  // Dedupe by name + date
  const existing = tracker.picks.find(p => 
    p.name.toLowerCase() === pick.name.toLowerCase() && 
    Math.abs(new Date(p.pickedAt) - new Date()) < 7 * 24 * 60 * 60 * 1000
  );
  if (existing) return; // Already tracked this week
  
  tracker.picks.push({
    name: pick.name,
    tier: pick.vetTier,
    vetScore: pick.vetScore,
    pickedAt: new Date().toISOString(),
    initialData: {
      monthlyListeners: pick.monthlyListeners,
      soldOutMentions: pick.soldOutMentions,
      upcomingShows: pick.upcomingShows,
      avgGetIn: pick.pricingSignal?.avgGetIn || null,
      playlists: pick.playlistCount || 0,
      signals: (pick.vetSignals || []).slice(0, 5)
    },
    checkHistory: [],
    outcome: 'pending', // pending | confirmed | busted
    outcomeReason: null,
    daysToOutcome: null
  });
}

// Check back on a pick
async function checkPick(pick) {
  const daysSincePick = (Date.now() - new Date(pick.pickedAt).getTime()) / (1000 * 60 * 60 * 24);
  
  // Don't check too frequently (every 3+ days) or if already decided
  if (pick.outcome !== 'pending') return pick;
  const lastCheck = pick.checkHistory[pick.checkHistory.length - 1];
  if (lastCheck) {
    const daysSinceCheck = (Date.now() - new Date(lastCheck.checkedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCheck < 3) return pick;
  }
  
  // Check SeatGeek for current pricing
  let currentAvgGetIn = null;
  let currentShows = 0;
  try {
    const r = await fetch(`https://api.seatgeek.com/2/events?q=${encodeURIComponent(pick.name)}&per_page=10&datetime_utc.gte=${new Date().toISOString().split('T')[0]}&client_id=${SEATGEEK_CLIENT_ID}`);
    const j = await r.json();
    currentShows = j.events?.length || 0;
    const prices = (j.events || [])
      .map(e => e.stats?.lowest_sg_base_price || e.stats?.lowest_price)
      .filter(Boolean);
    if (prices.length) currentAvgGetIn = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  } catch {}
  
  // Check Brave for sold-out news
  let newSoldOuts = 0;
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`"${pick.name}" "sold out" 2026`)}&count=5`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    });
    const j = await r.json();
    newSoldOuts = (j.web?.results || []).filter(r => 
      /sold.out|sell.out/i.test(`${r.title} ${r.description}`)
    ).length;
  } catch {}
  await sleep(300);
  
  const check = {
    checkedAt: new Date().toISOString(),
    daysSincePick: Math.round(daysSincePick),
    currentAvgGetIn,
    currentShows,
    soldOutMentions: newSoldOuts,
    initialAvgGetIn: pick.initialData.avgGetIn
  };
  
  // Determine price movement
  if (pick.initialData.avgGetIn && currentAvgGetIn) {
    check.priceChange = currentAvgGetIn - pick.initialData.avgGetIn;
    check.priceChangePercent = Math.round((check.priceChange / pick.initialData.avgGetIn) * 100);
  }
  
  pick.checkHistory.push(check);
  
  // Outcome determination
  // CONFIRMED: price went up 20%+, OR new sold-outs, OR shows added
  if (check.priceChangePercent >= 20) {
    pick.outcome = 'confirmed';
    pick.outcomeReason = `Price up ${check.priceChangePercent}% ($${pick.initialData.avgGetIn} → $${currentAvgGetIn})`;
    pick.daysToOutcome = Math.round(daysSincePick);
  } else if (newSoldOuts > (pick.initialData.soldOutMentions || 0) + 1) {
    pick.outcome = 'confirmed';
    pick.outcomeReason = `New sold-out mentions: ${newSoldOuts} (was ${pick.initialData.soldOutMentions || 0})`;
    pick.daysToOutcome = Math.round(daysSincePick);
  } else if (currentShows > (pick.initialData.upcomingShows || 0) + 3) {
    pick.outcome = 'confirmed';
    pick.outcomeReason = `Shows added: ${currentShows} (was ${pick.initialData.upcomingShows || 0}) — demand signal`;
    pick.daysToOutcome = Math.round(daysSincePick);
  }
  // BUSTED: 30+ days and price dropped 20%+ with no sold-outs
  else if (daysSincePick >= 30 && check.priceChangePercent <= -20 && newSoldOuts === 0) {
    pick.outcome = 'busted';
    pick.outcomeReason = `Price down ${Math.abs(check.priceChangePercent)}% after 30 days, no sold-outs`;
    pick.daysToOutcome = Math.round(daysSincePick);
  }
  // BUSTED: 60+ days pending with no improvement
  else if (daysSincePick >= 60) {
    pick.outcome = 'busted';
    pick.outcomeReason = `No confirmation after 60 days`;
    pick.daysToOutcome = Math.round(daysSincePick);
  }
  
  return pick;
}

// Ingest new picks from discovery scan
async function ingestFromDiscovery() {
  const tracker = loadTracker();
  
  // Load latest discovery data
  const discoveryFile = path.join(__dirname, '..', 'docs', 'data', 'playlist-discoveries.json');
  try {
    const data = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
    const vetted = (data.artists || []).filter(a => a.vetTier === 'red_hot' || a.vetTier === 'warm');
    
    let newPicks = 0;
    for (const artist of vetted) {
      const before = tracker.picks.length;
      logPick(tracker, artist);
      if (tracker.picks.length > before) newPicks++;
    }
    console.log(`Ingested ${newPicks} new picks from discovery scan`);
  } catch (e) {
    console.log('No discovery data to ingest:', e.message);
  }
  
  // Check back on pending picks
  const pending = tracker.picks.filter(p => p.outcome === 'pending');
  console.log(`Checking ${pending.length} pending picks...`);
  
  for (const pick of pending) {
    await checkPick(pick);
    await sleep(200);
  }
  
  saveTracker(tracker);
  
  // Summary
  console.log(`\n📊 ACCURACY TRACKER:`);
  console.log(`  Total picks: ${tracker.stats.total}`);
  console.log(`  ✅ Confirmed: ${tracker.stats.confirmed}`);
  console.log(`  ❌ Busted: ${tracker.stats.busted}`);
  console.log(`  ⏳ Pending: ${tracker.stats.pending}`);
  if (tracker.stats.hitRate !== null) {
    console.log(`  🎯 Hit rate: ${tracker.stats.hitRate}%`);
  }
  
  return tracker;
}

if (require.main === module) {
  ingestFromDiscovery().catch(e => { console.error('Error:', e); process.exit(1); });
}

module.exports = { loadTracker, logPick, checkPick, ingestFromDiscovery };
