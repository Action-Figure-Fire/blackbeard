#!/usr/bin/env node
/**
 * Spotify OAuth Authorization Code Flow
 * 
 * Step 1: Run this to get the auth URL
 * Step 2: User visits the URL and authorizes
 * Step 3: User pastes the redirect URL back
 * Step 4: We exchange for access + refresh tokens
 */

require('dotenv').config();
const http = require('http');
const https = require('https');
const { URL } = require('url');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'https://localhost:8080/callback';
const SCOPES = 'user-read-private'; // Minimal scope needed for full artist data

const args = process.argv.slice(2);

if (args[0] === 'url') {
  // Step 1: Generate auth URL
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'true'
  });
  console.log('\n🎵 Open this URL in your browser:\n');
  console.log(`https://accounts.spotify.com/authorize?${params.toString()}`);
  console.log('\nAfter authorizing, you\'ll be redirected to a localhost URL that won\'t load.');
  console.log('Copy the FULL URL from your browser address bar and run:');
  console.log('\n  node src/spotify-auth.js exchange "THE_FULL_URL"\n');
  
} else if (args[0] === 'exchange') {
  // Step 2: Exchange code for tokens
  const url = new URL(args[1]);
  const code = url.searchParams.get('code');
  if (!code) { console.error('No code found in URL'); process.exit(1); }
  
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI
  }).toString();
  
  const req = https.request({
    hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` }
  }, res => {
    let b = ''; res.on('data', d => b += d);
    res.on('end', () => {
      const j = JSON.parse(b);
      if (j.error) { console.error('Error:', j.error, j.error_description); return; }
      console.log('\n✅ Success! Add these to your .env file:\n');
      console.log(`SPOTIFY_REFRESH_TOKEN=${j.refresh_token}`);
      console.log(`\nAccess token (expires in ${j.expires_in}s): ${j.access_token.slice(0,30)}...`);
    });
  });
  req.write(body); req.end();
  
} else if (args[0] === 'refresh') {
  // Step 3: Refresh token
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) { console.error('No SPOTIFY_REFRESH_TOKEN in .env'); process.exit(1); }
  
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();
  
  const req = https.request({
    hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` }
  }, res => {
    let b = ''; res.on('data', d => b += d);
    res.on('end', () => {
      const j = JSON.parse(b);
      if (j.error) { console.error('Error:', j.error, j.error_description); return; }
      console.log('Access token:', j.access_token);
      console.log('Expires in:', j.expires_in, 'seconds');
    });
  });
  req.write(body); req.end();
  
} else {
  console.log('Usage:');
  console.log('  node src/spotify-auth.js url          # Get authorization URL');
  console.log('  node src/spotify-auth.js exchange URL  # Exchange code for tokens');
  console.log('  node src/spotify-auth.js refresh       # Test refresh token');
}
