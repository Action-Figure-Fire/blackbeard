/**
 * Comedy Scanner Cron Job
 * Runs comedy scan and reports new finds
 * Designed to be called by OpenClaw cron
 */

const { runComedyScan } = require('./comedy-scanner');
const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const { shows, alert } = await runComedyScan();

    // Check against previous scan to only alert on NEW shows
    const prevPath = path.join(__dirname, '..', 'reports', 'comedy-prev.json');
    let prevUrls = new Set();
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
      prevUrls = new Set((prev.shows || []).map(s => s.url));
    } catch (e) { /* no previous scan */ }

    const newShows = shows.filter(s => !prevUrls.has(s.url));

    // Save current as previous for next run
    fs.writeFileSync(prevPath, JSON.stringify({ shows }, null, 2));

    if (newShows.length > 0) {
      console.log(`\n🎤 ${newShows.length} NEW comedy shows found!\n`);
      for (const s of newShows) {
        console.log(`- ${s.comedian} @ ${s.venue}`);
        console.log(`  ${s.text.substring(0, 150)}`);
        if (s.url) console.log(`  ${s.url}`);
        console.log('');
      }

      // Output formatted alert for Discord
      if (alert) {
        console.log('---DISCORD_ALERT---');
        console.log(alert);
      }
    } else {
      console.log('No new comedy shows since last scan.');
    }

    process.exit(0);
  } catch (e) {
    console.error('Comedy scan error:', e.message);
    process.exit(1);
  }
}

main();
