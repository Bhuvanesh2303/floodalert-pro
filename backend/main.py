"""
FloodLoop Dashboard — FastAPI Backend (Full Edition)
────────────────────────────────────────────────────
Routes:
  Core
    GET  /geocoding               — Geocode city → lat/lon
    GET  /weather                 — Current weather + flood risk
    GET  /weather-stream          — SSE live updates
    GET  /flood-risk              — Standalone risk calculator

  Cities
    GET  /cities                  — List saved cities
    POST /cities                  — Save a city
    DELETE /cities/{id}           — Remove a city
    PATCH /cities/{id}/favorite   — Toggle favourite

  History
    GET  /history                 — Recent search history
    GET  /history/weather/{city_id} — Weather log for a city

  Alerts
    GET  /alerts                  — List all alerts
    POST /alerts                  — Create alert
    DELETE /alerts/{id}           — Delete alert
    GET  /alerts/check/{city_id}  — Check if any alerts triggered

  Forecast
    GET  /forecast                — 5-day / 3-hour forecast + flood risk

  Admin
    POST /admin/api-keys          — Generate API key
    GET  /admin/stats             — Dashboard stats
    DELETE /admin/api-keys/{key}  — Revoke key
"""

import asyncio
import json
import os
import secrets
from datetime import datetime
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import (
    FastAPI, Query, HTTPException, Depends,
    Security, Request
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session

from database import init_db, get_db, City, WeatherLog, SearchHistory, Alert, ApiKey
from schemas import (
    GeoResponse, WeatherResponse, FloodRisk,
    CityCreate, CityResponse,
    WeatherLogResponse, SearchHistoryResponse,
    AlertCreate, AlertResponse,
    ForecastResponse, ForecastItem,
    ApiKeyCreate, ApiKeyResponse,
    MessageResponse, StatsResponse,
)

load_dotenv()

OWM_API_KEY  = os.getenv("OPENWEATHERMAP_API_KEY", "")
print("Loaded OWM_API_KEY:", OWM_API_KEY)
OWM_BASE     = "https://api.openweathermap.org"
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "changeme-admin-secret")

# ─── App Setup ─────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="FloodLoop API",
    description="Real-time flood risk and weather monitoring platform.",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "*"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    init_db()


# ─── Auth ──────────────────────────────────────────────────────────────────

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)

def require_api_key(
    api_key: Optional[str] = Security(API_KEY_HEADER),
    db: Session = Depends(get_db),
):
    if os.getenv("REQUIRE_API_KEY", "false").lower() != "true":
        return None
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header.")
    key_row = db.query(ApiKey).filter(ApiKey.key == api_key, ApiKey.is_active == True).first()
    if not key_row:
        raise HTTPException(status_code=403, detail="Invalid or revoked API key.")
    key_row.last_used = datetime.utcnow()
    key_row.call_count += 1
    db.commit()
    return key_row


def require_admin(admin_secret: str = Query(...)):
    if admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Invalid admin secret.")


# ─── Flood Risk Engine ─────────────────────────────────────────────────────

def calculate_flood_probability(
    rain_1h: float = 0,
    rain_3h: float = 0,
    humidity: float = 0,
    wind_speed: float = 0,
    clouds: float = 0,
) -> FloodRisk:
    score = 0.0
    score += min(rain_1h / 20, 1.0) * 40
    score += min(rain_3h / 40, 1.0) * 25
    score += min(max(humidity - 60, 0) / 40, 1.0) * 20
    score += min(wind_speed / 25, 1.0) * 10
    score += min(clouds / 100, 1.0) * 5
    score = round(min(score, 100), 1)

    if score >= 65:
        level, color = "HIGH", "#ef4444"
    elif score >= 35:
        level, color = "MEDIUM", "#f59e0b"
    else:
        level, color = "LOW", "#22c55e"

    return FloodRisk(score=score, level=level, color=color)


# ─── Helpers ───────────────────────────────────────────────────────────────

def _log_search(db: Session, query: str, geo=None, success=True):
    entry = SearchHistory(
        query=query,
        resolved_to=f"{geo['name']}, {geo['country']}" if geo else None,
        lat=geo["lat"] if geo else None,
        lon=geo["lon"] if geo else None,
        success=success,
    )
    db.add(entry)
    db.commit()


