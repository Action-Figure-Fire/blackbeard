#!/usr/bin/env node
// Email Alert System for Blackbeard
// Sends personalized email alerts to registered users
// Uses Resend API (free: 100 emails/day, 3000/month)
// 
// Setup: Add RESEND_API_KEY to .env
// Sign up at https://resend.com (free tier)

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUBSCRIBERS_PATH = path.join(__dirname, '..', 'data', 'subscribers.json');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'artist-sites-cache.json');
const FROM_EMAIL = 'alerts@blackbeard.tickets'; // Needs verified domain on Resend

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadSubscribers() {
  try { return JSON.parse(fs.readFileSync(SUBSCRIBERS_PATH, 'utf8')); }
  catch { return { users: [] }; }
}

function saveSubscribers(data) {
  fs.writeFileSync(SUBSCRIBERS_PATH, JSON.stringify(data, null, 2));
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`  📧 [DRY RUN] Would send to ${to}: ${subject}`);
    return { success: true, dryRun: true };
  }
  
  const body = JSON.stringify({
    from: FROM_EMAIL,
    to: [to],
    subject,
    html,
  });
  
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(d);
          resolve({ success: res.statusCode === 200, result });
        } catch {
          resolve({ success: false, error: d });
        }
      });
    });
    req.on('error', e => resolve({ success: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

function buildAlertEmail(alerts, userName) {
  const rows = alerts.map(a => {
    const icon = a.type === 'new_show' ? '🆕' : a.type === 'sold_out' ? '🔥' : a.type === 'presale' ? '🔑' : '💰';
    return `<tr>
      <td style="padding:12px 16px;border-bottom:1px solid #27272a;font-size:14px;color:#d4d4d8">
        ${icon} <strong style="color:#fafafa">${a.artist}</strong> — ${a.message}
        <br><span style="font-size:11px;color:#71717a">${a.time || ''}</span>
      </td>
    </tr>`;
  }).join('');
  
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #27272a">
      <div style="font-size:24px;margin-bottom:4px">🏴‍☠️</div>
      <div style="font-size:18px;font-weight:700;color:#fafafa">Blackbeard Alerts</div>
      <div style="font-size:12px;color:#71717a;margin-top:4px">${new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})}</div>
    </div>
    
    <div style="padding:16px 0">
      <div style="font-size:13px;color:#a1a1aa;margin-bottom:16px">Hey${userName ? ' ' + userName : ''}, here's what changed with your tracked artists:</div>
      <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden">
        ${rows}
      </table>
    </div>
    
    <div style="text-align:center;padding:20px 0">
      <a href="https://action-figure-fire.github.io/blackbeard/" style="display:inline-block;background:#fbbf24;color:#000;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">View Dashboard →</a>
    </div>
    
    <div style="text-align:center;padding:16px 0;border-top:1px solid #27272a;font-size:11px;color:#52525b">
      Blackbeard — Presale Intelligence for Ticket Brokers<br>
      <a href="#" style="color:#52525b">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

function buildDigestEmail(stats, topAlerts) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #27272a">
      <div style="font-size:24px;margin-bottom:4px">🏴‍☠️</div>
      <div style="font-size:18px;font-weight:700;color:#fafafa">Daily Digest</div>
      <div style="font-size:12px;color:#71717a;margin-top:4px">${new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}</div>
    </div>
    
    <div style="display:flex;gap:12px;padding:20px 0;justify-content:center">
      <div style="background:#18181b;border-radius:8px;padding:16px 20px;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:700;color:#fbbf24">${stats.artistsTracked}</div>
        <div style="font-size:10px;color:#71717a;letter-spacing:1px">ARTISTS</div>
      </div>
      <div style="background:#18181b;border-radius:8px;padding:16px 20px;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:700;color:#4ade80">${stats.newShows}</div>
        <div style="font-size:10px;color:#71717a;letter-spacing:1px">NEW SHOWS</div>
      </div>
      <div style="background:#18181b;border-radius:8px;padding:16px 20px;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:700;color:#ef4444">${stats.soldOut}</div>
        <div style="font-size:10px;color:#71717a;letter-spacing:1px">SOLD OUT</div>
      </div>
    </div>
    
    ${topAlerts.length ? `<div style="padding:12px 0">
      <div style="font-size:12px;font-weight:700;color:#fafafa;margin-bottom:10px;letter-spacing:0.5px">TOP ALERTS</div>
      ${topAlerts.map(a => `<div style="padding:8px 12px;background:#18181b;border-radius:6px;margin-bottom:6px;font-size:13px;color:#d4d4d8">${a}</div>`).join('')}
    </div>` : ''}
    
    <div style="text-align:center;padding:20px 0">
      <a href="https://action-figure-fire.github.io/blackbeard/" style="display:inline-block;background:#fbbf24;color:#000;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">Open Dashboard →</a>
    </div>
    
    <div style="text-align:center;padding:16px 0;border-top:1px solid #27272a;font-size:11px;color:#52525b">
      Blackbeard — Presale Intelligence for Ticket Brokers
    </div>
  </div>
</body>
</html>`;
}

// CLI: node email-alerts.js --add user@email.com "UserName"
// CLI: node email-alerts.js --send-test user@email.com
// CLI: node email-alerts.js --digest
async function run() {
  const args = process.argv.slice(2);
  const subs = loadSubscribers();
  
  if (args[0] === '--add') {
    const email = args[1];
    const name = args[2] || '';
    if (!email) { console.log('Usage: --add email@example.com "Name"'); return; }
    
    if (!subs.users.find(u => u.email === email)) {
      subs.users.push({
        email,
        name,
        joinDate: new Date().toISOString(),
        prefs: { newShows: true, soldOut: true, presale: true, price: true, digest: false },
        trackedArtists: [], // empty = all
      });
      saveSubscribers(subs);
      console.log(`✅ Added ${email} (${name})`);
    } else {
      console.log(`Already subscribed: ${email}`);
    }
    return;
  }
  
  if (args[0] === '--send-test') {
    const email = args[1] || subs.users[0]?.email;
    if (!email) { console.log('No email specified'); return; }
    
    const testAlerts = [
      { type: 'new_show', artist: 'Josh Johnson', message: 'Added 3 new shows — Ryman Nashville, Masonic SF, Orpheum Minneapolis', time: 'Just now' },
      { type: 'sold_out', artist: 'Sara Landry', message: 'SOLD OUT at SILO Dallas (Apr 11)', time: '2 hours ago' },
      { type: 'presale', artist: 'Alex Warren', message: 'Presale code: AWFORD (Artist presale, 10a-10p)', time: '5 hours ago' },
    ];
    
    const html = buildAlertEmail(testAlerts, 'Test User');
    console.log(`📧 Sending test email to ${email}...`);
    const result = await sendEmail(email, '🏴‍☠️ Blackbeard Test Alert', html);
    console.log(result.dryRun ? '(Dry run — no RESEND_API_KEY set)' : `Result: ${JSON.stringify(result)}`);
    return;
  }
  
  if (args[0] === '--digest') {
    console.log('📊 Sending daily digest...');
    const stats = { artistsTracked: 303, newShows: 4, soldOut: 1 };
    const topAlerts = [
      '🆕 LEVEL UP added 1 new show',
      '🆕 Ella Langley added 1 new show',
      '🆕 Ernest added 2 new shows',
    ];
    
    for (const user of subs.users.filter(u => u.prefs?.digest)) {
      const html = buildDigestEmail(stats, topAlerts);
      const result = await sendEmail(user.email, '🏴‍☠️ Blackbeard Daily Digest', html);
      console.log(`  ${user.email}: ${result.success ? '✅' : '❌'}`);
      await sleep(200);
    }
    return;
  }
  
  // Default: show subscribers
  console.log(`📧 Blackbeard Email System`);
  console.log(`   ${subs.users.length} subscribers`);
  subs.users.forEach(u => console.log(`   - ${u.email} (${u.name || 'no name'}) joined ${u.joinDate?.split('T')[0]}`));
  console.log(`\nCommands:`);
  console.log(`   --add email "Name"    Add subscriber`);
  console.log(`   --send-test email     Send test alert`);
  console.log(`   --digest              Send daily digest to all digest subscribers`);
  console.log(`\n⚠️  Set RESEND_API_KEY in .env for real emails (https://resend.com)`);
}

run().catch(console.error);
