# 🏴‍☠️ Blackbeard

Emerging artist discovery & ticket market intelligence platform. Tracks 300+ artists across multiple data sources to identify breakout tours, underpriced tickets, and presale opportunities before the market catches on.

## What It Does

- **Artist Discovery** — Scans Bandsintown, Songkick, Spotify, and X/Twitter for emerging artists with growing demand
- **Presale Intel** — Monitors upcoming presales and onsales across all genres (3x daily)
- **Breakout Prediction** — Identifies artists likely to outgrow their venue tier (accuracy tracked)
- **Comedy Scanner** — Dedicated comedy show tracking with sellout detection
- **Venue Monitoring** — Tracks 49 GA venues for pricing trends and sellout velocity
- **Routing Gap Analysis** — Finds cities artists haven't played in 3+ years

## Scanners (18 active crons)

| Scanner | Schedule | Channel |
|---------|----------|---------|
| Watchlist | Daily 3AM UTC | #blackbeard |
| Underground | Daily 4AM ET | #blackbeard |
| Bandsintown | Daily 7AM ET | #blackbeard |
| Rising Stars | Daily 6AM ET | #blackbeard |
| Breakout Predictor | Daily 11AM ET | #blackbeard |
| SerpAPI Intelligence | Daily 10AM ET | #blackbeard |
| Venue Price Monitor | Daily 8AM ET | #blackbeard |
| Comedy | Daily 2PM UTC | #alerts |
| Presale Scanner | 7AM / 12PM / 5PM UTC | #alerts |
| Twitter/X | 8AM + 8PM ET (Sun-Fri) | #blackbeard |
| Accuracy Tracker | Mon + Thu 9AM ET | #blackbeard |
| Steelers PSL | Daily 12PM ET | #blackbeard |

## Artist Tiers

- 🔴 **RED HOT** — Vet score 75+, high demand signals, immediate action needed
- 🟠 **WARM** — Vet score 50-74, worth watching, may escalate
- ⚪ **UNVETTED** — Newly discovered, needs enrichment

## Data Sources

- **Bandsintown API** (free, no key needed)
- **Brave Search** (API key in .env)
- **SeatGeek** (API key in .env) — pricing, event links
- **X/Twitter** (Bearer token in .env) — tour announcements, presale intel
- **Songkick** (scraped via search)

## Structure

```
src/           — Scanner modules (35 files)
data/          — Cache files, watchlist, state
reports/       — Daily scan outputs
docs/          — Web dashboard (GitHub Pages)
```

## Quick Start

```bash
npm install
npm start          # API server on port 3001
npm run scan       # One-off scan
```

## Dashboard

Live at: `docs/index.html` (deploy via GitHub Pages)
Features: Optimus-style cards, genre filters, artist photos, ROI calculator

## Roadmap

- [ ] OneSignal push notifications
- [ ] Historical accuracy tracker (predictions vs outcomes)
- [ ] Custom alert rules by genre/region
- [ ] Broker-facing landing page + pricing
- [ ] Spotify integration (awaiting credentials)
