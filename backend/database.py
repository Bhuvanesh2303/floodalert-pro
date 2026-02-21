"""
FloodLoop — Database Layer
SQLAlchemy + SQLite (zero-config, file-based)
Upgrade to PostgreSQL by changing DATABASE_URL in .env
"""

import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, Float, String,
    DateTime, Boolean, Text, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./floodloop.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ─── Models ────────────────────────────────────────────────────────────────

class City(Base):
    """Saved/favourite cities."""
    __tablename__ = "cities"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False)
    country     = Column(String(10), nullable=False)
    state       = Column(String(100), default="")
    lat         = Column(Float, nullable=False)
    lon         = Column(Float, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    is_favorite = Column(Boolean, default=False)

    weather_logs = relationship("WeatherLog", back_populates="city", cascade="all, delete")
    alerts       = relationship("Alert", back_populates="city", cascade="all, delete")


class WeatherLog(Base):
    """Historical weather + flood risk snapshots."""
    __tablename__ = "weather_logs"

    id          = Column(Integer, primary_key=True, index=True)
    city_id     = Column(Integer, ForeignKey("cities.id"), nullable=False)
    recorded_at = Column(DateTime, default=datetime.utcnow, index=True)

    temperature = Column(Float)
    feels_like  = Column(Float)
    humidity    = Column(Float)
    pressure    = Column(Float)
    wind_speed  = Column(Float)
    wind_deg    = Column(Float)
    clouds      = Column(Float)
    rain_1h     = Column(Float, default=0)
    rain_3h     = Column(Float, default=0)
    description = Column(String(200))
    icon        = Column(String(20))

    flood_score = Column(Float)
    flood_level = Column(String(10))   # LOW | MEDIUM | HIGH

    city = relationship("City", back_populates="weather_logs")


class SearchHistory(Base):
    """Every city search performed."""
    __tablename__ = "search_history"

    id          = Column(Integer, primary_key=True, index=True)
    query       = Column(String(200), nullable=False)
    resolved_to = Column(String(200))   # "Mumbai, IN"
    lat         = Column(Float)
    lon         = Column(Float)
    searched_at = Column(DateTime, default=datetime.utcnow, index=True)
    success     = Column(Boolean, default=True)


class Alert(Base):
    """User-defined flood risk threshold alerts."""
    __tablename__ = "alerts"

    id              = Column(Integer, primary_key=True, index=True)
    city_id         = Column(Integer, ForeignKey("cities.id"), nullable=False)
    threshold       = Column(Float, nullable=False)   # 0–100 score
    label           = Column(String(200), default="")
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    last_triggered  = Column(DateTime, nullable=True)
    trigger_count   = Column(Integer, default=0)

    city = relationship("City", back_populates="alerts")


class ApiKey(Base):
    """Simple API key authentication."""
    __tablename__ = "api_keys"

    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(String(64), unique=True, nullable=False, index=True)
    label      = Column(String(200), default="")
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used  = Column(DateTime, nullable=True)
    call_count = Column(Integer, default=0)


# ─── Init ──────────────────────────────────────────────────────────────────

def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
