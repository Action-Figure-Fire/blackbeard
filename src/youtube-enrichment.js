#!/usr/bin/env node
// YouTube Enrichment — Fetches subscriber counts + top video views via SerpAPI YouTube engine
// Adds youtubeSubscribers, youtubeTopVideoViews, youtubeHandle to rising-stars.json
// Budget: 1 SerpAPI call per artist (100/mo on free tier — be selective)

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const MAX_CALLS = parseInt(process.env.YT_LIMIT) || 30; // Conservative default

let callsUsed = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

async function getYouTubeData(artistName) {
  if (callsUsed >= MAX_CALLS) return null;
  callsUsed++;

  try {
    const q = encodeURIComponent(artistName);
    const data = await httpGet(
      `https://serpapi.com/search.json?engine=youtube&search_query=${q}&api_key=${SERPAPI_KEY}`
    );
    if (!data) return null;

    // Find the channel result (verified preferred)
    const channels = data.channel_results || [];
    const nameLower = artistName.toLowerCase();
    
    // Try to match by name
    let channel = channels.find(c => 
      c.title?.toLowerCase() === nameLower || 
      c.handle?.toLowerCase().replace('@', '') === nameLower.replace(/\s+/g, '')
    );
    // Fall back to first verified channel, then first result
    if (!channel) channel = channels.find(c => c.verified) || channels[0];

    if (!channel) {
      // Try extracting from video results
      const vids = data.video_results || [];
      const topVid = vids[0];
      if (topVid?.channel) {
        return {
          subscribers: null,
          topVideoViews: topVid.views || null,
          handle: topVid.channel?.link || null,
          channelName: topVid.channel?.name || null,
          source: 'video_result'
        };
      }
      return null;
    }

    // Get top video views from video results
    const vids = (data.video_results || []).slice(0, 5);
    const topViews = vids.reduce((max, v) => Math.max(max, v.views || 0), 0);

    return {
      subscribers: channel.subscribers || null,
      topVideoViews: topViews || null,
      handle: channel.handle || null,
      channelName: channel.title || null,
      thumbnail: channel.thumbnail || null,
      verified: channel.verified || false,
      source: 'channel_result'
    };
  } catch (e) {
    console.error(`  YouTube error for ${artistName}: ${e.message}`);
    return null;
  }
}

function formatSubs(n) {
  if (!n) return '?';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

async function run() {
  console.log('📺 YouTube Enrichment starting...');
  console.log(`   Budget: ${MAX_CALLS} SerpAPI calls\n`);

  if (!SERPAPI_KEY) {
    console.log('   ❌ No SERPAPI_KEY in .env');
    return null;
  }

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const artists = data.artists || [];

  // Prioritize: artists without YouTube data, then by signals
  const needsYT = artists.filter(a => !a.youtubeSubscribers);
  const sorted = needsYT.sort((a, b) => {
    // Verified/hot artists first
    const aScore = (a.verificationTier === 'RED_HOT' ? 3 : a.verificationTier === 'WARM' ? 2 : 0) + (a.soldOutMentions || 0);
    const bScore = (b.verificationTier === 'RED_HOT' ? 3 : b.verificationTier === 'WARM' ? 2 : 0) + (b.soldOutMentions || 0);
    return bScore - aScore;
  });

  console.log(`   ${sorted.length} artists need YouTube data (${artists.length} total)\n`);

  let enriched = 0;
  const results = [];

  for (const artist of sorted) {
    if (callsUsed >= MAX_CALLS) {
      console.log(`\n   ⚠️  Budget exhausted (${callsUsed}/${MAX_CALLS})`);
      break;
    }

    process.stdout.write(`  ${artist.name}...`);
    const yt = await getYouTubeData(artist.name);
    await sleep(500); // Rate limit

    if (yt && (yt.subscribers || yt.topVideoViews)) {
      artist.youtubeSubscribers = yt.subscribers;
      artist.youtubeTopVideoViews = yt.topVideoViews;
      artist.youtubeHandle = yt.handle;
      artist.youtubeVerified = yt.verified;
      enriched++;
      console.log(` ✅ ${formatSubs(yt.subscribers)} subs, top video: ${formatSubs(yt.topVideoViews)} views`);
      results.push({ name: artist.name, subs: yt.subscribers, topViews: yt.topVideoViews });
    } else {
      console.log(' —');
    }
  }

  // Save
  data.lastYoutubeEnrichment = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log(`\n✅ YouTube Enrichment complete`);
  console.log(`   ${enriched} artists enriched out of ${callsUsed} calls`);
  
  if (results.length) {
    console.log('\n📺 Top by subscribers:');
    results.sort((a, b) => (b.subs || 0) - (a.subs || 0)).slice(0, 10)
      .forEach(r => console.log(`   ${r.name}: ${formatSubs(r.subs)} subs`));
  }

  return results;
}

function formatDiscordAlert(results) {
  if (!results || !results.length) return '';
  const top = results.sort((a, b) => (b.subs || 0) - (a.subs || 0)).slice(0, 5);
  return `📺 **YouTube enrichment**: ${results.length} artists updated\nTop: ${top.map(r => `${r.name} (${formatSubs(r.subs)})`).join(', ')}`;
}

module.exports = { run, formatDiscordAlert };
if (require.main === module) run().catch(console.error);