def _log_weather(db: Session, city_id: int, w: dict, flood: FloodRisk):
    log = WeatherLog(
        city_id=city_id,
        temperature=w.get("main", {}).get("temp"),
        feels_like=w.get("main", {}).get("feels_like"),
        humidity=w.get("main", {}).get("humidity"),
        pressure=w.get("main", {}).get("pressure"),
        wind_speed=w.get("wind", {}).get("speed"),
        wind_deg=w.get("wind", {}).get("deg"),
        clouds=w.get("clouds", {}).get("all"),
        rain_1h=w.get("rain", {}).get("1h", 0),
        rain_3h=w.get("rain", {}).get("3h", 0),
        description=w.get("weather", [{}])[0].get("description", ""),
        icon=w.get("weather", [{}])[0].get("icon", ""),
        flood_score=flood.score,
        flood_level=flood.level,
    )
    db.add(log)
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# CORE ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/", tags=["Core"])
async def root():
    return {"status": "FloodLoop API v2.0 running", "docs": "/docs"}


@app.get("/geocoding", response_model=GeoResponse, tags=["Core"])
@limiter.limit("30/minute")
async def geocode_city(
    request: Request,
    city: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    _auth=Depends(require_api_key),
):
    if not OWM_API_KEY:
        raise HTTPException(500, "OWM API key not configured.")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{OWM_BASE}/geo/1.0/direct",
            params={"q": city, "limit": 1, "appid": OWM_API_KEY},
        )

    if resp.status_code != 200:
        _log_search(db, city, success=False)
        raise HTTPException(resp.status_code, "Geocoding API error.")

    data = resp.json()
    if not data:
        _log_search(db, city, success=False)
        raise HTTPException(404, f"City '{city}' not found.")

    loc = data[0]
    geo = {"name": loc.get("name"), "country": loc.get("country"),
           "state": loc.get("state", ""), "lat": loc["lat"], "lon": loc["lon"]}
    _log_search(db, city, geo=geo, success=True)
    return GeoResponse(**geo)


