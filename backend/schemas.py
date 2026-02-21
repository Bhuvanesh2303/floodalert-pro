"""
FloodLoop — Pydantic Schemas
Request bodies and response models for all API routes.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ─── Flood Risk ────────────────────────────────────────────────────────────

class FloodRisk(BaseModel):
    score: float
    level: str   # LOW | MEDIUM | HIGH
    color: str


# ─── Weather ───────────────────────────────────────────────────────────────

class WeatherResponse(BaseModel):
    city: str
    temperature: Optional[float]
    feels_like: Optional[float]
    humidity: Optional[float]
    pressure: Optional[float]
    wind_speed: Optional[float]
    wind_deg: Optional[float]
    clouds: Optional[float]
    rain_1h: float
    rain_3h: float
    description: str
    icon: str
    visibility: Optional[int]
    flood_risk: FloodRisk


# ─── Geocoding ─────────────────────────────────────────────────────────────

class GeoResponse(BaseModel):
    name: str
    country: str
    state: str
    lat: float
    lon: float


# ─── City ──────────────────────────────────────────────────────────────────

class CityCreate(BaseModel):
    name: str
    country: str
    state: str = ""
    lat: float
    lon: float
    is_favorite: bool = False


class CityResponse(BaseModel):
    id: int
    name: str
    country: str
    state: str
    lat: float
    lon: float
    is_favorite: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Weather Log ───────────────────────────────────────────────────────────

class WeatherLogResponse(BaseModel):
    id: int
    city_id: int
    recorded_at: datetime
    temperature: Optional[float]
    humidity: Optional[float]
    wind_speed: Optional[float]
    rain_1h: float
    rain_3h: float
    clouds: Optional[float]
    description: str
    flood_score: Optional[float]
    flood_level: Optional[str]

    class Config:
        from_attributes = True


# ─── Search History ────────────────────────────────────────────────────────

class SearchHistoryResponse(BaseModel):
    id: int
    query: str
    resolved_to: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    searched_at: datetime
    success: bool

    class Config:
        from_attributes = True


# ─── Alert ─────────────────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    city_id: int
    threshold: float = Field(..., ge=0, le=100)
    label: str = ""


class AlertResponse(BaseModel):
    id: int
    city_id: int
    threshold: float
    label: str
    is_active: bool
    created_at: datetime
    last_triggered: Optional[datetime]
    trigger_count: int

    class Config:
        from_attributes = True


# ─── Forecast ──────────────────────────────────────────────────────────────

class ForecastItem(BaseModel):
    dt: int
    datetime_str: str
    temperature: float
    feels_like: float
    humidity: float
    wind_speed: float
    rain_3h: float
    clouds: float
    description: str
    icon: str
    flood_risk: FloodRisk


class ForecastResponse(BaseModel):
    city: str
    country: str
    lat: float
    lon: float
    items: List[ForecastItem]


# ─── API Key ───────────────────────────────────────────────────────────────

class ApiKeyCreate(BaseModel):
    label: str = "default"


class ApiKeyResponse(BaseModel):
    id: int
    key: str
    label: str
    is_active: bool
    created_at: datetime
    call_count: int

    class Config:
        from_attributes = True


# ─── Generic ───────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str

class StatsResponse(BaseModel):
    total_searches: int
    total_cities_saved: int
    total_weather_logs: int
    total_alerts: int
    high_risk_events: int
