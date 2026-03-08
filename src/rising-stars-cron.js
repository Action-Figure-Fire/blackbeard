#!/usr/bin/env node
/**
 * Rising Stars Scanner Cron Wrapper
 * Announces start/finish to Discord alerts channel
 */

const { run: runWatchlist, formatDiscordAlert: formatWatchlist } = require('./spotify-scanner');
const { run: runPlaylist, formatDiscordAlert: formatPlaylist } = require('./playlist-discovery');
const { run: runTikTok, formatDiscordAlert: formatTikTok } = require('./tiktok-trend-scanner');
const { run: runPodcast, formatDiscordAlert: formatPodcast } = require('./comedy-podcast-scanner');
const { run: runGaming, formatDiscordAlert: formatGaming } = require('./gaming-culture-scanner');

async function sendDiscord(msg) {
  console.log(`\n--- ALERT ---\n${msg}\n--- END ---`);
}

async function main() {
  const startTime = Date.now();
  await sendDiscord('🌟 **Rising Stars scan starting...** Scanning watchlist + editorial playlists.');
  
  try {
    // Phase 1: Watchlist scan
    console.log('\n========== WATCHLIST SCAN ==========');
    const watchlistResults = await runWatchlist();
    
    // Phase 2: Playlist discovery
    console.log('\n========== PLAYLIST DISCOVERY ==========');
    const playlistResults = await runPlaylist();
    
    // Phase 3: TikTok trend scan
    console.log('\n========== TIKTOK TREND SCAN ==========');
    let tiktokResults = null;
    try {
      tiktokResults = await runTikTok();
    } catch (e) {
      console.log('TikTok scan error:', e.message?.slice(0, 200));
    }
    
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    let msg = formatWatchlist(watchlistResults);
    msg += '\n\n' + formatPlaylist(playlistResults);
    if (tiktokResults) msg += '\n\n' + formatTikTok(tiktokResults);
    
    // Phase 4: Comedy podcast scan
    console.log('\n========== COMEDY PODCAST SCAN ==========');
    let podcastResults = null;
    try {
      podcastResults = await runPodcast();
    } catch (e) {
      console.log('Podcast scan error:', e.message?.slice(0, 200));
    }
    if (podcastResults) msg += '\n\n' + formatPodcast(podcastResults);
    
    // Phase 5: Gaming & culture scan
    console.log('\n========== GAMING & CULTURE SCAN ==========');
    let gamingResults = null;
    try {
      gamingResults = await runGaming();
    } catch (e) {
      console.log('Gaming scan error:', e.message?.slice(0, 200));
    }
    if (gamingResults) msg += '\n\n' + formatGaming(gamingResults);
    msg += `\n⏱️ Full scan completed in ${elapsed} min`;
    
    await sendDiscord(msg);
    
    // Fetch artist images for any new/missing thumbnails
    console.log('\n========== FETCHING ARTIST IMAGES ==========');
    try {
      require('./fetch-images-auto')();
    } catch (e) {
      console.log('Image fetch skipped:', e.message?.slice(0, 100));
    }

    // Git commit the results
    const { execSync } = require('child_process');
    try {
      execSync('cd /home/node/.openclaw/workspace/blackbeard && git add docs/data/ data/ && git commit -m "Rising Stars scan $(date +%Y-%m-%d)" && git push', { stdio: 'pipe' });
      console.log('Git push complete');
    } catch (e) {
      console.log('Git push skipped:', e.message?.slice(0, 100));
    }
    
  } catch (e) {
    await sendDiscord(`❌ Rising Stars scan failed: ${e.message}`);
    process.exit(1);
  }
}

main();
