# 🌊 FloodLoop Dashboard v2.0

Real-time flood risk and weather monitoring platform — with database, full API, auth, rate limiting, and more.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, React, TypeScript, Tailwind CSS |
| Mapping | React Leaflet + OpenWeatherMap tiles |
| Backend | FastAPI (Python), async httpx |
| Database | SQLite (default) / PostgreSQL (production) |
| ORM | SQLAlchemy |
| Real-Time | Server-Sent Events (SSE) |
| Auth | API Key (X-API-Key header) |
| Rate Limiting | slowapi (30 req/min per IP) |
| Data | OpenWeatherMap API (current + forecast) |

---

## Quick Start

### 1. Configure environment
```bash
cp .env.example .env
# Fill in OPENWEATHERMAP_API_KEY
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Docs: http://localhost:8000/docs

### 3. Frontend
```bash
cd frontend && npm install && npm run dev
```
App: http://localhost:3000

---

## Full API Reference

### Core
| GET | `/geocoding?city=` | Geocode city |
| GET | `/weather?lat=&lon=` | Weather + flood risk |
| GET | `/weather-stream?lat=&lon=` | SSE live stream |
| GET | `/flood-risk` | Risk calculator |

### Cities
| GET/POST | `/cities` | List / Save cities |
| DELETE | `/cities/{id}` | Remove city |
| PATCH | `/cities/{id}/favorite` | Toggle ⭐ |

### History
| GET | `/history` | Search history |
| GET | `/history/weather/{city_id}` | Weather logs |

### Alerts
| GET/POST | `/alerts` | List / Create alerts |
| DELETE | `/alerts/{id}` | Delete alert |
| GET | `/alerts/check/{city_id}` | Check triggers |

### Forecast
| GET | `/forecast?lat=&lon=` | 5-day forecast + flood risk |

### Admin
| POST | `/admin/api-keys?admin_secret=` | Generate key |
| DELETE | `/admin/api-keys/{key}?admin_secret=` | Revoke key |
| GET | `/admin/stats?admin_secret=` | Usage stats |

---

## Database Schema
- `cities` — saved/favourite cities
- `weather_logs` — historical weather + flood risk snapshots
- `search_history` — every geocoding search
- `alerts` — flood risk threshold alerts
- `api_keys` — API authentication keys

Default: SQLite (zero config). Switch to PostgreSQL via DATABASE_URL in .env.

---

## Flood Risk Algorithm
```
score = rain_1h × 40 + rain_3h × 25 + humidity × 20 + wind × 10 + clouds × 5
LOW=0-34% | MEDIUM=35-64% | HIGH=65-100%
```

---

## Deployment
| Frontend → Vercel | Backend → Railway/Render | DB → Supabase/Railway PostgreSQL |
