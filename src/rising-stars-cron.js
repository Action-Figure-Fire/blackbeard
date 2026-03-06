#!/usr/bin/env node
/**
 * Rising Stars Scanner Cron Wrapper
 * Announces start/finish to Discord alerts channel
 */

const { run: runWatchlist, formatDiscordAlert: formatWatchlist } = require('./spotify-scanner');
const { run: runPlaylist, formatDiscordAlert: formatPlaylist } = require('./playlist-discovery');

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
    
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    let msg = formatWatchlist(watchlistResults);
    msg += '\n\n' + formatPlaylist(playlistResults);
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
