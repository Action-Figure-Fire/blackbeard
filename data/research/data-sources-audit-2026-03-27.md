# Data Sources Audit — 2026-03-27

Comprehensive research on ticket resale and event data extraction methods for BrokerBeacon.

---

## 1. StubHub

### 1a. Official StubHub API (via viagogo)
- **URL:** `https://api.stubhub.net` | Docs: https://developer.stubhub.com/docs/overview/introduction/
- **GitHub docs:** https://github.com/viagogo/stubhub-api-docs
- **Authentication:** OAuth2 (requires affiliate/partner approval)
- **Access:** Must email `affiliates@stubhub.com` with Partnerize company name/ID and app description. Affiliate partners get API access through the Partnerize network.
- **Format:** `application/hal+json` (JSON with hyperlinks)
- **Endpoints:** Event search, event details, ticket listings, purchasing, listing tickets
- **Rate Limits:** Not publicly documented; granted per-account
- **Cost:** Free with approved affiliate partnership (commission-based)
- **Data Available:** Events, venues, ticket listings with pricing, inventory
- **Sample Call:**
  ```
  GET https://api.stubhub.net/sellers/listings/search?eventId=123456
  Authorization: Bearer <token>
  ```

### 1b. StubHub schema.org JSON-LD (Scraping)
- **Method:** ScrapingBee with `render_js=true`, `premium_proxy=true`, `wait=10000`
- **URL Pattern:** `https://www.stubhub.com/event/{slug}/{event_id}`
- **Data Available:** Event name, date, venue, performer, ticket price range (minPrice/maxPrice), currency, availability
- **Cost:** ScrapingBee pricing (~$49/mo for 150K credits; premium proxy uses 10-75 credits/request)
- **Status:** ✅ CONFIRMED WORKING — already in use
- **Rate Limits:** ScrapingBee plan limits; StubHub may block excessive requests
- **Notes:** JSON-LD embedded in `<script type="application/ld+json">` tags. Contains schema.org `Event` data with `offers` pricing.

### 1c. StubHub Internal/GraphQL API
- **Method:** Reverse-engineer browser network requests via DevTools
- **Approach:** Monitor XHR/Fetch calls on stubhub.com event pages; StubHub's frontend makes REST calls to internal APIs for listing data, pricing, seat maps
- **Risk:** Undocumented, may change without notice, potential ToS violation
- **No confirmed public GraphQL endpoint found** — StubHub appears to use REST internally

### 1d. StubHub Price History
- **No public API for historical pricing.** The official API provides current listings only.
- **Workaround:** Build your own historical dataset by polling listings over time and storing snapshots.

---

## 2. SeatGeek

### 2a. Official SeatGeek Platform API
- **URL:** `https://api.seatgeek.com/2/`
- **Docs:** https://platform.seatgeek.com/ (developer.seatgeek.com redirects here)
- **Authentication:** `client_id` query parameter (we have client_id + client_secret)
- **Cost:** Free tier available
- **Rate Limits:** Undocumented officially; community reports ~1000 req/hr
- **Endpoints:**
  - `GET /events` — search events (query, city, venue, performer, date range, geo)
  - `GET /events/{id}` — event details
  - `GET /performers` — search performers
  - `GET /performers/{id}` — performer details
  - `GET /venues` — search venues
  - `GET /venues/{id}` — venue details
  - `GET /recommendations` — personalized recommendations
- **Data Available:** Event name, date, venue, performers, taxonomies, stats (lowest_price, average_price, highest_price, listing_count), score, popularity
- **Sample Call:**
  ```
  GET https://api.seatgeek.com/2/events?q=taylor+swift&client_id=YOUR_CLIENT_ID
  ```
- **Pricing Data:** ✅ YES — `stats` object includes `lowest_price`, `average_price`, `highest_price`, `listing_count` for secondary market
- **Notes:** One of the best free APIs for secondary market pricing data. The `stats` object is key for BrokerBeacon.

