/**
 * Blackbeard Cron Reporter 🏴‍☠️
 * Runs the scan and outputs the formatted Discord report to stdout
 * Designed to be called by OpenClaw cron which sends the output to Discord
 */

const { runScan, formatReport } = require('./scanner');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

async function main() {
  const report = await runScan();
  const dateStr = new Date().toISOString().split('T')[0];
  fs.writeFileSync(path.join(REPORTS_DIR, `${dateStr}.json`), JSON.stringify(report, null, 2));

  // Output formatted report for Discord delivery
  console.log(formatReport(report));
}

main().catch(err => {
  console.error('Blackbeard cron failed:', err);
  process.exit(1);
});
