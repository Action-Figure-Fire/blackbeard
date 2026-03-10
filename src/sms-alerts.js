#!/usr/bin/env node
/**
 * SMS Alert System for Blackbeard
 * Uses Twilio API to send targeted SMS alerts
 * 
 * Features:
 * - Presale code alerts
 * - Sold-out alerts  
 * - New tour announcements
 * - Rate limited: max 5 texts/day per subscriber
 * - Targeted: only artists the user opted into
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const MESSAGING_SID = process.env.TWILIO_MESSAGING_SID;
const FROM_PHONE = process.env.TWILIO_PHONE;
const SUBSCRIBERS_FILE = path.join(__dirname, '..', 'data', 'sms-subscribers.json');
const SMS_LOG_FILE = path.join(__dirname, '..', 'data', 'sms-log.json');
const MAX_SMS_PER_DAY = 5;

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function saveJSON(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

function loadSubscribers() {
  return loadJSON(SUBSCRIBERS_FILE) || { subscribers: [] };
}

function loadLog() {
  const log = loadJSON(SMS_LOG_FILE) || { sent: [] };
  // Clean entries older than 24h
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  log.sent = log.sent.filter(e => e.timestamp > cutoff);
  return log;
}

function countTodaySMS(log, phone) {
  const today = new Date().toISOString().split('T')[0];
  return log.sent.filter(e => e.phone === phone && e.date === today).length;
}

async function sendSMS(to, body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    console.log(`  📱 [DRY RUN] → ${to}: ${body.slice(0, 80)}...`);
    return { success: true, dryRun: true };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams();
  if (MESSAGING_SID) {
    params.append('MessagingServiceSid', MESSAGING_SID);
  } else {
    params.append('From', FROM_PHONE);
  }
  params.append('To', to);
  params.append('Body', body);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });
    const data = await res.json();
    if (res.ok || res.status === 201) {
      console.log(`  ✅ SMS sent to ${to}: ${data.sid}`);
      return { success: true, sid: data.sid };
    } else {
      console.error(`  ❌ SMS failed to ${to}: ${data.message || data.code}`);
      return { success: false, error: data.message || data.code };
    }
  } catch (e) {
    console.error(`  ❌ SMS error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// Send alert to all subscribers (respecting rate limits and preferences)
async function sendAlert(alert) {
  const { type, artist, message } = alert;
  const subs = loadSubscribers();
  const log = loadLog();
  let sent = 0, skipped = 0;

  for (const sub of subs.subscribers) {
    if (!sub.active) { skipped++; continue; }
    
    // Check rate limit
    if (countTodaySMS(log, sub.phone) >= MAX_SMS_PER_DAY) {
      console.log(`  ⏭️ ${sub.phone} hit daily limit (${MAX_SMS_PER_DAY})`);
      skipped++;
      continue;
    }

    // Check if subscriber wants this type of alert
    if (sub.alertTypes && !sub.alertTypes.includes(type) && !sub.alertTypes.includes('all')) {
      skipped++;
      continue;
    }

    // Check if subscriber tracks this artist (if artist-specific)
    if (artist && sub.artists && sub.artists.length > 0) {
      const tracked = sub.artists.map(a => a.toLowerCase());
      if (!tracked.includes(artist.toLowerCase()) && !tracked.includes('all')) {
        skipped++;
        continue;
      }
    }

    const result = await sendSMS(sub.phone, message);
    if (result.success) {
      sent++;
      log.sent.push({
        phone: sub.phone,
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now(),
        type,
        artist: artist || '',
        message: message.slice(0, 100)
      });
    }
  }

  saveJSON(SMS_LOG_FILE, log);
  console.log(`📱 Alert sent: ${sent} delivered, ${skipped} skipped`);
  return { sent, skipped };
}

// Send a single test SMS
async function sendTest(phone, message) {
  if (!message) {
    message = `🏴‍☠️ BLACKBEARD TEST\n\nThis week's alerts:\n🔴 Zeds Dead presale Tue 10am\n🎤 Jonas Brothers presale today\n🔑 Arlo Parks code: MODO (Thu)\n🤘 Metallica 6 new Sphere dates\n\nDashboard: action-figure-fire.github.io/blackbeard`;
  }
  return await sendSMS(phone, message);
}

// Add a subscriber
function addSubscriber(phone, name, options = {}) {
  const subs = loadSubscribers();
  const existing = subs.subscribers.find(s => s.phone === phone);
  if (existing) {
    Object.assign(existing, { name, ...options, active: true });
  } else {
    subs.subscribers.push({
      phone,
      name: name || '',
      active: true,
      alertTypes: options.alertTypes || ['all'], // presale, sold_out, new_tour, all
      artists: options.artists || ['all'],
      addedAt: new Date().toISOString()
    });
  }
  saveJSON(SUBSCRIBERS_FILE, subs);
  console.log(`📱 Subscriber added: ${phone} (${name || 'unnamed'})`);
  return subs;
}

// Format presale alert for SMS (160 char limit friendly)
function formatPresaleAlert(event) {
  let msg = `🏴‍☠️ PRESALE ALERT\n\n`;
  msg += `${event.artist}\n`;
  if (event.code) msg += `🔑 Code: ${event.code}\n`;
  msg += `⏰ ${event.date}\n`;
  if (event.link) msg += `🎟️ ${event.link}`;
  return msg;
}

function formatSoldOutAlert(event) {
  return `🏴‍☠️ SOLD OUT\n\n${event.artist} — ${event.venue}\n${event.city}\n\nSecondary pricing rising. Check dashboard.`;
}

function formatNewTourAlert(event) {
  let msg = `🏴‍☠️ NEW TOUR\n\n${event.artist}\n`;
  msg += `📍 ${event.dates || 'Dates TBA'}\n`;
  if (event.onsale) msg += `🎟️ Onsale: ${event.onsale}`;
  return msg;
}

module.exports = { sendSMS, sendAlert, sendTest, addSubscriber, formatPresaleAlert, formatSoldOutAlert, formatNewTourAlert };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'test' && args[1]) {
    sendTest(args[1]).then(r => console.log(r));
  } else if (args[0] === 'add' && args[1]) {
    addSubscriber(args[1], args[2] || '');
  } else {
    console.log('Usage:');
    console.log('  node sms-alerts.js test +1234567890');
    console.log('  node sms-alerts.js add +1234567890 "Name"');
  }
}