### 2b. SeatGeek Partner API
- **Requires partnership agreement** for deeper inventory/transactional access
- **Contact:** Through SeatGeek's partner program

---

## 3. TickPick

### 3a. TickPick Affiliate API
- **URL:** https://www.tickpick.com/affiliates/
- **Authentication:** API key (provided upon affiliate approval)
- **Access:** Apply through affiliate program (managed via Impact/Sovrn)
- **Data Available:** "Competitively-priced ticket inventory" — event listings, pricing, availability
- **Features:** API access OR custom widgets
- **Cost:** Free to join; commission-based (2.91% per sale reported)
- **Rate Limits:** Not publicly documented
- **Notes:** TickPick's key differentiator is no-fee pricing. Their affiliate API provides inventory data. Must apply and be approved.

### 3b. TickPick Scraping
- **No public developer API** outside the affiliate program
- **TickPick uses React SPA** — requires JS rendering for scraping
- **Approach:** ScrapingBee with `render_js=true` to extract listing data from event pages
- **schema.org data:** May be present in SSR output — needs testing

---

## 4. Ticketmaster (Discovery API)

### 4a. Discovery API v2
- **URL:** `https://app.ticketmaster.com/discovery/v2/`
- **Docs:** https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
- **Authentication:** API key via `apikey` query parameter
- **Cost:** FREE — sign up at developer.ticketmaster.com
- **Rate Limits:** 5,000 requests/day (free tier), rate limited per second
- **Endpoints:**
  - `GET /events` — search events (keyword, city, venue, date range, classificationId, onsaleStartDateTime, etc.)
  - `GET /events/{id}` — event details
  - `GET /events/{id}/images` — event images
  - `GET /attractions` — search attractions
  - `GET /attractions/{id}` — attraction details
  - `GET /venues` — search venues
  - `GET /venues/{id}` — venue details
  - `GET /classifications` — browse categories
  - `GET /suggest` — autocomplete/suggest
- **Data Available:**
  - Event name, dates (start, end, onsale, presale), status
  - Venue details (name, address, lat/lng, capacity)
  - Attractions/performers
  - Price ranges (min/max face value — NOT resale)
  - Classifications (genre, subgenre, segment)
  - Images
  - **Presale info:** `sales.presales[]` with `startDateTime`, `endDateTime`, `name` (e.g., "Citi Presale", "Fan Club Presale")
  - **Onsale dates:** `sales.public.startDateTime`, `sales.public.endDateTime`
- **Sample Call:**
  ```
  GET https://app.ticketmaster.com/discovery/v2/events.json?keyword=beyonce&apikey=YOUR_KEY
  ```
- **Limitations:** Primary market data only (face value pricing). No resale/secondary market pricing. No inventory counts.

### 4b. Discovery Feed 2.0
- **URL:** Bulk data feed endpoint
- **Provides:** Complete event catalog with status changes (onsale, offsale, rescheduled, cancelled)
- **Requires:** Higher-tier access

### 4c. Partner API
- **Requires:** Ticketmaster partnership agreement
- **Provides:** Transactional access, cart/checkout, deeper inventory data

---

## 5. Twitter/X API

### 5a. Free Tier — $0/month
- Post only: 1,500 tweets/month write
- ~1 request/15 min for reads
- **NO search functionality**
- Useless for monitoring

### 5b. Basic Tier — $100/month (legacy) / $200/month (current)
- 10,000-15,000 tweet reads/month
- 3,000 tweets/month write
- **7-day search history only**
- 60 search requests/15 min
- Basic search operators
- **No streaming**
- For BrokerBeacon: Could monitor "presale code" / "tickets on sale" mentions but 7-day limit and 10K read cap is very restrictive

### 5c. Pro Tier — $5,000/month
- 1M tweets/month read
- Full archive search
- Streaming access (50 connections)
- 300 search requests/15 min
- **Way too expensive for our use case**

### 5d. New Pay-As-You-Go Model (2026)
- X has introduced credit-based pricing: ~$0.01/tweet
- May be more cost-effective for low-volume targeted searches
- **Research further before committing**

