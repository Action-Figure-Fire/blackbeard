/**
 * Blackbeard 🏴‍☠️ — Venue Scanner Cron Wrapper
 * Runs venue price scanner and outputs alert for Discord delivery
 */

const { runVenueScan } = require('./venue-scanner');

async function main() {
  console.log('🏢 Venue Price Scanner starting...');
  
  try {
    const { alerts, alertMsg, allEvents } = await runVenueScan();
    
    if (alertMsg) {
      // Output alert for cron delivery to Discord
      console.log('\n--- DISCORD ALERT ---');
      console.log(alertMsg);
    } else {
      console.log(`✅ Scan complete. ${allEvents.length} events across all venues. No new price alerts.`);
    }
  } catch (e) {
    console.error('❌ Venue scanner error:', e.message);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
