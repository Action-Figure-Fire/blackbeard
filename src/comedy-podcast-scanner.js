#!/usr/bin/env node
/**
 * Comedy Podcast Scanner
 * 
 * Monitors podcast signals that predict comedy ticket demand:
 * 1. Joe Rogan Experience — comedian guest appearances
 * 2. Theo Von's podcast (This Past Weekend / King and the Sting)
 * 3. Shane Gillis's podcast (Matt and Shane's Secret Podcast / Gilly and Keeves)
 * 4. Other key comedy podcasts (Kill Tony, Bad Friends, Tigerbelly, 2 Bears 1 Cave, Flagrant)
 * 5. Comedians who HOST popular podcasts (own audience = tour demand)
 * 
 * Logic: If a comedian appears on Rogan/Theo/Shane → they're getting bigger → 
 * check if they have upcoming tour dates → alert if small venue + rising demand
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'comedy-podcast-cache.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

const MAX_BRAVE_CALLS = 25;
const RATE_LIMIT_MS = 300;
let braveCallCount = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function saveJSON(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Key podcasts to monitor ──
const GATEWAY_PODCASTS = [
  { name: 'Joe Rogan Experience', searchTerm: '"joe rogan experience" comedian', shortName: 'JRE', weight: 10 },
  { name: 'This Past Weekend (Theo Von)', searchTerm: '"theo von" podcast comedian guest', shortName: 'Theo Von', weight: 8 },
  { name: "Matt and Shane's Secret Podcast", searchTerm: '"shane gillis" podcast guest comedian', shortName: 'Shane Gillis', weight: 8 },
  { name: 'Kill Tony', searchTerm: '"kill tony" comedian guest', shortName: 'Kill Tony', weight: 7 },
  { name: 'Bad Friends', searchTerm: '"bad friends" podcast comedian guest', shortName: 'Bad Friends', weight: 6 },
  { name: 'Flagrant', searchTerm: '"flagrant" podcast comedian guest', shortName: 'Flagrant', weight: 6 },
  { name: '2 Bears 1 Cave', searchTerm: '"2 bears 1 cave" comedian guest', shortName: '2B1C', weight: 5 },
  { name: 'Tigerbelly', searchTerm: '"tigerbelly" comedian guest', shortName: 'Tigerbelly', weight: 5 },
];

// ── Comedians known to have their own podcasts (monitors for growth) ──
const COMEDIAN_PODCASTERS = [
  { comedian: 'Andrew Schulz', podcast: 'Flagrant', platform: 'YouTube' },
  { comedian: 'Theo Von', podcast: 'This Past Weekend', platform: 'YouTube' },
  { comedian: 'Shane Gillis', podcast: "Matt and Shane's Secret Podcast", platform: 'YouTube/Patreon' },
  { comedian: 'Mark Normand', podcast: "Tuesdays with Stories / We Might Be Drunk", platform: 'YouTube' },
  { comedian: 'Stavros Halkias', podcast: 'Stav World', platform: 'YouTube/Patreon' },
  { comedian: 'Sam Morril', podcast: 'We Might Be Drunk', platform: 'YouTube' },
  { comedian: 'Tony Hinchcliffe', podcast: 'Kill Tony', platform: 'YouTube' },
  { comedian: 'Bobby Lee', podcast: 'Tigerbelly / Bad Friends', platform: 'YouTube' },
  { comedian: 'Bert Kreischer', podcast: '2 Bears 1 Cave', platform: 'YouTube' },
  { comedian: 'Tom Segura', podcast: 'Your Moms House / 2 Bears 1 Cave', platform: 'YouTube' },
  { comedian: 'Nate Bargatze', podcast: 'Nateland', platform: 'YouTube' },
  { comedian: 'Taylor Tomlinson', podcast: 'After Midnight (TV)', platform: 'CBS' },
  { comedian: 'Matt Rife', podcast: 'N/A', platform: 'TikTok/YouTube specials' },
  { comedian: 'Nikki Glaser', podcast: 'The Nikki Glaser Podcast', platform: 'iHeart' },
  { comedian: 'Josh Johnson', podcast: 'N/A', platform: 'Daily Show' },
  { comedian: 'Nate Jackson', podcast: 'Nate Jackson PSA', platform: 'YouTube' },
  { comedian: 'Ari Shaffir', podcast: 'Skeptic Tank', platform: 'YouTube' },
  { comedian: 'Ian Edwards', podcast: 'Soccer Comic Rant', platform: 'YouTube' },
  { comedian: 'Joe List', podcast: 'Tuesdays with Stories', platform: 'YouTube' },
  { comedian: 'Dan Soder', podcast: "The Bonfire / Soder's Pod", platform: 'SiriusXM' },
];

async function braveSearch(query) {
  if (braveCallCount >= MAX_BRAVE_CALLS) return [];
  braveCallCount++;
  await sleep(RATE_LIMIT_MS);
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_API_KEY }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({ title: r.title || '', url: r.url || '', description: r.description || '', published: r.age || null }));
  } catch { return []; }
}

// ── Phase 1: Scan gateway podcasts for recent comedian guests ──
async function scanGatewayPodcasts() {
  console.log('\n🎙️ Phase 1: Scanning gateway podcasts for comedian guests...');
  const appearances = [];

  for (const pod of GATEWAY_PODCASTS) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    const results = await braveSearch(pod.searchTerm + ' 2026');

    for (const r of results) {
      const text = `${r.title} ${r.description}`.toLowerCase();
      // Try to extract comedian name
      const comedian = extractComedianFromPodcastResult(r, pod);
      if (comedian) {
        appearances.push({
          comedian,
          podcast: pod.name,
          podcastShort: pod.shortName,
          weight: pod.weight,
          title: r.title,
          snippet: r.description?.slice(0, 200),
          url: r.url,
          published: r.published
        });
      }
    }
    console.log(`   ${pod.shortName}: ${results.length} results`);
  }

  return dedupeAppearances(appearances);
}

// ── Extract comedian name from podcast result ──
function extractComedianFromPodcastResult(result, podcast) {
  const text = `${result.title} ${result.description}`;
  
  // Skip if it's just about the host themselves
  const hosts = ['joe rogan', 'theo von', 'shane gillis', 'tony hinchcliffe', 'bobby lee',
    'andrew santino', 'bert kreischer', 'tom segura', 'andrew schulz', 'akaash singh'];
  
  // Common pattern: "Podcast Name #1234 - Comedian Name" or "Comedian Name | Podcast"
  const patterns = [
    /(?:episode|ep\.?|#)\s*\d+\s*[-–—]\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s*[|]\s*(?:joe rogan|theo von|kill tony|flagrant)/i,
    /(?:with|featuring|feat\.?|ft\.?|guest:?)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s+(?:joins|appears|stops by|interview|on the podcast)/,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const name = m[1].trim();
      if (name.length > 3 && !hosts.includes(name.toLowerCase()) && !isNoise(name)) {
        return name;
      }
    }
  }
  
  // Check against known comedian list
  for (const cp of COMEDIAN_PODCASTERS) {
    if (text.toLowerCase().includes(cp.comedian.toLowerCase()) && !hosts.includes(cp.comedian.toLowerCase())) {
      return cp.comedian;
    }
  }
  
  return null;
}

function isNoise(name) {
  const noise = ['subscribe', 'episode', 'podcast', 'youtube', 'spotify', 'patreon', 'watch', 'listen',
    'new episode', 'full episode', 'best of', 'compilation', 'highlights', 'the best'];
  return noise.includes(name.toLowerCase());
}

function dedupeAppearances(appearances) {
  const map = new Map();
  for (const a of appearances) {
    const key = a.comedian.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { ...a, podcastAppearances: [{ podcast: a.podcastShort, weight: a.weight }] });
    } else {
      const existing = map.get(key);
      existing.podcastAppearances.push({ podcast: a.podcastShort, weight: a.weight });
      existing.weight = Math.max(existing.weight, a.weight);
    }
  }
  return [...map.values()].sort((a, b) => {
    const aTotal = a.podcastAppearances.reduce((s, p) => s + p.weight, 0);
    const bTotal = b.podcastAppearances.reduce((s, p) => s + p.weight, 0);
    return bTotal - aTotal;
  });
}

// ── Phase 2: Check if podcast comedians have upcoming tours ──
async function checkTourDates(appearances) {
  console.log('\n🎟️ Phase 2: Checking tour dates for podcast comedians...');
  const touring = [];

  // Take top comedians by weight, check for tours
  const candidates = appearances.slice(0, Math.min(appearances.length, 8));
  
  for (const a of candidates) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    const results = await braveSearch(`"${a.comedian}" tour 2026 tickets comedy`);
    
    const tourSignals = results.filter(r => {
      const text = `${r.title} ${r.description}`.toLowerCase();
      return text.includes('tour') || text.includes('tickets') || text.includes('show') || text.includes('comedy');
    });

    if (tourSignals.length > 0) {
      touring.push({
        ...a,
        tourSignals: tourSignals.length,
        tourSnippets: tourSignals.slice(0, 3).map(r => ({
          title: r.title,
          snippet: r.description?.slice(0, 150),
          url: r.url
        }))
      });
      console.log(`   🎟️ ${a.comedian}: ${tourSignals.length} tour signal(s)`);
    }
  }

  return touring;
}

// ── Phase 3: Monitor comedian podcasters' growth signals ──
async function scanPodcasterGrowth() {
  console.log('\n📈 Phase 3: Checking comedian-podcaster growth signals...');
  const growth = [];

  // Sample a few to stay in budget
  const sample = COMEDIAN_PODCASTERS.filter(c => c.podcast !== 'N/A').slice(0, 5);
  
  for (const cp of sample) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    const results = await braveSearch(`"${cp.comedian}" podcast subscribers growth 2026`);
    
    const growthSignals = results.filter(r => {
      const text = `${r.title} ${r.description}`.toLowerCase();
      return text.includes('subscriber') || text.includes('views') || text.includes('million') || 
             text.includes('growing') || text.includes('popular') || text.includes('#1');
    });

    if (growthSignals.length > 0) {
      growth.push({
        comedian: cp.comedian,
        podcast: cp.podcast,
        platform: cp.platform,
        signals: growthSignals.length,
        snippets: growthSignals.slice(0, 2).map(r => ({
          title: r.title,
          snippet: r.description?.slice(0, 150)
        }))
      });
      console.log(`   📈 ${cp.comedian} (${cp.podcast}): ${growthSignals.length} growth signal(s)`);
    }
  }

  return growth;
}

// ── Main ──
async function run() {
  console.log('🎙️ Comedy Podcast Scanner starting...');
  console.log(`   Budget: ${MAX_BRAVE_CALLS} Brave calls`);
  console.log(`   Monitoring: ${GATEWAY_PODCASTS.length} gateway podcasts, ${COMEDIAN_PODCASTERS.length} comedian-podcasters`);

  const startTime = Date.now();
  const prevCache = loadJSON(CACHE_FILE) || { history: [] };

  // Phase 1: Gateway podcast appearances
  const appearances = await scanGatewayPodcasts();

  // Phase 2: Tour dates for podcast comedians
  const touring = await checkTourDates(appearances);

  // Phase 3: Podcaster growth
  const growth = await scanPodcasterGrowth();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const result = {
    lastScan: new Date().toISOString(),
    elapsed: `${elapsed}s`,
    apiCalls: { brave: braveCallCount },
    appearances,
    touring,
    podcasterGrowth: growth,
    history: [
      { date: new Date().toISOString().split('T')[0], appearances: appearances.length, touring: touring.length, growth: growth.length },
      ...(prevCache.history || []).slice(0, 13) // 2 weeks of history
    ]
  };

  saveJSON(CACHE_FILE, result);

  console.log(`\n✅ Comedy Podcast Scan complete in ${elapsed}s`);
  console.log(`   Brave calls: ${braveCallCount}/${MAX_BRAVE_CALLS}`);
  console.log(`   Appearances: ${appearances.length} | Touring: ${touring.length} | Growth: ${growth.length}`);

  return result;
}

// ── Discord formatting ──
function formatDiscordAlert(results) {
  if (!results) return '';

  let msg = '🎙️ **Comedy Podcast Scanner**\n';
  msg += `Brave calls: ${results.apiCalls?.brave || 0}\n\n`;

  // Gateway podcast appearances (the money signal)
  if (results.appearances?.length) {
    msg += '**🎤 Recent Podcast Appearances:**\n';
    for (const a of results.appearances.slice(0, 10)) {
      const pods = a.podcastAppearances.map(p => p.podcast).join(', ');
      msg += `• **${a.comedian}** — on ${pods}`;
      if (a.snippet) msg += ` — _${a.snippet.slice(0, 80)}_`;
      msg += '\n';
    }
    msg += '\n';
  }

  // Comedians with tours (actionable)
  if (results.touring?.length) {
    msg += '**🎟️ Podcast Comedians with Active Tours:**\n';
    for (const t of results.touring) {
      const pods = t.podcastAppearances.map(p => p.podcast).join(', ');
      msg += `• **${t.comedian}** — appeared on ${pods}, ${t.tourSignals} tour signal(s)\n`;
      if (t.tourSnippets?.[0]) msg += `  └ _${t.tourSnippets[0].snippet?.slice(0, 100)}_\n`;
    }
    msg += '\n';
  }

  // Podcaster growth
  if (results.podcasterGrowth?.length) {
    msg += '**📈 Comedian-Podcaster Growth:**\n';
    for (const g of results.podcasterGrowth) {
      msg += `• **${g.comedian}** (${g.podcast}) — ${g.signals} growth signal(s)\n`;
    }
    msg += '\n';
  }

  if (!results.appearances?.length && !results.touring?.length) {
    msg += '_No significant comedy podcast signals this scan._\n';
  }

  return msg;
}

module.exports = { run, formatDiscordAlert };

if (require.main === module) {
  run().then(r => {
    console.log('\n' + formatDiscordAlert(r));
  }).catch(e => { console.error(e); process.exit(1); });
}