@app.get("/weather", response_model=WeatherResponse, tags=["Core"])
@limiter.limit("30/minute")
async def get_weather(
    request: Request,
    lat: float,
    lon: float,
    save_log: bool = False,
    city_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _auth=Depends(require_api_key),
):
    if not OWM_API_KEY:
        raise HTTPException(500, "OWM API key not configured.")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{OWM_BASE}/data/2.5/weather",
            params={"lat": lat, "lon": lon, "appid": OWM_API_KEY, "units": "metric"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Weather API error.")

    d = resp.json()
    rain = d.get("rain", {})
    main = d.get("main", {})
    wind = d.get("wind", {})
    clouds = d.get("clouds", {})

    flood = calculate_flood_probability(
        rain_1h=rain.get("1h", 0),
        rain_3h=rain.get("3h", 0),
        humidity=main.get("humidity", 0),
        wind_speed=wind.get("speed", 0),
        clouds=clouds.get("all", 0),
    )

    if save_log and city_id:
        _log_weather(db, city_id, d, flood)
        alerts = db.query(Alert).filter(
            Alert.city_id == city_id, Alert.is_active == True,
            Alert.threshold <= flood.score,
        ).all()
        for alert in alerts:
            alert.last_triggered = datetime.utcnow()
            alert.trigger_count += 1
        db.commit()

    return WeatherResponse(
        city=d.get("name", ""),
        temperature=main.get("temp"),
        feels_like=main.get("feels_like"),
        humidity=main.get("humidity"),
        pressure=main.get("pressure"),
        wind_speed=wind.get("speed"),
        wind_deg=wind.get("deg", 0),
        clouds=clouds.get("all"),
        rain_1h=rain.get("1h", 0),
        rain_3h=rain.get("3h", 0),
        description=d.get("weather", [{}])[0].get("description", ""),
        icon=d.get("weather", [{}])[0].get("icon", ""),
        visibility=d.get("visibility"),
        flood_risk=flood,
    )


@app.get("/weather-stream", tags=["Core"])
async def weather_stream(
    lat: float,
    lon: float,
    interval: int = Query(default=60, ge=10, le=300),
    _auth=Depends(require_api_key),
):
    if not OWM_API_KEY:
        raise HTTPException(500, "OWM API key not configured.")

    async def event_generator():
        async with httpx.AsyncClient(timeout=15) as client:
            while True:
                try:
                    resp = await client.get(
                        f"{OWM_BASE}/data/2.5/weather",
                        params={"lat": lat, "lon": lon, "appid": OWM_API_KEY, "units": "metric"},
                    )
                    if resp.status_code == 200:
                        d = resp.json()
                        rain = d.get("rain", {})
                        main = d.get("main", {})
                        wind = d.get("wind", {})
                        clouds = d.get("clouds", {})
                        flood = calculate_flood_probability(
                            rain_1h=rain.get("1h", 0),
                            rain_3h=rain.get("3h", 0),
                            humidity=main.get("humidity", 0),
                            wind_speed=wind.get("speed", 0),
                            clouds=clouds.get("all", 0),
                        )
                        payload = {
                            "temperature": main.get("temp"),
                            "humidity": main.get("humidity"),
                            "wind_speed": wind.get("speed"),
                            "rain_1h": rain.get("1h", 0),
                            "rain_3h": rain.get("3h", 0),
                            "clouds": clouds.get("all"),
                            "description": d.get("weather", [{}])[0].get("description", ""),
                            "flood_risk": flood.model_dump(),
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                        yield f"data: {json.dumps(payload)}\n\n"
                    else:
                        yield f"data: {json.dumps({'error': 'API error'})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
                await asyncio.sleep(interval)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/flood-risk", response_model=FloodRisk, tags=["Core"])
async def flood_risk_calculator(
    rain_1h: float = 0, rain_3h: float = 0,
    humidity: float = 0, wind_speed: float = 0, clouds: float = 0,
):
    return calculate_flood_probability(rain_1h, rain_3h, humidity, wind_speed, clouds)


# ═══════════════════════════════════════════════════════════════════════════
# CITIES
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/cities", response_model=List[CityResponse], tags=["Cities"])
def list_cities(db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    return db.query(City).order_by(City.is_favorite.desc(), City.created_at.desc()).all()


@app.post("/cities", response_model=CityResponse, tags=["Cities"])
def save_city(body: CityCreate, db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    existing = db.query(City).filter(City.name == body.name, City.country == body.country).first()
    if existing:
        return existing
    city = City(**body.model_dump())
    db.add(city)
    db.commit()
    db.refresh(city)
    return city


@app.delete("/cities/{city_id}", response_model=MessageResponse, tags=["Cities"])
def delete_city(city_id: int, db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    city = db.query(City).filter(City.id == city_id).first()
    if not city:
        raise HTTPException(404, "City not found.")
    db.delete(city)
    db.commit()
    return {"message": f"City '{city.name}' deleted."}


@app.patch("/cities/{city_id}/favorite", response_model=CityResponse, tags=["Cities"])
def toggle_favorite(city_id: int, db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    city = db.query(City).filter(City.id == city_id).first()
    if not city:
        raise HTTPException(404, "City not found.")
    city.is_favorite = not city.is_favorite
    db.commit()
    db.refresh(city)
    return city


# ═══════════════════════════════════════════════════════════════════════════
# HISTORY
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/history", response_model=List[SearchHistoryResponse], tags=["History"])
def get_search_history(
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    _auth=Depends(require_api_key),
):
    return db.query(SearchHistory).order_by(SearchHistory.searched_at.desc()).limit(limit).all()


@app.get("/history/weather/{city_id}", response_model=List[WeatherLogResponse], tags=["History"])
def get_weather_history(
    city_id: int,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    _auth=Depends(require_api_key),
):
    city = db.query(City).filter(City.id == city_id).first()
    if not city:
        raise HTTPException(404, "City not found.")
    return db.query(WeatherLog).filter(WeatherLog.city_id == city_id).order_by(WeatherLog.recorded_at.desc()).limit(limit).all()


# ═══════════════════════════════════════════════════════════════════════════
# ALERTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/alerts", response_model=List[AlertResponse], tags=["Alerts"])
def list_alerts(db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    return db.query(Alert).order_by(Alert.created_at.desc()).all()


@app.post("/alerts", response_model=AlertResponse, tags=["Alerts"])
def create_alert(body: AlertCreate, db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    city = db.query(City).filter(City.id == body.city_id).first()
    if not city:
        raise HTTPException(404, f"City ID {body.city_id} not found. Save the city first.")
    alert = Alert(**body.model_dump())
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


@app.delete("/alerts/{alert_id}", response_model=MessageResponse, tags=["Alerts"])
def delete_alert(alert_id: int, db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(404, "Alert not found.")
    db.delete(alert)
    db.commit()
    return {"message": f"Alert #{alert_id} deleted."}


@app.get("/alerts/check/{city_id}", tags=["Alerts"])
async def check_alerts(city_id: int, db: Session = Depends(get_db), _auth=Depends(require_api_key)):
    city = db.query(City).filter(City.id == city_id).first()
    if not city:
        raise HTTPException(404, "City not found.")
    if not OWM_API_KEY:
        raise HTTPException(500, "OWM API key not configured.")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{OWM_BASE}/data/2.5/weather",
            params={"lat": city.lat, "lon": city.lon, "appid": OWM_API_KEY, "units": "metric"},
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Weather API error.")

    d = resp.json()
    flood = calculate_flood_probability(
        rain_1h=d.get("rain", {}).get("1h", 0),
        rain_3h=d.get("rain", {}).get("3h", 0),
        humidity=d.get("main", {}).get("humidity", 0),
        wind_speed=d.get("wind", {}).get("speed", 0),
        clouds=d.get("clouds", {}).get("all", 0),
    )

    alerts = db.query(Alert).filter(Alert.city_id == city_id, Alert.is_active == True).all()
    triggered = []
    for alert in alerts:
        if flood.score >= alert.threshold:
            alert.last_triggered = datetime.utcnow()
            alert.trigger_count += 1
            triggered.append({"alert_id": alert.id, "label": alert.label,
                               "threshold": alert.threshold, "current_score": flood.score,
                               "flood_level": flood.level})
    db.commit()

    return {"city": city.name, "current_flood_score": flood.score,
            "flood_level": flood.level, "alerts_triggered": triggered,
            "total_active_alerts": len(alerts)}


# ═══════════════════════════════════════════════════════════════════════════
# FORECAST
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/forecast", response_model=ForecastResponse, tags=["Forecast"])
@limiter.limit("20/minute")
async def get_forecast(
    request: Request,
    lat: float,
    lon: float,
    _auth=Depends(require_api_key),
):
    if not OWM_API_KEY:
        raise HTTPException(500, "OWM API key not configured.")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{OWM_BASE}/data/2.5/forecast",
            params={"lat": lat, "lon": lon, "appid": OWM_API_KEY, "units": "metric"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Forecast API error.")

    data = resp.json()
    city_info = data.get("city", {})
    items = []

    for slot in data.get("list", []):
        main = slot.get("main", {})
        wind = slot.get("wind", {})
        clouds = slot.get("clouds", {})
        rain = slot.get("rain", {})
        rain_3h = rain.get("3h", 0)

        flood = calculate_flood_probability(
            rain_1h=0, rain_3h=rain_3h,
            humidity=main.get("humidity", 0),
            wind_speed=wind.get("speed", 0),
            clouds=clouds.get("all", 0),
        )

        items.append(ForecastItem(
            dt=slot["dt"],
            datetime_str=slot.get("dt_txt", ""),
            temperature=main.get("temp", 0),
            feels_like=main.get("feels_like", 0),
            humidity=main.get("humidity", 0),
            wind_speed=wind.get("speed", 0),
            rain_3h=rain_3h,
            clouds=clouds.get("all", 0),
            description=slot.get("weather", [{}])[0].get("description", ""),
            icon=slot.get("weather", [{}])[0].get("icon", ""),
            flood_risk=flood,
        ))

    return ForecastResponse(
        city=city_info.get("name", ""),
        country=city_info.get("country", ""),
        lat=city_info.get("coord", {}).get("lat", lat),
        lon=city_info.get("coord", {}).get("lon", lon),
        items=items,
    )


# ═══════════════════════════════════════════════════════════════════════════
# ADMIN
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/admin/api-keys", response_model=ApiKeyResponse, tags=["Admin"])
def create_api_key(body: ApiKeyCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    key = ApiKey(key=secrets.token_hex(32), label=body.label)
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


@app.delete("/admin/api-keys/{key}", response_model=MessageResponse, tags=["Admin"])
def revoke_api_key(key: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    row = db.query(ApiKey).filter(ApiKey.key == key).first()
    if not row:
        raise HTTPException(404, "API key not found.")
    row.is_active = False
    db.commit()
    return {"message": "API key revoked."}


@app.get("/admin/stats", response_model=StatsResponse, tags=["Admin"])
def get_stats(db: Session = Depends(get_db), _=Depends(require_admin)):
    return StatsResponse(
        total_searches=db.query(SearchHistory).count(),
        total_cities_saved=db.query(City).count(),
        total_weather_logs=db.query(WeatherLog).count(),
        total_alerts=db.query(Alert).count(),
        high_risk_events=db.query(WeatherLog).filter(WeatherLog.flood_level == "HIGH").count(),
    )


# ═══════════════════════════════════════════════════════════════════════════
# FLOOD HISTORY (Historical flood events database)
# ═══════════════════════════════════════════════════════════════════════════

HISTORICAL_FLOODS = {
    "mumbai": [
        {"year": 2005, "event": "Mumbai Floods", "deaths": 1094, "severity": "HIGH", "rainfall_mm": 944, "description": "July 26, 2005 – 944mm of rain in 24 hours, deadliest urban flood in Indian history.", "source": "IMD"},
        {"year": 2017, "event": "Mumbai Monsoon Floods", "deaths": 33, "severity": "MEDIUM", "rainfall_mm": 298, "description": "August 2017 flooding caused widespread transport disruption and building collapses.", "source": "NDMA"},
        {"year": 2021, "event": "Mumbai Monsoon Floods", "deaths": 22, "severity": "MEDIUM", "rainfall_mm": 320, "description": "July 2021 heavy rains led to landslides and building collapses in suburbs.", "source": "NDMA"},
    ],
    "new orleans": [
        {"year": 2005, "event": "Hurricane Katrina", "deaths": 1833, "severity": "HIGH", "rainfall_mm": 250, "description": "August 29, 2005 – Levee failures flooded 80% of the city, catastrophic $125B damage.", "source": "FEMA"},
        {"year": 2016, "event": "Louisiana Floods", "deaths": 13, "severity": "MEDIUM", "rainfall_mm": 686, "description": "August 2016 – Historic flooding affected 145,000 homes in southeast Louisiana.", "source": "FEMA"},
    ],
    "houston": [
        {"year": 2017, "event": "Hurricane Harvey", "deaths": 107, "severity": "HIGH", "rainfall_mm": 1539, "description": "August 2017 – Harvey dropped record 1,539mm of rain, flooding 154,000 structures.", "source": "NOAA"},
        {"year": 2015, "event": "Memorial Day Floods", "deaths": 35, "severity": "HIGH", "rainfall_mm": 310, "description": "May 2015 – Rapid flooding overwhelmed drainage systems, 35 fatalities.", "source": "NWS"},
    ],
    "chennai": [
        {"year": 2015, "event": "Chennai Floods", "deaths": 500, "severity": "HIGH", "rainfall_mm": 1218, "description": "November-December 2015 – Worst floods in 100 years, 500 deaths, $3B damage.", "source": "IMD"},
        {"year": 2023, "event": "Chennai Monsoon Floods", "deaths": 14, "severity": "MEDIUM", "rainfall_mm": 270, "description": "October 2023 – Northeast monsoon flooding inundated several districts.", "source": "NDMA"},
    ],
    "kolkata": [
        {"year": 2021, "event": "Cyclone Yaas", "deaths": 19, "severity": "HIGH", "rainfall_mm": 320, "description": "May 2021 – Cyclone Yaas caused extensive coastal flooding in West Bengal.", "source": "NDMA"},
        {"year": 2017, "event": "Kolkata Urban Floods", "deaths": 12, "severity": "MEDIUM", "rainfall_mm": 210, "description": "August 2017 – Heavy rains caused waterlogging across major areas of the city.", "source": "KMC"},
    ],
    "delhi": [
        {"year": 2023, "event": "Delhi Yamuna Floods", "deaths": 27, "severity": "HIGH", "rainfall_mm": 153, "description": "July 2023 – Yamuna river reached record levels, flooding low-lying areas.", "source": "CWC"},
        {"year": 2021, "event": "Delhi Monsoon Flooding", "deaths": 10, "severity": "MEDIUM", "rainfall_mm": 111, "description": "September 2021 – Unprecedented rainfall in single day caused massive waterlogging.", "source": "IMD"},
    ],
    "bangalore": [
        {"year": 2022, "event": "Bangalore Floods", "deaths": 16, "severity": "HIGH", "rainfall_mm": 131, "description": "September 2022 – Tech parks and residential areas including Bellandur submerged.", "source": "IMD"},
        {"year": 2017, "event": "Bangalore Urban Floods", "deaths": 10, "severity": "MEDIUM", "rainfall_mm": 98, "description": "August 2017 – Heavy rains caused massive waterlogging across IT corridors.", "source": "BBMP"},
    ],
    "hyderabad": [
        {"year": 2020, "event": "Hyderabad Floods", "deaths": 77, "severity": "HIGH", "rainfall_mm": 324, "description": "October 2020 – Worst flooding in 30 years, 77 deaths, severe damage to Old City.", "source": "NDMA"},
        {"year": 2016, "event": "Hyderabad Flash Floods", "deaths": 23, "severity": "MEDIUM", "rainfall_mm": 187, "description": "August 2016 – Flash floods submerged hundreds of colonies across city.", "source": "GHMC"},
    ],
    "tirupati": [
        {"year": 2020, "event": "Cyclone Nivar Flooding", "deaths": 7, "severity": "HIGH", "rainfall_mm": 310, "description": "November 2020 – Cyclone Nivar brought severe rainfall and flooding to Tirupati and Chittoor district.", "source": "NDMA"},
        {"year": 2022, "event": "Tirupati Monsoon Floods", "deaths": 5, "severity": "MEDIUM", "rainfall_mm": 195, "description": "October 2022 – Heavy northeast monsoon rains caused flooding in low-lying areas.", "source": "APSDMA"},
    ],
    "jakarta": [
        {"year": 2020, "event": "Jakarta New Year Floods", "deaths": 66, "severity": "HIGH", "rainfall_mm": 377, "description": "January 1, 2020 – Record rainfall flooded 169 locations across greater Jakarta.", "source": "BNPB"},
        {"year": 2007, "event": "Jakarta Mega-Floods", "deaths": 57, "severity": "HIGH", "rainfall_mm": 340, "description": "February 2007 – Two-thirds of Jakarta submerged, 57 deaths, 400,000 evacuated.", "source": "OCHA"},
    ],
    "london": [
        {"year": 2021, "event": "London Flash Floods", "deaths": 4, "severity": "MEDIUM", "rainfall_mm": 94, "description": "July 2021 – Underground stations flooded, streets impassable across west London.", "source": "EA"},
        {"year": 2007, "event": "UK Summer Floods", "deaths": 13, "severity": "HIGH", "rainfall_mm": 118, "description": "June-July 2007 – England's worst peacetime emergency, 55,000 homes flooded.", "source": "EA"},
    ],
    "bangkok": [
        {"year": 2011, "event": "Thailand Megaflood", "deaths": 813, "severity": "HIGH", "rainfall_mm": 850, "description": "Jul-Dec 2011 – Worst flooding in 50 years, 40% of Thailand affected, $45B damage.", "source": "OCHA"},
    ],
    "new york": [
        {"year": 2012, "event": "Hurricane Sandy", "deaths": 43, "severity": "HIGH", "rainfall_mm": 111, "description": "October 2012 – 14-foot storm surge flooded NYC subways and lower Manhattan.", "source": "FEMA"},
        {"year": 2021, "event": "Hurricane Ida Remnants", "deaths": 13, "severity": "HIGH", "rainfall_mm": 183, "description": "September 2021 – Record 3.15 inches/hour rainfall flooded subway and basements.", "source": "NWS"},
    ],
    "miami": [
        {"year": 2017, "event": "Hurricane Irma", "deaths": 4, "severity": "HIGH", "rainfall_mm": 320, "description": "September 2017 – Storm surge and heavy rain flooded Miami Beach and downtown.", "source": "NOAA"},
    ],
    "venice": [
        {"year": 2019, "event": "Venice Acqua Alta", "deaths": 2, "severity": "HIGH", "rainfall_mm": 148, "description": "November 2019 – 187cm water level, second highest ever, 85% of city flooded.", "source": "CNR"},
    ],
    "default": [
        {"year": 2022, "event": "Regional Flash Flood Events", "deaths": None, "severity": "MEDIUM", "rainfall_mm": None, "description": "Flash flood events have increasingly impacted urban areas globally due to climate change. Check local disaster management reports for specific city data.", "source": "UNDRR"},
        {"year": 2021, "event": "Global Urban Flood Trend", "deaths": None, "severity": "LOW", "rainfall_mm": None, "description": "2021 saw a 134% increase in reported urban flood events compared to the 2000-2009 decade average.", "source": "UNDRR"},
    ],
}


def get_flood_history(city_name: str) -> list:
    city_lower = city_name.lower().strip()
    if city_lower in HISTORICAL_FLOODS:
        return HISTORICAL_FLOODS[city_lower]
    for key in HISTORICAL_FLOODS:
        if key != "default" and (key in city_lower or city_lower in key):
            return HISTORICAL_FLOODS[key]
    return HISTORICAL_FLOODS["default"]


@app.get("/flood-history", tags=["Flood History"])
async def flood_history(
    city: str = Query(..., min_length=1),
    _auth=Depends(require_api_key),
):
    """Returns known historical flood events for a given city."""
    events = get_flood_history(city)
    return {"city": city, "events": events, "count": len(events)}
