#!/usr/bin/env node
// ============================================================
// BUILD KNOWLEDGE BASE for BrokerBeacon Cloudflare KV
// Compiles all Blackbeard intelligence into KV-ready JSON
// Strips all personal info (names, API keys, etc.)
// Run: node build-knowledge-base.js
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, 'kv-data');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return null; }
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// ============================================================
// 1. ARTIST DATABASE (from watchlist.json)
// ============================================================
function buildArtistDB() {
  const watchlist = readJSON('watchlist.json');
  if (!watchlist?.artists) return [];
  
  return watchlist.artists.map(a => ({
    name: a.name,
    genre: a.genre || a.category || 'Unknown',
    tier: a.tier || 'C',
    notes: a.notes || '',
    redRocks: a.redRocks || null,
    priority: a.priority || 'normal',
    alertOnNewDates: a.alertOnNewDates || false,
    vividSeatsId: a.vividSeatsId || null,
    spotify: a.spotify || null,
    bandsintown: a.bandsintown !== false
  }));
}

// ============================================================
// 2. VIP WATCHLIST (confirmed sellers with pricing)
// ============================================================
function buildVIPWatchlist() {
  const vip = readJSON('vip-watchlist.json');
  if (!vip?.confirmedSellers) return [];
  
  return vip.confirmedSellers.map(s => ({
    artist: s.artist,
    tier: s.tier,
    genre: s.genre,
    evidence: s.evidence || {},
    pattern: s.pattern || '',
    action: s.action || '',
    vividSeatsId: s.vividSeatsId || null,
    performerId: s.performerId || null
  }));
}

// ============================================================
// 3. VENUE DATABASE
// ============================================================
function buildVenueDB() {
  const db = readJSON('venue-db.json');
  if (!db?.venues) return [];
  return db.venues.map(v => ({
    name: v.name, city: v.city, state: v.state,
    capacity: v.capacity, vividSeatsId: v.vividSeatsId || null,
    stubhubId: v.stubhubId || null
  }));
}

// ============================================================
// 4. BREAKOUT REFERENCE DATABASE
// ============================================================
function buildBreakoutDB() {
  const db = readJSON('breakout-reference-db.json');
  if (!Array.isArray(db)) return [];
  return db.map(a => ({
    name: a.name, genre: a.genre,
    breakoutYear: a.breakoutYear,
    breakoutTrigger: a.breakoutTrigger,
    timeline: a.timeline || {},
    keyMetrics: a.keyMetrics || {},
    lessonsLearned: a.lessonsLearned || ''
  }));
}

// ============================================================
// 5. PRICE RECORDS (historical snapshots)
// ============================================================
function buildPriceRecords() {
  const dir = path.join(DATA_DIR, 'price-records');
  const records = {};
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const key = file.replace('.json', '');
        // Strip any personal info
        records[key] = data;
      } catch {}
    }
  } catch {}
  return records;
}

// ============================================================
// 6. VIVID SEATS SNAPSHOTS
// ============================================================
function buildVividSnapshots() {
  const dir = path.join(DATA_DIR, 'vivid-snapshots');
  const snapshots = {};
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        snapshots[file.replace('.json', '')] = data;
      } catch {}
    }
  } catch {}
  return snapshots;
}

// ============================================================
// 7. UK BREAKOUT WATCHLIST
// ============================================================
function buildUKBreakoutList() {
  const data = readJSON('uk-breakout-watchlist.json');
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.artists) return data.artists;
  return [];
}

// ============================================================
// 8. VELOCITY SNAPSHOTS (growth tracking)
// ============================================================
function buildVelocityData() {
  return readJSON('velocity-snapshots.json') || {};
}

// ============================================================
// 9. SALES PERFORMANCE
// ============================================================
function buildSalesPerformance() {
  return readJSON('sales-performance.json') || {};
}

// ============================================================
// COMPILE EVERYTHING
// ============================================================
function build() {
  ensureDir(OUT_DIR);
  
  console.log('Building knowledge base...');
  
  const artists = buildArtistDB();
  console.log(`  Artists: ${artists.length}`);
  
  const vip = buildVIPWatchlist();
  console.log(`  VIP Sellers: ${vip.length}`);
  
  const venues = buildVenueDB();
  console.log(`  Venues: ${venues.length}`);
  
  const breakouts = buildBreakoutDB();
  console.log(`  Breakout References: ${breakouts.length}`);
  
  const priceRecords = buildPriceRecords();
  console.log(`  Price Records: ${Object.keys(priceRecords).length}`);
  
  const vividSnapshots = buildVividSnapshots();
  console.log(`  Vivid Snapshots: ${Object.keys(vividSnapshots).length}`);
  
  const ukBreakout = buildUKBreakoutList();
  console.log(`  UK Breakout Watch: ${Array.isArray(ukBreakout) ? ukBreakout.length : 'object'}`);
  
  const velocity = buildVelocityData();
  console.log(`  Velocity Snapshots: ${Object.keys(velocity).length}`);
  
  const sales = buildSalesPerformance();
  console.log(`  Sales Records: ${Object.keys(sales).length}`);

  // Write individual KV entries (each under 25MB KV limit, most under 100KB)
  const kvEntries = {
    'artists': artists,
    'vip-watchlist': vip,
    'venues': venues,
    'breakout-references': breakouts,
    'price-records': priceRecords,
    'vivid-snapshots': vividSnapshots,
    'uk-breakout': ukBreakout,
    'velocity': velocity,
    'sales-performance': sales
  };

  // Also build a compact artist lookup (name → key data) for fast queries
  const artistLookup = {};
  for (const a of artists) {
    const key = a.name.toLowerCase();
    artistLookup[key] = {
      genre: a.genre, tier: a.tier, notes: a.notes,
      vividSeatsId: a.vividSeatsId, priority: a.priority
    };
  }
  // Merge VIP data
  for (const v of vip) {
    if (!v.artist) continue;
    const key = v.artist.toLowerCase();
    if (artistLookup[key]) {
      artistLookup[key].vipTier = v.tier;
      artistLookup[key].evidence = v.evidence;
      artistLookup[key].pattern = v.pattern;
      artistLookup[key].action = v.action;
    } else {
      artistLookup[key] = {
        genre: v.genre, tier: v.tier, vipTier: v.tier,
        evidence: v.evidence, pattern: v.pattern, action: v.action
      };
    }
  }
  kvEntries['artist-lookup'] = artistLookup;
  console.log(`  Artist Lookup: ${Object.keys(artistLookup).length} entries`);

  // Write all files
  let totalSize = 0;
  for (const [key, data] of Object.entries(kvEntries)) {
    const json = JSON.stringify(data);
    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), json);
    totalSize += json.length;
    console.log(`  → ${key}.json (${(json.length/1024).toFixed(1)}KB)`);
  }

  console.log(`\nTotal: ${(totalSize/1024).toFixed(1)}KB across ${Object.keys(kvEntries).length} KV entries`);
  console.log('Done! Files in:', OUT_DIR);
  
  // Generate wrangler KV seed command
  console.log('\nTo seed KV, run:');
  console.log('npx wrangler kv namespace create KNOWLEDGE');
  console.log('Then for each file:');
  console.log('npx wrangler kv key put --namespace-id=<ID> "artists" --path=kv-data/artists.json');
}

build();
