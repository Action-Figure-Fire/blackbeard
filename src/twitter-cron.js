/**
 * Blackbeard 🏴‍☠️ — Twitter/X Scanner Cron Wrapper
 * Runs 4x daily for real-time presale code catching
 */
const { runSearchScan } = require('./twitter-stream');

async function main() {
  console.log('🐦 Twitter/X Presale Scanner starting...');
  try {
    const { alerts, alertMsg } = await runSearchScan();
    if (alertMsg) {
      console.log('\n--- DISCORD ALERT ---');
      console.log(alertMsg);
    } else {
      console.log('✅ No new Twitter presale alerts.');
    }
  } catch (e) {
    console.error('❌ Twitter scanner error:', e.message);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
