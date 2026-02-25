# 🏴‍☠️ Blackbeard

Sold-out event treasure hunter. Scans Reddit, X, and fan forums for buzz around sold-out concerts, comedy shows, and sporting events (especially obscure ones).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/reports/latest` | Latest scan report (JSON) |
| GET | `/api/reports/:date` | Report by date (YYYY-MM-DD) |
| GET | `/api/reports` | List all reports |
| GET | `/api/reports/latest/formatted` | Discord-formatted report |
| POST | `/api/scan` | Trigger manual scan |
| GET | `/` | Web dashboard |

## Quick Start

```bash
npm install
npm start          # Start API server on port 3001
npm run scan       # Run a one-off scan
```

## Scoring (0-100)

- **Volume** (0-40): Number of mentions
- **Velocity** (0-20): How recent the buzz is
- **Scarcity** (0-25): Intensity of "sold out" / "can't get tickets" language
- **Obscurity** (0-15): Bonus for niche/small events (venues <10k)
- **Engagement** (0-10): Reddit upvotes + comment activity

## Config

- `BLACKBEARD_PORT` — API port (default: 3001)

## Filters

- US events only
- Excludes large venues (>10k capacity indicators)
- Categories: Comedy 🎤 | Concerts 🎵 | Sports 🏆 | Other 🎟️
