/**
 * Blackbeard 🏴‍☠️ — Presale Scanner Cron Wrapper
 * Runs 3x daily: 7 AM, 12 PM, 5 PM ET
 */
const { runPresaleScan } = require('./presale-scanner');

async function main() {
  console.log('🎟️ Presale Intelligence Scanner starting...');
  try {
    const { alerts, alertMsg } = await runPresaleScan();
    if (alertMsg) {
      console.log('\n--- DISCORD ALERT ---');
      console.log(alertMsg);
    } else {
      console.log('✅ No new presale alerts.');
    }
  } catch (e) {
    console.error('❌ Presale scanner error:', e.message);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
