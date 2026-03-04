#!/usr/bin/env node
/**
 * Blackbeard Playlist Discovery Scanner
 * 
 * Scrapes Spotify editorial playlists via embed endpoint (no auth needed)
 * Identifies rising artists who appear across multiple playlists
 * Filters out established/mainstream acts
 * Enriches with Brave Search data (listeners, socials, sold-outs)
 * 
 * Key insight: Artists appearing in 2+ editorial playlists are being 
 * actively pushed by Spotify. If they haven't broken out yet (< 2M listeners),
 * they're likely about to blow up → ticket opportunity.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_DATA_DIR = path.join(__dirname, '..', 'docs', 'data');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let braveCallCount = 0;

// Big names to filter out (already mainstream, no ticket alpha)
const MAINSTREAM_FILTER = new Set([
  'bruno mars', 'lana del rey', 'blackpink', 'a$ap rocky', 'baby keem',
  'lil baby', 'don toliver', 'dababy', 'drake', 'taylor swift', 'beyonce',
  'the weeknd', 'bad bunny', 'dua lipa', 'ed sheeran', 'post malone',
  'travis scott', 'kanye west', 'ye', 'kendrick lamar', 'sza', 'doja cat',
  'billie eilish', 'olivia rodrigo', 'harry styles', 'ariana grande',
  'j balvin', 'timbaland', 'robyn', 'doechii', 'yeat', 'melanie martinez',
  'gorillaz', 'james blake', 'thundercat', 'fred again..', 'laufey',
  'mitski', 'raye', 'brent faiyaz', 'summer walker', 'kehlani',
  'bryson tiller', 'daniel caesar', 'bleachers', 'swae lee', 'kaskade',
  'ive', 'john summit', 'pinkpantheress', 'wet leg', 'courtney barnett',
  'snail mail', 'arlo parks', 'lykke li', 'perfume genius', 'american football'
]);

// --- Spotify Embed Scraping ---

const PLAYLISTS = [
  { id: '37i9dQZF1DWUa8ZRTfalHk', name: 'Pop Rising' },
  { id: '37i9dQZF1DWWBHeXOYZf74', name: 'Rock Rising' },
  { id: '37i9dQZF1DX8tZsk68tuDw', name: 'Dance Rising' },
  { id: '37i9dQZF1DWUVpAXiEPK8P', name: 'Hot Country' },
  { id: '37i9dQZF1DX2Nc3B70tvx0', name: 'All New Indie' },
  { id: '37i9dQZF1DX4JAvHpjipBk', name: 'New Music Friday' },
  { id: '37i9dQZF1DX4dyzvuaRJ0n', name: 'mint (Electronic)' },
  { id: '37i9dQZF1DXdbXrPNafg9d', name: 'Pollen' },
  { id: '37i9dQZF1DX2RxBh64BHjQ', name: 'Most Necessary (Hip-Hop)' },
  { id: '37i9dQZF1DX4SBhb3fqCJd', name: 'Are & Be (R&B)' },
  { id: '37i9dQZF1DWXRqgorJj26U', name: 'Fresh Finds' },
  { id: '37i9dQZF1DX6J5NfMJS675', name: 'Anti Pop' },
  { id: '37i9dQZF1DX0XUsuxWHRQd', name: 'Rap Caviar' },
  { id: '37i9dQZF1DX10zKzsJ2jva', name: 'Viva Latino' },
];

async function scrapePlaylist(id) {
  try {
    const r = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await r.text();
    const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!ndMatch) return [];
    const nd = JSON.parse(ndMatch[1]);
    return nd.props?.pageProps?.state?.data?.entity?.trackList || [];
  } catch { return []; }
}

// --- Brave Search ---

async function braveSearch(query) {
  braveCallCount++;
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    });
    if (r.status !== 200) return null;
    return r.json();
  } catch { return null; }
}

function parseNumber(str) {
  if (!str) return null;
  str = str.replace(/,/g, '').trim();
  const match = str.match(/([\d.]+)\s*(billion|B|million|M|thousand|K)?/i);
  if (!match) return null;
  let num = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'billion' || unit === 'b') num *= 1000000000;
  else if (unit === 'million' || unit === 'm') num *= 1000000;
  else if (unit === 'thousand' || unit === 'k') num *= 1000;
  return Math.round(num);
}

async function enrichArtist(name) {
  const stats = {
    monthlyListeners: null, instagramFollowers: null, tiktokFollowers: null,
    youtubeSubscribers: null, albumCount: null, soldOutMentions: 0,
    soldOutSnippets: [], spotifyUrl: null
  };

  // Spotify + social stats
  const q1 = await braveSearch(`"${name}" spotify monthly listeners instagram tiktok`);
  if (q1?.web?.results) {
    for (const r of q1.web.results) {
      const text = `${r.title} ${r.description || ''}`;
      if (!stats.monthlyListeners) {
        const m = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*monthly\s*listeners?/i);
        if (m) stats.monthlyListeners = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (!stats.spotifyUrl && r.url?.includes('open.spotify.com/artist')) stats.spotifyUrl = r.url;
      if (!stats.instagramFollowers) {
        const m = text.match(/instagram[^.]{0,30}?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]{0,30}?instagram/i);
        if (m) stats.instagramFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (!stats.tiktokFollowers) {
        const m = text.match(/tiktok[^.]{0,30}?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]{0,30}?tiktok/i);
        if (m) stats.tiktokFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (stats.albumCount === null) {
        const m = text.match(/(\d+)\s*(?:studio\s*)?albums?/i);
        if (m && parseInt(m[1]) <= 20) stats.albumCount = parseInt(m[1]);
      }
    }
  }
  await sleep(250);

  // Sold-out / tour buzz
  const q2 = await braveSearch(`"${name}" concert "sold out" OR "selling fast" OR "added dates" 2025 OR 2026`);
  if (q2?.web?.results) {
    stats.soldOutSnippets = q2.web.results
      .filter(r => /sold.out|sell.out|selling fast|added dates|venue upgrade/i.test(`${r.title} ${r.description}`))
      .map(r => ({ title: r.title, snippet: (r.description || '').slice(0, 150), url: r.url }));
    stats.soldOutMentions = stats.soldOutSnippets.length;
  }
  await sleep(250);

  return stats;
}

async function checkTourDates(name) {
  try {
    const r = await fetch(`https://api.seatgeek.com/2/events?q=${encodeURIComponent(name)}&per_page=20&sort=datetime_utc.asc&datetime_utc.gte=${new Date().toISOString().split('T')[0]}&client_id=${SEATGEEK_CLIENT_ID}`);
    if (r.status !== 200) return { upcoming: 0, events: [] };
    const data = await r.json();
    if (!data?.events?.length) return { upcoming: 0, events: [] };
    return {
      upcoming: data.events.length,
      events: data.events.slice(0, 5).map(e => ({
        title: e.title, date: e.datetime_utc?.split('T')[0],
        venue: e.venue?.name, city: `${e.venue?.city}, ${e.venue?.state}`,
        capacity: e.venue?.capacity,
        lowestPrice: e.stats?.lowest_sg_base_price, avgPrice: e.stats?.average_price,
        url: e.url
      }))
    };
  } catch { return { upcoming: 0, events: [] }; }
}

// --- Scoring ---

function scoreArtist(a) {
  let score = 0;
  
  // Playlist presence (strongest signal — Spotify editorial = curated push)
  if (a.playlistCount >= 4) score += 25;
  else if (a.playlistCount >= 3) score += 20;
  else if (a.playlistCount >= 2) score += 15;
  else score += 5;
  
  // Monthly listeners sweet spot (hasn't broken through yet)
  const ml = a.monthlyListeners || 0;
  if (ml > 0 && ml <= 500000) score += 20;        // Early stage — best opportunity
  else if (ml > 500000 && ml <= 2000000) score += 15;  // Rising
  else if (ml > 2000000 && ml <= 5000000) score += 8;  // Getting big
  else if (ml === 0) score += 5;                        // Unknown = could be early
  
  // Sold-out history
  if (a.soldOutMentions >= 3) score += 20;
  else if (a.soldOutMentions >= 1) score += 12;
  
  // Social buzz
  const socials = [a.instagramFollowers, a.tiktokFollowers, a.youtubeSubscribers].filter(Boolean).length;
  if (socials >= 2) score += 8;
  else if (socials >= 1) score += 4;
  
  if (a.tiktokFollowers > 500000) score += 5;
  
  // Album count (fewer = newer)
  const albums = a.albumCount || 0;
  if (albums >= 1 && albums <= 2) score += 10;
  else if (albums === 0) score += 5;
  
  // Tour scarcity
  const shows = a.upcomingShows || 0;
  if (shows >= 1 && shows <= 5) score += 10;
  else if (shows === 0) score += 3;
  
  return Math.min(100, score);
}

// --- Main ---

async function run() {
  console.log('🏴‍☠️ Blackbeard Playlist Discovery Scanner');
  console.log('='.repeat(50));
  
  // Load existing watchlist to flag overlaps
  let watchlistNames = new Set();
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'watchlist.json'), 'utf8'));
    watchlistNames = new Set(wl.artists.map(a => a.name.toLowerCase()));
  } catch {}
  
  // Phase 1: Scrape all playlists
  console.log('\n📋 Phase 1: Scraping editorial playlists...');
  const artistMap = new Map();
  
  for (const pl of PLAYLISTS) {
    process.stdout.write(`  🎵 ${pl.name}...`);
    const tracks = await scrapePlaylist(pl.id);
    let newCount = 0;
    for (const t of tracks) {
      const artist = t.subtitle?.split(',')[0]?.trim();
      if (!artist) continue;
      if (MAINSTREAM_FILTER.has(artist.toLowerCase())) continue;
      
      if (artistMap.has(artist)) {
        artistMap.get(artist).playlists.add(pl.name);
        artistMap.get(artist).trackCount++;
      } else {
        artistMap.set(artist, { 
          name: artist, playlists: new Set([pl.name]), trackCount: 1,
          onWatchlist: watchlistNames.has(artist.toLowerCase())
        });
        newCount++;
      }
    }
    console.log(` ${tracks.length} tracks, ${newCount} new artists`);
    await sleep(500);
  }
  
  // Phase 2: Filter to rising candidates
  const candidates = [...artistMap.values()]
    .map(a => ({ ...a, playlists: [...a.playlists], playlistCount: a.playlists.size }))
    .filter(a => a.playlistCount >= 2 || a.onWatchlist)
    .sort((a, b) => b.playlistCount - a.playlistCount || b.trackCount - a.trackCount);
  
  console.log(`\n📊 ${candidates.length} candidates (2+ playlists or on watchlist)`);
  
  // Phase 3: Enrich with Brave + SeatGeek
  console.log('\n🔍 Phase 3: Enriching candidates...');
  const enriched = [];
  const MAX_ENRICH = 50;
  
  for (const c of candidates.slice(0, MAX_ENRICH)) {
    process.stdout.write(`  🔎 ${c.name} (${c.playlistCount} playlists)...`);
    
    const stats = await enrichArtist(c.name);
    const tour = await checkTourDates(c.name);
    
    const result = {
      ...c,
      ...stats,
      upcomingShows: tour.upcoming,
      tourDates: tour.events,
      source: c.onWatchlist ? 'watchlist+playlist' : 'playlist'
    };
    result.risingStarScore = scoreArtist(result);
    enriched.push(result);
    
    const ml = stats.monthlyListeners ? `${(stats.monthlyListeners/1000000).toFixed(1)}M` : '?';
    const wl = c.onWatchlist ? ' 📋' : '';
    console.log(` ${ml} listeners | ${stats.soldOutMentions} sold-outs | ${tour.upcoming} shows | score ${result.risingStarScore}${wl}`);
    
    await sleep(100);
  }
  
  // Sort by score
  enriched.sort((a, b) => b.risingStarScore - a.risingStarScore);
  
  // Save
  if (!fs.existsSync(DOCS_DATA_DIR)) fs.mkdirSync(DOCS_DATA_DIR, { recursive: true });
  
  const output = {
    scanDate: new Date().toISOString().split('T')[0],
    scanTime: new Date().toISOString(),
    playlistsScanned: PLAYLISTS.length,
    totalArtistsFound: artistMap.size,
    candidatesEnriched: enriched.length,
    braveCallsUsed: braveCallCount,
    artists: enriched
  };
  
  fs.writeFileSync(path.join(DOCS_DATA_DIR, 'playlist-discoveries.json'), JSON.stringify(output, null, 2));
  
  // Summary
  const breakouts = enriched.filter(a => a.risingStarScore >= 50);
  const newFinds = enriched.filter(a => !a.onWatchlist);
  
  console.log('\n' + '='.repeat(50));
  console.log('🏴‍☠️ PLAYLIST DISCOVERY COMPLETE');
  console.log(`  Playlists scanned: ${PLAYLISTS.length}`);
  console.log(`  Total artists: ${artistMap.size}`);
  console.log(`  Candidates enriched: ${enriched.length}`);
  console.log(`  Already on watchlist: ${enriched.filter(a => a.onWatchlist).length}`);
  console.log(`  NEW discoveries: ${newFinds.length}`);
  console.log(`  Breakout alerts (≥50): ${breakouts.length}`);
  console.log(`  Brave calls: ${braveCallCount}`);
  
  console.log('\n🌟 TOP 20 PLAYLIST RISING STARS:');
  for (const a of enriched.slice(0, 20)) {
    const ml = a.monthlyListeners ? `${(a.monthlyListeners/1000000).toFixed(1)}M` : '?';
    const wl = a.onWatchlist ? ' 📋' : ' 🆕';
    const so = a.soldOutMentions ? ` | ${a.soldOutMentions}🔥` : '';
    console.log(`  ${a.risingStarScore}/100 | ${a.name}${wl} | ${a.playlistCount} playlists | ${ml} listeners | ${a.upcomingShows || 0} shows${so}`);
    console.log(`         └ ${a.playlists.join(', ')}`);
  }
  
  return { enriched, breakouts, newFinds };
}

function formatDiscordAlert(results) {
  const { enriched, breakouts, newFinds } = results;
  let msg = '📋 **PLAYLIST DISCOVERY SCAN** 📋\n';
  msg += `Scanned ${PLAYLISTS.length} Spotify editorial playlists\n\n`;
  
  if (breakouts.length) {
    msg += '🚨 **BREAKOUT SIGNALS:**\n';
    for (const b of breakouts.slice(0, 8)) {
      const ml = b.monthlyListeners ? `${(b.monthlyListeners/1000000).toFixed(1)}M listeners` : '';
      const pls = b.playlists.slice(0, 3).join(', ');
      const so = b.soldOutMentions ? ` | ${b.soldOutMentions} sold-outs` : '';
      const wl = b.onWatchlist ? ' 📋' : ' 🆕';
      msg += `> 🔥 **${b.name}**${wl} — **${b.risingStarScore}**/100 | ${b.playlistCount} playlists (${pls}) | ${ml}${so}\n`;
    }
    msg += '\n';
  }
  
  if (newFinds.length) {
    msg += `🆕 **${newFinds.length} NEW artists** not on watchlist yet — top picks:\n`;
    for (const a of newFinds.filter(a => a.risingStarScore >= 30).slice(0, 10)) {
      const ml = a.monthlyListeners ? `${(a.monthlyListeners/1000000).toFixed(1)}M` : '?';
      msg += `> **${a.name}** — ${a.risingStarScore}/100 | ${a.playlistCount} playlists | ${ml} listeners | ${a.upcomingShows || 0} shows\n`;
    }
  }
  
  return msg;
}

if (require.main === module) {
  run().then(results => {
    console.log('\n--- DISCORD ALERT ---');
    console.log(formatDiscordAlert(results));
    console.log('--- END ---');
  }).catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

module.exports = { run, formatDiscordAlert };
