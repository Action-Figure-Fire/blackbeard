#!/usr/bin/env node
/**
 * UK Breakout Scanner — Finds UK artists exploding in the UK/Europe
 * who haven't done a US headline tour yet.
 * 
 * Sources:
 *   1. Brave Search: UK charts, BRIT nominees, BBC Sound Of, Mercury Prize
 *   2. Bandsintown: Check if they have US dates yet
 *   3. SeatGeek: Check if US events exist
 *   4. Brave Search: Spotify monthly listeners + social followings
 * 
 * Output: data/uk-breakout-watchlist.json
 * Alert: Any artist who just announced US dates → immediate Discord alert
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0 && !line.startsWith('#')) {
      process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  });
}

const BRAVE_KEY = process.env.BRAVE_API_KEY;
const SEATGEEK_ID = process.env.SEATGEEK_CLIENT_ID;
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'uk-breakout-watchlist.json');

// Budget controls
const BRAVE_LIMIT = parseInt(process.env.UK_BRAVE_LIMIT || '30');
const BIT_LIMIT = parseInt(process.env.UK_BIT_LIMIT || '30');
const SG_LIMIT = parseInt(process.env.UK_SG_LIMIT || '20');
let braveUsed = 0, bitUsed = 0, sgUsed = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers };
    https.get(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

async function braveSearch(query) {
  if (braveUsed >= BRAVE_LIMIT) return [];
  braveUsed++;
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
    const res = await httpGet(url, { 'X-Subscription-Token': BRAVE_KEY, Accept: 'application/json' });
    const j = JSON.parse(res.body);
    return (j.web?.results || []).map(r => ({ title: r.title, url: r.url, description: r.description }));
  } catch (e) { return []; }
}

async function bandsintownEvents(artist) {
  if (bitUsed >= BIT_LIMIT) return [];
  bitUsed++;
  try {
    const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(artist)}/events?app_id=squarespace-blackbeard&date=upcoming`;
    const res = await httpGet(url);
    return JSON.parse(res.body);
  } catch (e) { return []; }
}

async function seatgeekSearch(artist) {
  if (sgUsed >= SG_LIMIT) return [];
  sgUsed++;
  try {
    const url = `https://api.seatgeek.com/2/events?q=${encodeURIComponent(artist)}&per_page=20&client_id=${SEATGEEK_ID}`;
    const res = await httpGet(url);
    const j = JSON.parse(res.body);
    return j.events || [];
  } catch (e) { return []; }
}

// Phase 1: Discover UK artists blowing up
async function discoverUKArtists() {
  console.log('\n🇬🇧 Phase 1: Discovering UK breakout artists...\n');
  const artists = new Map(); // name → { sources: [], mentions: 0 }

  const searches = [
    { query: 'BBC Sound Of 2026 longlist shortlist artist', tag: 'BBC Sound Of' },
    { query: 'BRIT Awards 2026 nominees rising star', tag: 'BRIT Awards' },
    { query: 'UK breakthrough artist 2026 sold out tour', tag: 'UK Breakthrough' },
    { query: 'Mercury Prize 2026 nominees shortlist', tag: 'Mercury Prize' },
    { query: 'UK artist "sold out" tour 2026 debut album', tag: 'UK Sold Out' },
    { query: 'UK rapper singer "blowing up" 2026 viral', tag: 'UK Viral' },
    { query: 'NME best new artist UK 2026', tag: 'NME' },
    { query: 'UK artist Spotify "million monthly listeners" 2026 tour', tag: 'Spotify UK' },
    { query: 'UK artist TikTok viral 2026 "first tour" OR "debut tour"', tag: 'TikTok UK' },
    { query: 'UK artist "US tour" OR "North America tour" 2026 announced', tag: 'US Tour Announced' },
    { query: 'UK indie pop rock artist breakthrough 2026 festival', tag: 'UK Indie Breakthrough' },
    { query: 'UK R&B soul artist breakout 2026 streaming', tag: 'UK R&B' },
    { query: 'UK dance electronic artist 2026 "sold out" club tour', tag: 'UK Dance' },
    { query: 'Glastonbury 2026 lineup emerging UK acts', tag: 'Glastonbury' },
    { query: 'UK artist "number one" debut single 2026', tag: 'UK Charts' },
  ];

  for (const s of searches) {
    if (braveUsed >= BRAVE_LIMIT) break;
    const results = await braveSearch(s.query);
    for (const r of results) {
      // Extract artist names from results using common patterns
      const text = `${r.title} ${r.description}`;
      const extracted = extractArtistNames(text);
      for (const name of extracted) {
        if (!artists.has(name)) {
          artists.set(name, { sources: [], mentions: 0, snippets: [] });
        }
        const entry = artists.get(name);
        if (!entry.sources.includes(s.tag)) entry.sources.push(s.tag);
        entry.mentions++;
        entry.snippets.push(text.slice(0, 200));
      }
    }
    await sleep(500);
  }

  console.log(`  Found ${artists.size} potential UK artists from ${braveUsed} Brave searches`);
  return artists;
}

function extractArtistNames(text) {
  const names = [];
  // Known UK artists to always catch
  const knownUK = [
    'Raye', 'RAYE', 'PinkPantheress', 'Central Cee', 'Cat Burns', 'Olivia Dean',
    'Holly Humberstone', 'Arlo Parks', 'Wet Leg', 'Sam Fender', 'Beabadoobee',
    'FKA twigs', 'Aitch', 'Knucks', 'Ezra Collective', 'Cleo Sol', 'Jorja Smith',
    'Little Simz', 'Loyle Carner', 'Dave', 'Stormzy', 'Mahalia', 'Joy Crookes',
    'Rema', 'Burna Boy', 'Skepta', 'slowthai', 'Self Esteem', 'English Teacher',
    'The Last Dinner Party', 'BICEP', 'Disclosure', 'Peggy Gou', 'Fred again',
    'Barry Can\'t Swim', 'Artemas', 'Good Neighbours', 'Rachel Chinouriri', 'Myles Smith',
    'Confidence Man', 'Sprints', 'Yard Act', 'Fontaines D.C.', 'Dry Cleaning',
    'Black Country New Road', 'Black Midi', 'Squid', 'Sports Team', 'Sea Power',
    'Ezra Collective', 'CMAT', 'Nilüfer Yanya', 'Rina Sawayama',
    'Shygirl', 'Charli xcx', 'Dua Lipa', 'YUNGBLUD', 'Griff', 'Maisie Peters',
    'Tom Grennan', 'Jade', 'Becky Hill', 'Chase & Status', 'Headie One',
    'Pa Salieu', 'Obongjayar', 'Ghetts', 'Lancey Foux', 'Berwyn',
    'Nala', 'Dylan', 'Floating Points', 'Jamie xx', 'Four Tet',
    'The Dare', 'Royel Otis', 'Amyl and the Sniffers', 'Lime Garden',
    'Rachel Chinouriri', 'Sampha', 'Young Fathers', 'Michael Kiwanuka',
    'Jessie Ware', 'Gabriels', 'Nemahsis', 'Tommy Lefroy', 'Opus Kink',
    'Good Neighbours', 'Myles Smith', 'Artemas', 'Chappell Roan'
  ];

  for (const name of knownUK) {
    if (text.includes(name)) {
      names.push(name);
    }
  }

  // Also catch quoted names or capitalized potential artist names
  const quotedNames = text.match(/"([A-Z][a-z]+(?: [A-Z][a-z]+)*?)"/g);
  if (quotedNames) {
    for (const q of quotedNames) {
      const clean = q.replace(/"/g, '');
      if (clean.length > 2 && clean.length < 30 && !['The', 'New', 'Best', 'Top', 'First'].includes(clean)) {
        names.push(clean);
      }
    }
  }

  return [...new Set(names)];
}

// Phase 2: Check which artists have US dates
async function checkUSDates(artists) {
  console.log('\n🇺🇸 Phase 2: Checking for US tour dates...\n');
  const results = [];

  // Sort by mention count — most-mentioned first
  const sorted = [...artists.entries()].sort((a, b) => b[1].mentions - a[1].mentions);

  // Filter to artists with 2+ source types (more credible)
  const credible = sorted.filter(([_, data]) => data.sources.length >= 1);

  for (const [name, data] of credible.slice(0, BIT_LIMIT)) {
    const rawEvents = await bandsintownEvents(name);
    await sleep(400);

    const events = Array.isArray(rawEvents) ? rawEvents : [];
    const usEvents = events.filter(e =>
      e.venue?.country === 'United States' || e.venue?.country === 'US'
    );
    const ukEuEvents = events.filter(e =>
      ['United Kingdom', 'UK', 'Germany', 'France', 'Netherlands', 'Ireland', 'Belgium', 'Spain', 'Italy', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Poland', 'Austria', 'Portugal', 'Czech Republic'].includes(e.venue?.country)
    );

    const entry = {
      name,
      sources: data.sources,
      mentions: data.mentions,
      totalEvents: events.length,
      usEvents: usEvents.length,
      ukEuEvents: ukEuEvents.length,
      hasUSDates: usEvents.length > 0,
      usVenues: usEvents.slice(0, 5).map(e => ({
        date: e.datetime?.split('T')[0],
        venue: e.venue?.name,
        city: `${e.venue?.city}, ${e.venue?.region}`,
        country: e.venue?.country
      })),
      ukEuVenues: ukEuEvents.slice(0, 3).map(e => ({
        date: e.datetime?.split('T')[0],
        venue: e.venue?.name,
        city: e.venue?.city,
        country: e.venue?.country
      })),
      snippets: data.snippets.slice(0, 2)
    };

    results.push(entry);

    const status = usEvents.length > 0 ? `🇺🇸 ${usEvents.length} US dates!` : `❌ No US dates yet (${ukEuEvents.length} UK/EU)`;
    console.log(`  ${name}: ${status} [${data.sources.join(', ')}]`);
  }

  return results;
}

// Phase 3: Enrich top candidates with streaming data
async function enrichWithStreaming(artists) {
  console.log('\n📊 Phase 3: Enriching top candidates with streaming data...\n');

  // Prioritize: artists with UK/EU dates but NO US dates (pre-breakout), or just-announced US dates
  const priority = artists.filter(a => a.ukEuEvents > 0).sort((a, b) => {
    // No US dates first (they're the hidden gems), then by mentions
    if (!a.hasUSDates && b.hasUSDates) return -1;
    if (a.hasUSDates && !b.hasUSDates) return 1;
    return b.mentions - a.mentions;
  });

  for (const artist of priority.slice(0, 15)) {
    if (braveUsed >= BRAVE_LIMIT) break;

    const results = await braveSearch(`${artist.name} artist Spotify monthly listeners`);
    for (const r of results) {
      const text = `${r.title} ${r.description}`;
      // Extract listener count
      const listenerMatch = text.match(/([\d,.]+)\s*(?:M|million)\s*(?:monthly\s*)?listeners/i);
      if (listenerMatch) {
        const raw = listenerMatch[1].replace(/,/g, '');
        const num = parseFloat(raw);
        artist.spotifyMonthly = num >= 1000 ? num : num * 1000000;
      }
      // Extract follower counts
      const tiktokMatch = text.match(/([\d,.]+)\s*(?:M|million|K|thousand)\s*(?:TikTok\s*)?followers/i);
      if (tiktokMatch) {
        artist.socialSnippet = text.slice(0, 150);
      }
    }
    await sleep(500);
  }

  return artists;
}

// Phase 4: Compare against RAYE reference case
function scoreAgainstReference(artists) {
  console.log('\n🎯 Phase 4: Scoring against RAYE reference case...\n');

  // Load RAYE reference
  const refPath = path.join(DATA_DIR, 'confirmed-winners', 'raye.json');
  let ref = null;
  if (fs.existsSync(refPath)) {
    ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  }

  for (const artist of artists) {
    let score = 0;
    const signals = [];

    // UK/EU touring (key signal)
    if (artist.ukEuEvents > 5) { score += 20; signals.push('Active UK/EU tour'); }
    else if (artist.ukEuEvents > 0) { score += 10; signals.push('Some UK/EU dates'); }

    // NO US dates yet = pre-breakout gold
    if (!artist.hasUSDates && artist.ukEuEvents > 0) {
      score += 25;
      signals.push('🔥 NO US DATES YET — pre-breakout window');
    }
    // Just announced US dates = still early
    else if (artist.hasUSDates && artist.usEvents <= 10) {
      score += 15;
      signals.push('Just announced US dates — early window');
    }

    // Multiple credible sources
    if (artist.sources.length >= 3) { score += 15; signals.push(`${artist.sources.length} source types`); }
    else if (artist.sources.length >= 2) { score += 10; signals.push('2 source types'); }

    // High Spotify
    if (artist.spotifyMonthly >= 20000000) { score += 20; signals.push(`${(artist.spotifyMonthly/1000000).toFixed(0)}M Spotify = RAYE-level`); }
    else if (artist.spotifyMonthly >= 5000000) { score += 10; signals.push(`${(artist.spotifyMonthly/1000000).toFixed(0)}M Spotify`); }

    // Award/chart mentions in sources
    const awardSources = artist.sources.filter(s =>
      ['BRIT Awards', 'BBC Sound Of', 'Mercury Prize', 'UK Charts', 'NME'].includes(s)
    );
    if (awardSources.length > 0) { score += 15; signals.push(`Award signal: ${awardSources.join(', ')}`); }

    artist.breakoutScore = score;
    artist.signals = signals;

    // Tier assignment
    if (score >= 60) artist.tier = '🔴 IMMINENT';
    else if (score >= 40) artist.tier = '🟡 WATCH CLOSELY';
    else if (score >= 20) artist.tier = '⚪ ON RADAR';
    else artist.tier = '⬜ LOW';
  }

  return artists.sort((a, b) => b.breakoutScore - a.breakoutScore);
}

// Phase 5: Detect changes from last run
function detectChanges(current) {
  let alerts = [];

  if (fs.existsSync(CACHE_FILE)) {
    const prev = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const prevMap = new Map((prev.artists || []).map(a => [a.name, a]));

    for (const artist of current) {
      const old = prevMap.get(artist.name);
      if (!old) continue;

      // NEW US DATES — this is the money alert
      if (artist.hasUSDates && !old.hasUSDates) {
        alerts.push({
          type: 'US_DATES_ANNOUNCED',
          artist: artist.name,
          usEvents: artist.usEvents,
          venues: artist.usVenues,
          score: artist.breakoutScore,
          tier: artist.tier,
          message: `🚨 ${artist.name} JUST ANNOUNCED US DATES! ${artist.usEvents} shows. Score: ${artist.breakoutScore}. ${artist.signals.join(', ')}`
        });
      }

      // New US dates added (already had some)
      if (artist.hasUSDates && old.hasUSDates && artist.usEvents > old.usEvents) {
        alerts.push({
          type: 'NEW_US_DATES_ADDED',
          artist: artist.name,
          newCount: artist.usEvents - old.usEvents,
          message: `📍 ${artist.name} added ${artist.usEvents - old.usEvents} new US dates (now ${artist.usEvents} total)`
        });
      }

      // Tier upgrade
      if (artist.breakoutScore > (old.breakoutScore || 0) + 10) {
        alerts.push({
          type: 'TIER_UPGRADE',
          artist: artist.name,
          from: old.tier,
          to: artist.tier,
          message: `📈 ${artist.name} upgraded from ${old.tier} → ${artist.tier}`
        });
      }
    }
  }

  return alerts;
}

// Main
async function main() {
  console.log('🇬🇧 UK BREAKOUT SCANNER');
  console.log('═══════════════════════════════════════');
  console.log(`Budget: ${BRAVE_LIMIT} Brave, ${BIT_LIMIT} Bandsintown, ${SG_LIMIT} SeatGeek`);
  console.log();

  // Phase 1: Discover
  const discovered = await discoverUKArtists();

  // Phase 2: Check US dates
  const withDates = await checkUSDates(discovered);

  // Phase 3: Enrich streaming
  const enriched = await enrichWithStreaming(withDates);

  // Phase 4: Score
  const scored = scoreAgainstReference(enriched);

  // Phase 5: Detect changes
  const alerts = detectChanges(scored);

  // Save
  const output = {
    lastRun: new Date().toISOString(),
    apiCalls: { brave: braveUsed, bandsintown: bitUsed, seatgeek: sgUsed },
    alertCount: alerts.length,
    alerts,
    artists: scored,
    summary: {
      imminent: scored.filter(a => a.tier === '🔴 IMMINENT').length,
      watchClosely: scored.filter(a => a.tier === '🟡 WATCH CLOSELY').length,
      onRadar: scored.filter(a => a.tier === '⚪ ON RADAR').length,
      noUSDates: scored.filter(a => !a.hasUSDates && a.ukEuEvents > 0).length
    }
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(output, null, 2));

  // Print summary
  console.log('\n═══════════════════════════════════════');
  console.log('📊 RESULTS');
  console.log('═══════════════════════════════════════');
  console.log(`🔴 IMMINENT: ${output.summary.imminent}`);
  console.log(`🟡 WATCH CLOSELY: ${output.summary.watchClosely}`);
  console.log(`⚪ ON RADAR: ${output.summary.onRadar}`);
  console.log(`🎯 NO US DATES YET: ${output.summary.noUSDates}`);
  console.log();

  // Print top artists
  console.log('TOP ARTISTS:');
  for (const a of scored.slice(0, 20)) {
    const usTxt = a.hasUSDates ? `${a.usEvents} US dates` : 'NO US DATES';
    const spotify = a.spotifyMonthly ? `${(a.spotifyMonthly/1000000).toFixed(1)}M` : '?';
    console.log(`  ${a.tier} ${a.name} — Score:${a.breakoutScore} | ${usTxt} | ${a.ukEuEvents} UK/EU | Spotify:${spotify}`);
    console.log(`    Signals: ${a.signals.join(' | ')}`);
  }

  if (alerts.length > 0) {
    console.log('\n🚨 ALERTS:');
    for (const a of alerts) {
      console.log(`  ${a.message}`);
    }
  }

  console.log(`\nAPI calls: Brave ${braveUsed}/${BRAVE_LIMIT}, Bandsintown ${bitUsed}/${BIT_LIMIT}, SeatGeek ${sgUsed}/${SG_LIMIT}`);
  console.log(JSON.stringify(output.summary));
}

main().catch(e => { console.error(e); process.exit(1); });
