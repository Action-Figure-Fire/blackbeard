#!/usr/bin/env node
// Discover Artist Websites — Uses Brave Search to find official artist websites
// Then stores them in rising-stars.json for the intel scraper to use

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const MAX_CALLS = parseInt(process.env.DISCOVER_LIMIT) || 30;

let callsUsed = 0;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

async function findArtistWebsite(artistName) {
  if (callsUsed >= MAX_CALLS) return null;
  callsUsed++;

  const q = encodeURIComponent(`${artistName} official website tour`);
  try {
    const data = await httpGet(
      `https://api.search.brave.com/res/v1/web/search?q=${q}&count=5`,
      { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    );
    if (!data?.web?.results) return null;

    const nameLower = artistName.toLowerCase().replace(/\s+/g, '');

    // Look for official artist website (not social media, not Wikipedia)
    for (const r of data.web.results) {
      const url = r.url.toLowerCase();
      const title = (r.title || '').toLowerCase();
      const desc = (r.description || '').toLowerCase();

      // Skip social media, Wikipedia, music platforms
      if (url.includes('wikipedia.') || url.includes('instagram.com') || url.includes('twitter.com') ||
          url.includes('x.com') || url.includes('facebook.com') || url.includes('youtube.com') ||
          url.includes('tiktok.com') || url.includes('spotify.com') || url.includes('apple.com') ||
          url.includes('seatgeek.com') || url.includes('ticketmaster.com') || url.includes('songkick.com') ||
          url.includes('bandsintown.com') || url.includes('genius.com') || url.includes('setlist.fm') ||
          url.includes('reddit.com') || url.includes('last.fm') || url.includes('allmusic.com') ||
          url.includes('discogs.com') || url.includes('pitchfork.com')) continue;

      // Check if it looks like an official site
      if (title.includes('official') || title.includes(artistName.toLowerCase()) ||
          desc.includes('official') || desc.includes('tour') || desc.includes('tickets')) {
        return r.url;
      }
    }

    // Fallback: first non-social result
    for (const r of data.web.results) {
      const url = r.url.toLowerCase();
      if (url.includes('wikipedia.') || url.includes('instagram.com') || url.includes('twitter.com') ||
          url.includes('x.com') || url.includes('facebook.com') || url.includes('youtube.com') ||
          url.includes('spotify.com') || url.includes('seatgeek.com') || url.includes('ticketmaster.com') ||
          url.includes('reddit.com')) continue;
      return r.url;
    }

    return null;
  } catch (e) {
    console.error(`  Brave error: ${e.message}`);
    return null;
  }
}

async function run() {
  console.log('🌐 Artist Website Discovery');
  console.log(`   Budget: ${MAX_CALLS} Brave calls\n`);

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const artists = data.artists || [];

  // Only artists without a known website
  const needsSite = artists.filter(a => !a.artistWebsite || !a.artistWebsite.startsWith('http'));

  // Prioritize by verification tier
  const tierOrder = { RED_HOT: 3, WARM: 2, WATCH: 1 };
  needsSite.sort((a, b) => (tierOrder[b.verificationTier] || 0) - (tierOrder[a.verificationTier] || 0));

  console.log(`   ${needsSite.length} artists need website discovery\n`);

  let found = 0;
  for (const artist of needsSite) {
    if (callsUsed >= MAX_CALLS) {
      console.log(`\n   ⚠️  Budget exhausted (${callsUsed}/${MAX_CALLS})`);
      break;
    }

    process.stdout.write(`  ${artist.name}...`);
    const url = await findArtistWebsite(artist.name);
    await sleep(300);

    if (url) {
      artist.artistWebsite = url;
      found++;
      console.log(` ✅ ${url}`);
    } else {
      console.log(' —');
    }
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`\n✅ Found ${found} websites out of ${callsUsed} searches`);
  return found;
}

module.exports = { run };
if (require.main === module) run().catch(console.error);
