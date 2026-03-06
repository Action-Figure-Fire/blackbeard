/**
 * Blackbeard 🏴‍☠️ — Breakout Predictor Cron Wrapper
 * Runs daily at 7 AM ET — predicts which artists will crush presales
 */
const { runBreakoutScan } = require('./breakout-predictor');

async function main() {
  console.log('🔮 Breakout Predictor starting...');
  try {
    const { results, alertMsg } = await runBreakoutScan();
    if (alertMsg) {
      console.log('\n--- DISCORD ALERT ---');
      console.log(alertMsg);
    } else {
      console.log('✅ Scan complete. No high-confidence breakout predictions at this time.');
    }
  } catch (e) {
    console.error('❌ Breakout Predictor error:', e.message);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
