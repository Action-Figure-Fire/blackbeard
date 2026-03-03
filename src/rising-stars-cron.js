#!/usr/bin/env node
/**
 * Rising Stars Scanner Cron Wrapper
 * Announces start/finish to Discord alerts channel
 */

const { run, formatDiscordAlert } = require('./spotify-scanner');

const ALERT_CHANNEL = '1476967271334285497';

async function sendDiscord(msg) {
  // Output for OpenClaw to pick up
  console.log(`\n--- ALERT ---\n${msg}\n--- END ---`);
}

async function main() {
  const startTime = Date.now();
  await sendDiscord('🌟 **Rising Stars scan starting...** Scanning all watchlist artists + discovering new talent.');
  
  try {
    const results = await run();
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    let msg = formatDiscordAlert(results);
    msg += `\n⏱️ Scan completed in ${elapsed} min`;
    
    await sendDiscord(msg);
    
    // Git commit the results
    const { execSync } = require('child_process');
    try {
      execSync('cd /home/node/.openclaw/workspace/blackbeard && git add docs/data/rising-stars.json data/spotify-data.json data/spotify-history.json && git commit -m "Rising Stars scan $(date +%Y-%m-%d)" && git push', { stdio: 'pipe' });
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
