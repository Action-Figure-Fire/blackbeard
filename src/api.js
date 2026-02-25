/**
 * Blackbeard API 🏴‍☠️
 * REST API for accessing scan results and triggering scans
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { runScan, formatReport } = require('./scanner');

const app = express();
const PORT = process.env.BLACKBEARD_PORT || 3001;
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure dirs exist
[REPORTS_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

app.use(express.json());

// --- CORS for GitHub Pages / external frontends ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Blackbeard 🏴‍☠️', version: '1.0.0' });
});

// --- Get latest report ---
app.get('/api/reports/latest', (req, res) => {
  try {
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    if (!files.length) return res.json({ error: 'No reports yet', events: [] });
    const report = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, files[0])));
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Get report by date ---
app.get('/api/reports/:date', (req, res) => {
  try {
    const filePath = path.join(REPORTS_DIR, `${req.params.date}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not found' });
    const report = JSON.parse(fs.readFileSync(filePath));
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- List all reports ---
app.get('/api/reports', (req, res) => {
  try {
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    const reports = files.map(f => ({
      date: f.replace('.json', ''),
      path: `/api/reports/${f.replace('.json', '')}`
    }));
    res.json({ reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Trigger manual scan ---
app.post('/api/scan', async (req, res) => {
  try {
    const report = await runScan();
    const dateStr = new Date().toISOString().split('T')[0];
    fs.writeFileSync(path.join(REPORTS_DIR, `${dateStr}.json`), JSON.stringify(report, null, 2));
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Get formatted Discord report ---
app.get('/api/reports/latest/formatted', (req, res) => {
  try {
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    if (!files.length) return res.json({ message: 'No reports yet' });
    const report = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, files[0])));
    res.json({ message: formatReport(report) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Dashboard (static HTML) ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏴‍☠️ Blackbeard API running on port ${PORT}`);
});

module.exports = app;
