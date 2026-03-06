#!/usr/bin/env node
/**
 * Fetch artist images from SeatGeek performers API
 * Saves image URLs to rising-stars.json
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
    
    // Find best match
    const p = data.performers[0];
    // SeatGeek provides multiple sizes
    const img = p.images?.huge || p.images?.large || p.images?.medium || p.images?.small || p.image;
    return img || null;
  } catch { return null; }
}

async function main() {
  const rsPath = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
  const rs = JSON.parse(fs.readFileSync(rsPath, 'utf8'));
  
  let found = 0;
  let missed = 0;
  
  for (const a of rs.artists) {
    if (a.imageUrl) { found++; continue; } // Skip if already have one
    
    process.stdout.write(`  📸 ${a.name}...`);
    const img = await getImage(a.name);
    
    if (img) {
      a.imageUrl = img;
      found++;
      console.log(' ✅');
    } else {
      missed++;
      console.log(' ❌');
    }
    await sleep(200);
  }
  
  fs.writeFileSync(rsPath, JSON.stringify(rs, null, 2));
  console.log(`\n✅ Done: ${found} images found, ${missed} missing`);
}

main().catch(console.error);
