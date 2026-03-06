/**
 * Auto-fetch missing artist images — called by rising-stars-cron
 * Only fetches images for artists that don't have one yet
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getImage(name) {
  try {
    const url = `https://api.seatgeek.com/2/performers?q=${encodeURIComponent(name)}&client_id=${SEATGEEK_CLIENT_ID}`;
    const res = await fetch(url);
    if (res.status !== 200) return null;
    const data = await res.json();
    if (!data.performers?.length) return null;
    const p = data.performers[0];
    return p.images?.huge || p.images?.large || p.images?.medium || p.images?.small || p.image || null;
  } catch { return null; }
}

module.exports = async function fetchImagesAuto() {
  const rsPath = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
  if (!fs.existsSync(rsPath)) return;
  
  const rs = JSON.parse(fs.readFileSync(rsPath, 'utf8'));
  const missing = rs.artists.filter(a => !a.imageUrl);
  
  if (!missing.length) {
    console.log('  All artists have images ✅');
    return;
  }
  
  console.log(`  Fetching images for ${missing.length} artists...`);
  let found = 0;
  
  for (const a of missing) {
    const img = await getImage(a.name);
    if (img) { a.imageUrl = img; found++; }
    await sleep(200);
  }
  
  fs.writeFileSync(rsPath, JSON.stringify(rs, null, 2));
  console.log(`  ✅ Found ${found}/${missing.length} missing images`);
};