### 5e. Alternatives to Official X API
- **TwitterAPI.io** — Third-party provider, claims 97% cheaper than official Pro. Pay-per-request model.
- **Netrows/xpoz.ai** — Aggregated X data providers with credit-based pricing
- **Nitter** — Open-source Twitter frontend; instances frequently shut down. Unreliable in 2026.
- **Apify Twitter scrapers** — Various actors on Apify marketplace for scraping X data

### 5f. Recommendation for BrokerBeacon
- Basic tier ($100-200/mo) for targeted keyword monitoring: "presale code", "[artist] tickets", "on sale"
- Supplement with a third-party provider if volume exceeds Basic limits

---

## 6. Bandsintown

### 6a. Bandsintown API v3
- **URL:** `https://rest.bandsintown.com/`
- **Docs:** https://help.artists.bandsintown.com/en/articles/9186477-api-documentation
- **Authentication:** `app_id` query parameter (we use `squarespace-blackbeard`)
- **Cost:** Free
- **Rate Limits:** Not officially published; community reports suggest generous limits (~100 req/min). Using a well-known app_id like `squarespace-*` has worked historically.
- **Endpoints:**
  - `GET /artists/{name}` — artist info (name, URL, image, facebook_page_url, tracker_count, upcoming_event_count)
  - `GET /artists/{name}/events` — artist events
    - `?date=upcoming` — future events (default)
    - `?date=past` — ✅ **past events available!**
    - `?date=all` — all events
    - `?date=2025-01-01,2025-12-31` — date range
- **Data Available:** Event title, datetime, venue (name, city, country, lat/lng), lineup, offers (ticket links), description, on_sale_datetime
- **Historical Data:** ✅ YES — use `?date=past` or date ranges for historical tour data
- **Sample Call:**
  ```
  GET https://rest.bandsintown.com/artists/Taylor%20Swift/events?app_id=squarespace-blackbeard&date=upcoming
  ```
- **Limitations:**
  - Artist-centric only (no geo/venue search)
  - Venue name field sometimes inaccurate
  - No pricing data (only links to ticket sellers)
  - Detailed page data excluded from API payloads

---

## 7. Songkick

### 7a. Songkick API
- **URL:** https://www.songkick.com/developer/
- **Status:** ⚠️ **PAID LICENSE REQUIRED** — Songkick now requires a partnership agreement and license fee
- **Not approving:** Student projects, educational, hobbyist use
- **Apply:** https://support.songkick.com/hc/en-us/requests/new?ticket_form_id=360000526113
- **Data (if approved):** 6M+ upcoming and past concerts, artist data, venue data
- **Cost:** License fee (amount not public — must inquire)
- **Recommendation:** Skip unless we need massive historical concert data. Bandsintown covers most of this for free.

---

## 8. Vivid Seats

### 8a. Skybox API (Broker/Seller API)
- **URL:** `https://skybox.vividseats.com/api-docs/` (Swagger UI)
- **Docs:** https://skybox.vividseats.com/api-docs/index.html
- **Authentication:** API key (requires Vivid Seats broker/seller account)
- **Purpose:** Primarily for sellers/brokers to manage listings
- **Endpoints:** Listings CRUD, sales management, inventory
- **Cost:** Free with broker account
- **Data:** Listing management, not consumer-facing event search

### 8b. Vivid Seats Consumer Data
- **No public consumer API** for searching events/pricing
- **Scraping approach:** ScrapingBee with JS rendering, similar to StubHub
- **schema.org JSON-LD:** Likely present on event pages — needs testing
- **Third-party:** TicketsData.com aggregates Vivid Seats data (see below)

---

## 9. TicketNetwork

