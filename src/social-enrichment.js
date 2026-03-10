#!/usr/bin/env node
// Social Media Enrichment — Fetches TikTok + Instagram follower counts via Brave Search
// One Brave call per artist extracts follower count from search snippet
// Also updates X/Twitter follower counts when available

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const MAX_CALLS = parseInt(process.env.SOCIAL_LIMIT) || 30;

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

function parseFollowers(text) {
  // Match patterns: "36.9M Followers", "2.5K followers", "1,234,567 followers", "37MFollowers"
  const match = text.match(/([\d,.]+)\s*([MKBmkb])?\s*(?:followers?|subscribers?)/i);
  if (!match) return null;
  let num = parseFloat(match[1].replace(/,/g, ''));
  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'M') num *= 1000000;
  else if (suffix === 'K') num *= 1000;
  else if (suffix === 'B') num *= 1000000000;
  return Math.round(num);
}

async function getTikTokFollowers(artistName) {
  if (callsUsed >= MAX_CALLS) return null;
  callsUsed++;
  try {
    const q = encodeURIComponent(`${artistName} tiktok followers`);
    const data = await httpGet(
      `https://api.search.brave.com/res/v1/web/search?q=${q}&count=3`,
      { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    );
    if (!data?.web?.results) return null;

    for (const r of data.web.results) {
      const text = (r.title || '') + ' ' + (r.description || '');
      // Must be a TikTok-related result
      if (!text.toLowerCase().includes('tiktok') && !r.url.includes('tiktok.com')) continue;
      const followers = parseFollowers(text);
      if (followers && followers > 100) {
        // Extract handle
        const handleMatch = r.url.match(/tiktok\.com\/@([^/?]+)/);
        return { followers, handle: handleMatch ? '@' + handleMatch[1] : null, url: r.url };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function getInstagramFollowers(artistName) {
  if (callsUsed >= MAX_CALLS) return null;
  callsUsed++;
  try {
    const q = encodeURIComponent(`${artistName} instagram followers`);
    const data = await httpGet(
      `https://api.search.brave.com/res/v1/web/search?q=${q}&count=3`,
      { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    );
    if (!data?.web?.results) return null;

    for (const r of data.web.results) {
      const text = (r.title || '') + ' ' + (r.description || '');
      if (!text.toLowerCase().includes('instagram') && !r.url.includes('instagram.com')) continue;
      const followers = parseFollowers(text);
      if (followers && followers > 100) {
        return { followers };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function formatNum(n) {
  if (!n) return '?';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

async function run() {
  console.log('📱 Social Media Enrichment (TikTok + Instagram)');
  console.log(`   Budget: ${MAX_CALLS} Brave calls\n`);

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const artists = data.artists || [];

  // Prioritize artists missing TikTok data, then by tier
  const needsTT = artists.filter(a => !a.tiktokFollowers);
  const tierOrder = { RED_HOT: 3, WARM: 2, WATCH: 1 };
  needsTT.sort((a, b) => (tierOrder[b.verificationTier] || 0) - (tierOrder[a.verificationTier] || 0));

  console.log(`   ${needsTT.length} artists need TikTok data\n`);

  let enriched = 0;
  const results = [];

  for (const artist of needsTT) {
    if (callsUsed >= MAX_CALLS) {
      console.log(`\n   ⚠️  Budget exhausted (${callsUsed}/${MAX_CALLS})`);
      break;
    }

    process.stdout.write(`  ${artist.name}...`);

    // Get TikTok
    const tt = await getTikTokFollowers(artist.name);
    await sleep(300);

    // Get Instagram if missing too
    let ig = null;
    if (!artist.instagramFollowers && callsUsed < MAX_CALLS) {
      ig = await getInstagramFollowers(artist.name);
      await sleep(300);
    }

    let found = false;
    if (tt) {
      artist.tiktokFollowers = tt.followers;
      if (tt.handle) artist.tiktokHandle = tt.handle;
      found = true;
    }
    if (ig) {
      artist.instagramFollowers = ig.followers;
      found = true;
    }

    if (found) {
      enriched++;
      console.log(` ✅ TikTok: ${tt ? formatNum(tt.followers) : '—'} | IG: ${ig ? formatNum(ig.followers) : (artist.instagramFollowers ? formatNum(artist.instagramFollowers) : '—')}`);
      results.push({ name: artist.name, tiktok: tt?.followers, instagram: ig?.followers || artist.instagramFollowers });
    } else {
      console.log(' —');
    }
  }

  data.lastSocialEnrichment = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log(`\n✅ Social enrichment complete: ${enriched} artists updated, ${callsUsed} Brave calls`);

  if (results.length) {
    console.log('\n📱 Top TikTok:');
    results.filter(r => r.tiktok).sort((a, b) => (b.tiktok || 0) - (a.tiktok || 0)).slice(0, 10)
      .forEach(r => console.log(`   ${r.name}: ${formatNum(r.tiktok)}`));
  }

  return results;
}

function formatDiscordAlert(results) {
  if (!results || !results.length) return '';
  const withTT = results.filter(r => r.tiktok).sort((a, b) => (b.tiktok || 0) - (a.tiktok || 0));
  if (!withTT.length) return '';
  return `📱 **Social enrichment**: ${results.length} artists updated\nTop TikTok: ${withTT.slice(0, 5).map(r => `${r.name} (${formatNum(r.tiktok)})`).join(', ')}`;
}

module.exports = { run, formatDiscordAlert };
if (require.main === module) run().catch(console.error);