### 9a. Mercury Web Services API
- **URL:** https://mercurywebservices.com/
- **Authentication:** Account + WebsiteConfigID required
- **Access:** Contact sales@ticketnetwork.com; integration team provides sandbox
- **Integration time:** ~2 weeks per their docs
- **SOAP endpoint:** `http://tnwebservices.ticketnetwork.com/tnwebservice/v3.2/tnwebservicestringinputs.asmx`
- **Data:** Events, venues, ticket listings from TicketNetwork exchange
- **Cost:** Commission-based; must apply as a reseller/affiliate
- **Format:** SOAP/XML (legacy)
- **Notes:** TicketNetwork powers many white-label ticket sites. Good inventory access if approved.

---

## 10. Ticket Evolution

### 10a. Ticket Evolution API
- **URL:** https://developer.ticketevolution.com/
- **Docs:** https://ticketevolution.atlassian.net/wiki/spaces/API/overview
- **Playground:** https://developer.ticketevolution.com/playground
- **Authentication:** API token (provided on account creation)
- **Affiliate docs:** https://ticketevolution.gitbooks.io/affiliate-api-documentation/content/
- **Access:** Contact 201-499-0833 ext. 2; 121 E 24th Street, New York, NY 10010
- **Endpoints:** Events, venues, categories, ticket groups (listings), orders
- **Data:** Event data, ticket inventory with pricing, seat locations
- **Cost:** Affiliate program (commission-based)
- **Notes:** Full ticketing platform API — can search events, browse inventory, create orders. Good for aggregation.

---

## 11. TicketsData.com (Third-Party Aggregator)

### 11a. TicketsData Unified API
- **URL:** https://ticketsdata.com/
- **Docs:** https://ticketsdata.com/docs
- **Authentication:** API key
- **Sources Covered:** Ticketmaster, StubHub, SeatGeek, Vivid Seats, Eventbrite, TickPick, Gametime
- **Endpoints:**
  - `/events` — search by performer_url across all marketplaces
  - Ticket listings with pricing, fees, deal scores, delivery types
  - Normalized JSON output
- **Pricing:**
  - **Starter:** $499/mo — 250 report sweeps, 10K API credits
  - **Pro:** $2,499/mo — 2,500 sweeps, 250K credits
  - **Business:** Custom pricing — 1M+ requests
  - **Enterprise:** Dedicated infrastructure, SLAs
- **Data Available:** Real-time inventory, pricing with fees, availability, seat maps, deal metrics
- **Value:** Single integration for all major marketplaces. Eliminates need to scrape each individually.
- **Recommendation:** Expensive but could replace multiple scraping pipelines. Consider Starter plan if we need cross-platform pricing comparisons.

---

## Summary & Recommendations

### Already Working ✅
| Source | Method | Data | Cost |
|--------|--------|------|------|
| StubHub | ScrapingBee + JSON-LD | Price ranges, event data | ~$49/mo |
| SeatGeek | Official API | Events, pricing stats | Free |
| Bandsintown | Official API | Tour dates, venues | Free |
| Ticketmaster | Discovery API | Events, onsale/presale dates | Free |

### High Priority to Add 🔴
| Source | Method | Data | Cost | Effort |
|--------|--------|------|------|--------|
| StubHub | Affiliate API | Full listings + pricing | Free (apply) | Medium — email affiliates@stubhub.com |
| TickPick | Affiliate API | No-fee pricing data | Free (apply) | Medium — apply via Impact |
| Vivid Seats | ScrapingBee JSON-LD | Resale pricing | ~$49/mo (shared) | Low — test JSON-LD extraction |
| Twitter/X | Basic tier | Presale codes, buzz | $100-200/mo | Low |

### Worth Investigating 🟡
| Source | Method | Notes |
|--------|--------|-------|
| Ticket Evolution | Affiliate API | Good inventory aggregation |
| TicketNetwork | Mercury API | Large exchange, SOAP-based |
| TicketsData.com | Unified API | $499+/mo but covers everything |

### Skip for Now ⚪
| Source | Reason |
|--------|--------|
| Songkick | Paid license, Bandsintown covers this |
| Twitter Pro/Enterprise | Too expensive ($5K+/mo) |
| Vivid Seats Skybox | Seller-focused, not consumer data |

---

*Research conducted 2026-03-27. Prices and availability subject to change.*
