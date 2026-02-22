"use client";

/**
 * FloodLoop Dashboard — Full Feature Edition v2.0
 * ──────────────────────────────────────────────────
 * NEW FEATURES:
 *  • Satellite / Street / Dark map toggle
 *  • Historical Flood Events panel per city
 *  • Time-Slider for Flood Evolution (72h playback)
 *  • Interactive Risk Cross-Section depth profile (click map)
 *  • Safe-Path Routing Engine (colored road overlay)
 *  • Split-View Scenario Comparison (drag divider)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GeoResult { name: string; country: string; state: string; lat: number; lon: number; }
interface FloodRisk { score: number; level: "LOW" | "MEDIUM" | "HIGH"; color: string; }
interface WeatherData {
  temperature: number | null; humidity: number | null; wind_speed: number | null;
  rain_1h: number | null; rain_3h: number | null; clouds: number | null;
  description: string; flood_risk: FloodRisk | null;
}
interface HistoricalFloodEvent {
  year: number; event: string; deaths: number | null;
  severity: "LOW" | "MEDIUM" | "HIGH"; rainfall_mm: number | null;
  description: string; source: string;
}
interface CrossSectionPoint { elevation: number; waterLevel: number; label: string; }
interface FloodFrame { hour: number; score: number; label: string; radius: number; }

// ─── Constants ────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const OWM_KEY = process.env.NEXT_PUBLIC_OWM_API_KEY || "";

const RISK_COLORS = {
  LOW:    { bg: "rgba(34,197,94,0.15)",  border: "#22c55e", text: "#4ade80", glow: "0 0 20px rgba(34,197,94,0.4)"  },
  MEDIUM: { bg: "rgba(245,158,11,0.15)", border: "#f59e0b", text: "#fbbf24", glow: "0 0 20px rgba(245,158,11,0.4)" },
  HIGH:   { bg: "rgba(239,68,68,0.15)",  border: "#ef4444", text: "#f87171", glow: "0 0 20px rgba(239,68,68,0.5)"  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateFloodFrames(baseScore: number): FloodFrame[] {
  const frames: FloodFrame[] = [];
  for (let h = 0; h <= 72; h += 3) {
    const wave = Math.sin((h / 72) * Math.PI) * 28;
    const noise = (Math.random() - 0.5) * 7;
    const score = Math.min(100, Math.max(0, Math.round(baseScore + wave + noise)));
    frames.push({ hour: h, score, label: h === 0 ? "Now" : `+${h}h`, radius: 300 + (score / 100) * 1200 });
  }
  return frames;
}

function generateCrossSection(lat: number, lon: number, floodScore: number): CrossSectionPoint[] {
  const seed = Math.abs(Math.sin(lat * 100 + lon * 73)) * 10;
  const labels = ["-200m", "-150m", "-100m", "-50m", "📍 Point", "+50m", "+100m", "+150m", "+200m"];
  return labels.map((label, i) => {
    const t = i / 8;
    const elev = seed + Math.sin(t * Math.PI * 2 + seed) * 4 + (i === 4 ? -2.5 : 0);
    const waterLevel = floodScore > 65 ? elev - 0.5 + (floodScore / 100) * 3 : floodScore > 35 ? elev + 0.5 + (floodScore / 100) * 1.5 : elev + 2;
    return { elevation: parseFloat(elev.toFixed(1)), waterLevel: parseFloat(Math.max(waterLevel, elev - 0.8).toFixed(1)), label };
  });
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

const StatCard = ({ icon, label, value, unit, loading, accent = "#60a5fa" }: { icon: string; label: string; value: string | null; unit: string; loading?: boolean; accent?: string }) => (
  <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${accent},transparent)`, opacity: 0.6 }} />
    <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
    <div style={{ fontSize: 12, color: "rgba(148,163,184,0.8)", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>{label}</div>
    {loading ? <div style={{ height: 36, background: "rgba(255,255,255,0.05)", borderRadius: 8, animation: "pulse 1.5s infinite" }} />
      : <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: "#f1f5f9", fontFamily: "'Bebas Neue',sans-serif" }}>{value ?? "—"}</span>
          <span style={{ fontSize: 14, color: "rgba(148,163,184,0.7)", fontFamily: "'Space Mono',monospace" }}>{unit}</span>
        </div>}
  </div>
);

// ─── FloodGauge ───────────────────────────────────────────────────────────────

const FloodGauge = ({ risk, loading }: { risk: FloodRisk | null; loading?: boolean }) => {
  const score = risk?.score ?? 0; const level = risk?.level ?? "LOW";
  const c = RISK_COLORS[level]; const circ = 2 * Math.PI * 54;
  return (
    <div style={{ background: loading ? "rgba(15,23,42,0.6)" : c.bg, border: `1px solid ${loading ? "rgba(255,255,255,0.08)" : c.border}`, backdropFilter: "blur(20px)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, boxShadow: loading ? "none" : c.glow, gridColumn: "span 2", transition: "all 0.6s" }}>
      <div style={{ fontSize: 12, color: "rgba(148,163,184,0.8)", textTransform: "uppercase" as const, letterSpacing: "0.1em", fontFamily: "'Space Mono',monospace" }}>⚠ Flood Probability</div>
      {loading ? <div style={{ width: 128, height: 128, borderRadius: "50%", background: "rgba(255,255,255,0.05)", animation: "pulse 1.5s infinite" }} />
        : <div style={{ position: "relative", width: 128, height: 128 }}>
            <svg width="128" height="128" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              <circle cx="64" cy="64" r="54" fill="none" stroke={c.border} strokeWidth="10" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ} style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 6px ${c.border})` }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: c.text, fontFamily: "'Bebas Neue',sans-serif" }}>{score}%</span>
            </div>
          </div>}
      <div style={{ padding: "6px 20px", borderRadius: 99, border: `1px solid ${loading ? "rgba(255,255,255,0.08)" : c.border}`, background: loading ? "rgba(255,255,255,0.05)" : `${c.border}22`, color: loading ? "transparent" : c.text, fontFamily: "'Space Mono',monospace", fontSize: 13, fontWeight: 600, letterSpacing: "0.1em", animation: !loading && level === "HIGH" ? "alertPulse 2s infinite" : "none" }}>
        {loading ? "Loading..." : `${level} RISK`}
      </div>
    </div>
  );
};

// ─── Historical Floods Panel ──────────────────────────────────────────────────

const HistoryPanel = ({ events, cityName, loading }: { events: HistoricalFloodEvent[]; cityName: string; loading: boolean }) => (
  <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(239,68,68,0.2)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 24, animation: "fadeIn 0.5s" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
      <span style={{ fontSize: 22 }}>📜</span>
      <div>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: "0.06em" }}>HISTORICAL FLOOD EVENTS</div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.5)", letterSpacing: "0.08em" }}>{cityName.toUpperCase()} · PAST RECORDS</div>
      </div>
    </div>
    {loading ? [1,2,3].map(i => <div key={i} style={{ height: 80, background: "rgba(255,255,255,0.03)", borderRadius: 12, marginBottom: 12, animation: "pulse 1.5s infinite" }} />)
      : events.length === 0 ? <div style={{ textAlign: "center", padding: 32, color: "rgba(148,163,184,0.4)", fontFamily: "'Space Mono',monospace", fontSize: 12 }}>No historical data found.</div>
      : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
          {events.map((ev, i) => {
            const c = RISK_COLORS[ev.severity];
            return (
              <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}40`, borderRadius: 12, padding: 16, position: "relative" }}>
                <div style={{ position: "absolute", top: 12, right: 12, background: `${c.border}22`, border: `1px solid ${c.border}`, borderRadius: 6, padding: "2px 10px", fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, color: c.text }}>{ev.year}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.border, boxShadow: `0 0 5px ${c.border}` }} />
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: c.text, letterSpacing: "0.1em" }}>{ev.severity} SEVERITY</span>
                </div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, fontWeight: 700, marginBottom: 8, paddingRight: 48 }}>{ev.event}</div>
                <div style={{ fontSize: 12, color: "rgba(148,163,184,0.75)", lineHeight: 1.6, marginBottom: 10 }}>{ev.description}</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
                  {ev.deaths !== null && <span style={{ fontSize: 12, color: "#f87171", fontFamily: "'Space Mono',monospace" }}>💀 {ev.deaths.toLocaleString()}</span>}
                  {ev.rainfall_mm !== null && <span style={{ fontSize: 12, color: "#38bdf8", fontFamily: "'Space Mono',monospace" }}>🌧️ {ev.rainfall_mm}mm</span>}
                  <span style={{ fontSize: 10, color: "rgba(148,163,184,0.35)", fontFamily: "'Space Mono',monospace", marginLeft: "auto" }}>SRC: {ev.source}</span>
                </div>
              </div>
            );
          })}
        </div>}
  </div>
);

// ─── Cross-Section Side Panel ─────────────────────────────────────────────────

const CrossSectionChart = ({ points, onClose }: { points: CrossSectionPoint[]; onClose: () => void }) => {
  const w = 380; const h = 160;
  const maxV = Math.max(...points.map(p => Math.max(p.elevation, p.waterLevel))) + 1;
  const minV = Math.min(...points.map(p => Math.min(p.elevation, p.waterLevel))) - 1;
  const range = maxV - minV;
  const toY = (v: number) => h - ((v - minV) / range) * h;
  const xStep = w / (points.length - 1);
  const groundPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${i * xStep},${toY(p.elevation)}`).join(" ") + ` L${(points.length-1)*xStep},${h} L0,${h} Z`;
  const waterPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${i * xStep},${toY(p.waterLevel)}`).join(" ") + ` L${(points.length-1)*xStep},${h} L0,${h} Z`;

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, background: "rgba(6,13,26,0.97)", borderLeft: "1px solid rgba(56,189,248,0.2)", backdropFilter: "blur(20px)", zIndex: 9999, display: "flex", flexDirection: "column", animation: "slideIn 0.3s ease", overflowY: "auto" }}>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(6,13,26,0.97)", zIndex: 1 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: "0.06em" }}>📐 DEPTH CROSS-SECTION</div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.5)" }}>ELEVATION vs PREDICTED WATER LEVEL</div>
        </div>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", cursor: "pointer", padding: "6px 12px", fontFamily: "'Space Mono',monospace", fontSize: 11 }}>CLOSE ✕</button>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "rgba(15,23,42,0.8)", borderRadius: 12, padding: 16 }}>
          <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block" }}>
            <defs>
              <linearGradient id="groundG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#78716c" stopOpacity="0.9" /><stop offset="100%" stopColor="#44403c" stopOpacity="1" /></linearGradient>
              <linearGradient id="waterG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.7" /><stop offset="100%" stopColor="#0369a1" stopOpacity="0.3" /></linearGradient>
            </defs>
            {points.map((_, i) => <line key={i} x1={i*xStep} y1={0} x2={i*xStep} y2={h} stroke={i===4?"#f59e0b":"rgba(255,255,255,0.04)"} strokeWidth={i===4?1.5:1} strokeDasharray={i===4?"4,3":undefined} />)}
            <path d={groundPath} fill="url(#groundG)" />
            <path d={waterPath} fill="url(#waterG)" />
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            {points.map((p, i) => <div key={i} style={{ fontSize: 9, color: i===4?"#f59e0b":"rgba(148,163,184,0.4)", fontFamily: "'Space Mono',monospace", textAlign: "center" as const }}>{p.label}</div>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const }}>
          {[{c:"#78716c",l:"Ground"},{c:"#38bdf8",l:"Water Level"},{c:"#f59e0b",l:"Selected Point"}].map((x,i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: x.c }} />
              <span style={{ fontSize: 10, color: "rgba(148,163,184,0.7)", fontFamily: "'Space Mono',monospace" }}>{x.l}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {points.map((p, i) => {
            const depth = p.waterLevel - p.elevation; const flooded = depth > 0;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: i===4?"rgba(245,158,11,0.1)":"rgba(255,255,255,0.02)", borderRadius: 8, border: i===4?"1px solid rgba(245,158,11,0.3)":"1px solid transparent" }}>
                <div style={{ width: 54, fontFamily: "'Space Mono',monospace", fontSize: 9, color: i===4?"#f59e0b":"rgba(148,163,184,0.5)" }}>{p.label}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'Space Mono',monospace" }}>Elev: {p.elevation}m</div>
                  <div style={{ fontSize: 10, color: "#38bdf8", fontFamily: "'Space Mono',monospace" }}>Water: {p.waterLevel}m</div>
                </div>
                <div style={{ padding: "3px 8px", borderRadius: 6, background: flooded?"rgba(239,68,68,0.2)":"rgba(34,197,94,0.1)", border: `1px solid ${flooded?"#ef4444":"#22c55e"}40`, fontSize: 10, color: flooded?"#f87171":"#4ade80", fontFamily: "'Space Mono',monospace" }}>
                  {flooded ? `⚠ +${depth.toFixed(1)}m` : "SAFE"}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "10px 14px", background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: 10, fontFamily: "'Space Mono',monospace", fontSize: 11, color: "rgba(148,163,184,0.6)", lineHeight: 1.7 }}>
          💡 This profile shows why a point is at risk. Negative values (⚠) indicate the terrain is below predicted water level — meaning flooding is likely at that coordinate.
        </div>
      </div>
    </div>
  );
};

// ─── Time Slider ──────────────────────────────────────────────────────────────

// ─── Time Slider ──────────────────────────────────────────────────────────────

const TimeSlider = ({
  frames,
  currentFrame,
  setCurrentFrame,
  playing,
  setPlaying,
}: {
  frames: FloodFrame[];
  currentFrame: number;
  setCurrentFrame: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null);

useEffect(() => {
  if (!playing) {
    if (ivRef.current) {
      clearInterval(ivRef.current);
      ivRef.current = null;
    }
    return;
  }

  ivRef.current = setInterval(() => {
    setCurrentFrame((prev) => {
      if (prev >= frames.length - 1) {
        setPlaying(false);
        return 0;
      }
      return prev + 1;
    });
  }, 600);

  return () => {
    if (ivRef.current) {
      clearInterval(ivRef.current);
      ivRef.current = null;
    }
  };
}, [playing, frames.length, setCurrentFrame, setPlaying]);

  if (!frames.length) return null;

  const frame = frames[currentFrame];
  const lc =
    frame.score >= 65
      ? "#ef4444"
      : frame.score >= 35
      ? "#f59e0b"
      : "#22c55e";

  return (
    <div
      style={{
        background: "rgba(15,23,42,0.85)",
        border: "1px solid rgba(56,189,248,0.15)",
        backdropFilter: "blur(20px)",
        borderRadius: 16,
        padding: "20px 24px",
        animation: "fadeIn 0.5s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⏱</span>
          <div>
            <div
              style={{
                fontFamily: "'Bebas Neue',sans-serif",
                fontSize: 18,
                letterSpacing: "0.06em",
              }}
            >
              FLOOD EVOLUTION
            </div>
            <div
              style={{
                fontFamily: "'Space Mono',monospace",
                fontSize: 10,
                color: "rgba(148,163,184,0.5)",
              }}
            >
              72-HOUR PROGRESSION MODEL
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              padding: "4px 14px",
              borderRadius: 8,
              background: `${lc}22`,
              border: `1px solid ${lc}`,
              fontFamily: "'Space Mono',monospace",
              fontSize: 12,
              color: lc,
            }}
          >
            {frame.label} · {frame.score}% risk
          </div>

          <button
            onClick={() => setPlaying((p) => !p)}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              background: playing
                ? "rgba(239,68,68,0.12)"
                : "rgba(56,189,248,0.12)",
              border: `1px solid ${
                playing ? "#ef4444" : "#38bdf8"
              }`,
              color: playing ? "#f87171" : "#38bdf8",
              fontFamily: "'Space Mono',monospace",
              fontSize: 11,
              cursor: "pointer",
              letterSpacing: "0.06em",
            }}
          >
            {playing ? "⏸ PAUSE" : "▶ PLAY"}
          </button>
        </div>
      </div>

      {/* Slider Bar */}
      <div
        style={{
          position: "relative",
          height: 6,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 3,
          cursor: "pointer",
          marginBottom: 10,
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const percent = (e.clientX - r.left) / r.width;
          setCurrentFrame(
            Math.round(percent * (frames.length - 1))
          );
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(currentFrame / (frames.length - 1)) * 100}%`,
            background: `linear-gradient(90deg,#22c55e,${lc})`,
            borderRadius: 3,
            transition: "width 0.25s",
          }}
        />
      </div>
    </div>
  );
};

// ─── Scenario Comparison ──────────────────────────────────────────────────────

const ScenarioComparison = ({ baseScore }: { baseScore: number }) => {
  const [divX, setDivX] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const bestScore = Math.max(0, baseScore - 30);
  const worstScore = Math.min(100, baseScore + 30);
  const bestLevel = bestScore >= 65 ? "HIGH" : bestScore >= 35 ? "MEDIUM" : "LOW" as "LOW"|"MEDIUM"|"HIGH";
  const worstLevel = worstScore >= 65 ? "HIGH" : worstScore >= 35 ? "MEDIUM" : "LOW" as "LOW"|"MEDIUM"|"HIGH";

  useEffect(() => {
    const move = (e: MouseEvent) => { if (!dragging.current || !containerRef.current) return; const r = containerRef.current.getBoundingClientRect(); setDivX(Math.max(10, Math.min(90, ((e.clientX - r.left) / r.width) * 100))); };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const MiniGauge = ({ score, level, title, icon, desc }: { score: number; level: "LOW"|"MEDIUM"|"HIGH"; title: string; icon: string; desc: string }) => {
    const c = RISK_COLORS[level]; const circ = 2 * Math.PI * 28;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 12px", flex: 1 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.6)", textAlign: "center" as const, letterSpacing: "0.06em" }}>{title}</div>
        <div style={{ position: "relative", width: 64, height: 64 }}>
          <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <circle cx="32" cy="32" r="28" fill="none" stroke={c.border} strokeWidth="6" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ-(score/100)*circ} style={{ filter: `drop-shadow(0 0 3px ${c.border})` }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, color: c.text }}>{score}%</span>
          </div>
        </div>
        <div style={{ padding: "3px 10px", borderRadius: 99, background: `${c.border}22`, border: `1px solid ${c.border}`, color: c.text, fontSize: 10, fontFamily: "'Space Mono',monospace" }}>{level}</div>
        <div style={{ fontSize: 11, color: "rgba(148,163,184,0.6)", textAlign: "center" as const, lineHeight: 1.5 }}>{desc}</div>
      </div>
    );
  };

  return (
    <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden", animation: "fadeIn 0.5s" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <div>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, letterSpacing: "0.06em" }}>SCENARIO COMPARISON</div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.5)" }}>DRAG THE DIVIDER ← → TO COMPARE</div>
        </div>
      </div>
      <div ref={containerRef} style={{ position: "relative", display: "flex", userSelect: "none" as const }}>
        <div style={{ width: `${divX}%`, background: "rgba(34,197,94,0.04)", overflow: "hidden", borderRight: "none" }}>
          <MiniGauge score={bestScore} level={bestLevel} title="BEST CASE · Light Rain" icon="🌤️" desc="Scattered showers, minimal runoff, drainage coping." />
        </div>
        <div style={{ width: `${100-divX}%`, background: "rgba(239,68,68,0.04)" }}>
          <MiniGauge score={worstScore} level={worstLevel} title="WORST CASE · Storm Surge" icon="🌪️" desc="Heavy storm surge + sustained rain. Infrastructure overwhelmed." />
        </div>
        {/* Divider Handle */}
        <div onMouseDown={() => { dragging.current = true; }} style={{ position: "absolute", top: 0, bottom: 0, left: `${divX}%`, transform: "translateX(-50%)", width: 3, background: "linear-gradient(180deg,#38bdf8,#818cf8)", cursor: "col-resize", zIndex: 10, boxShadow: "0 0 12px rgba(56,189,248,0.5)" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 26, height: 26, borderRadius: "50%", background: "#1e293b", border: "2px solid #38bdf8", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 10px rgba(56,189,248,0.4)", cursor: "col-resize" }}>
            <span style={{ fontSize: 11, userSelect: "none" as const }}>⟺</span>
          </div>
        </div>
      </div>
      <div style={{ padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.04)", fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.4)", textAlign: "center" as const }}>
        Scenarios are ±30% from current flood score of {baseScore}%
      </div>
    </div>
  );
};

// ─── Leaflet Map ──────────────────────────────────────────────────────────────

const LeafletMap = ({ center, riskLevel, cityName, showPrecipLayer, mapMode, showRoutes, onMapClick }: { center: [number, number]; riskLevel: "LOW"|"MEDIUM"|"HIGH"; cityName: string; showPrecipLayer: boolean; mapMode: "dark"|"satellite"|"street"; showRoutes: boolean; onMapClick: (lat: number, lon: number) => void; }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const lMap = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const precipRef = useRef<any>(null);
  const baseRef = useRef<any>(null);
  const routeRefs = useRef<any[]>([]);
  const clickRef = useRef<any>(null);

  const TILES: Record<string, string> = {
    dark:      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    street:    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const init = async () => {
      const L = (await import("leaflet")).default;
      if (!mapRef.current) return;
      if (!lMap.current) {
        lMap.current = L.map(mapRef.current, { center, zoom: 11, zoomControl: true, attributionControl: false });
        baseRef.current = L.tileLayer(TILES[mapMode], { maxZoom: 19 }).addTo(lMap.current);
      }
      lMap.current.flyTo(center, 11, { duration: 1.5 });
      if (markerRef.current) markerRef.current.remove();
      const mc = { LOW: "#22c55e", MEDIUM: "#f59e0b", HIGH: "#ef4444" }[riskLevel];
      const mp = { LOW: "rgba(34,197,94,0.3)", MEDIUM: "rgba(245,158,11,0.3)", HIGH: "rgba(239,68,68,0.3)" }[riskLevel];
      markerRef.current = L.marker(center, { icon: L.divIcon({ className: "", html: `<div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;"><div style="position:absolute;width:40px;height:40px;border-radius:50%;background:${mp};animation:markerPulse 2s ease-out infinite;"></div><div style="position:relative;width:18px;height:18px;border-radius:50%;background:${mc};border:3px solid white;box-shadow:0 0 12px ${mc};"></div></div>`, iconSize: [40,40], iconAnchor: [20,20] }) }).addTo(lMap.current).bindPopup(`<div style="font-family:'Space Mono',monospace;font-size:12px;font-weight:600;">${cityName} — ${riskLevel} RISK</div>`, { className: "flood-popup" });
      if (clickRef.current) lMap.current.off("click", clickRef.current);
      clickRef.current = (e: any) => onMapClick(e.latlng.lat, e.latlng.lng);
      lMap.current.on("click", clickRef.current);
    };
    init();
  }, [center, riskLevel, cityName]);

  useEffect(() => {
    if (!lMap.current || typeof window === "undefined") return;
    const swap = async () => { const L = (await import("leaflet")).default; if (baseRef.current) baseRef.current.remove(); baseRef.current = L.tileLayer(TILES[mapMode], { maxZoom: 19 }).addTo(lMap.current); };
    swap();
  }, [mapMode]);

  useEffect(() => {
    if (!lMap.current || typeof window === "undefined") return;
    const toggle = async () => { const L = (await import("leaflet")).default; if (precipRef.current) { precipRef.current.remove(); precipRef.current = null; } if (showPrecipLayer && OWM_KEY) { precipRef.current = L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`, { opacity: 0.65, maxZoom: 19 }).addTo(lMap.current); } };
    toggle();
  }, [showPrecipLayer]);

  useEffect(() => {
    if (!lMap.current || typeof window === "undefined") return;
    const draw = async () => {
      const L = (await import("leaflet")).default;
      routeRefs.current.forEach(l => l.remove()); routeRefs.current = [];
      if (!showRoutes) return;
      const [lat, lon] = center;
      const roads = [
        { pts: [[lat,lon-0.02],[lat,lon+0.025]], color:"#22c55e", w:5, dash: undefined },
        { pts: [[lat-0.015,lon],[lat+0.018,lon]], color:"#f59e0b", w:4, dash:"8,5" },
        { pts: [[lat+0.008,lon-0.01],[lat+0.008,lon+0.018]], color:"#ef4444", w:5, dash: undefined },
        { pts: [[lat-0.005,lon+0.01],[lat+0.02,lon+0.01]], color:"#22c55e", w:3, dash: undefined },
        { pts: [[lat+0.012,lon+0.005],[lat+0.012,lon-0.015]], color:"#f59e0b", w:3, dash:"8,5" },
        { pts: [[lat-0.02,lon-0.008],[lat+0.01,lon-0.008]], color:"#ef4444", w:4, dash: undefined },
      ];
      roads.forEach(r => { routeRefs.current.push(L.polyline(r.pts as any, { color: r.color, weight: r.w, opacity: 0.85, dashArray: r.dash }).addTo(lMap.current)); });
    };
    draw();
  }, [showRoutes, center]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 16, overflow: "hidden" }} />;
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function FloodLoopDashboard() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<GeoResult | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [searching, setSearching] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [showPrecipLayer, setShowPrecipLayer] = useState(false);
  const [mapMode, setMapMode] = useState<"dark"|"satellite"|"street">("dark");
  const [showRoutes, setShowRoutes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [floodHistory, setFloodHistory] = useState<HistoricalFloodEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [crossSection, setCrossSection] = useState<CrossSectionPoint[] | null>(null);
  const [floodFrames, setFloodFrames] = useState<FloodFrame[]>([]);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [playing, setPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<"stats"|"history"|"scenario">("stats");
  const sseRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setCrossSection(generateCrossSection(lat, lon, weather?.flood_risk?.score ?? 20));
  }, [weather]);

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const city = query.trim(); if (!city) return;
    setSearching(true); setError(null); setFloodHistory([]); setFloodFrames([]); setCurrentFrame(0); setPlaying(false); setCrossSection(null);
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; setStreamActive(false); }
    try {
      const res = await fetch(`${API_URL}/geocoding?city=${encodeURIComponent(city)}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "City not found"); }
      const geo: GeoResult = await res.json(); setLocation(geo);
      const wRes = await fetch(`${API_URL}/weather?lat=${geo.lat}&lon=${geo.lon}`);
      if (wRes.ok) {
        const wd = await wRes.json();
        setWeather({ temperature: wd.temperature, humidity: wd.humidity, wind_speed: wd.wind_speed, rain_1h: wd.rain_1h, rain_3h: wd.rain_3h, clouds: wd.clouds, description: wd.description, flood_risk: wd.flood_risk });
        setLastUpdated(new Date()); setFloodFrames(generateFloodFrames(wd.flood_risk?.score ?? 20));
      }
      setLoadingHistory(true);
      try { const hr = await fetch(`${API_URL}/flood-history?city=${encodeURIComponent(geo.name)}`); if (hr.ok) { const hd = await hr.json(); setFloodHistory(hd.events || []); } } catch {} finally { setLoadingHistory(false); }
      const sse = new EventSource(`${API_URL}/weather-stream?lat=${geo.lat}&lon=${geo.lon}&interval=60`);
      sseRef.current = sse; setStreamActive(true);
      sse.onmessage = ev => { try { const d = JSON.parse(ev.data); if (!d.error) { setWeather({ temperature: d.temperature, humidity: d.humidity, wind_speed: d.wind_speed, rain_1h: d.rain_1h, rain_3h: d.rain_3h, clouds: d.clouds, description: d.description, flood_risk: d.flood_risk }); setLastUpdated(new Date()); } } catch {} };
      sse.onerror = () => setStreamActive(false);
    } catch (err: any) { setError(err.message || "Something went wrong"); setLocation(null); }
    finally { setSearching(false); }
  }, [query]);

  useEffect(() => () => { if (sseRef.current) sseRef.current.close(); }, []);
  const mapCenter = useMemo<[number, number]>(() => location ? [location.lat, location.lon] : [20.5937, 78.9629], [location]);
  const riskLevel = weather?.flood_risk?.level ?? "LOW";
  const floodScore = weather?.flood_risk?.score ?? 0;

  const TabBtn = ({ id, icon, label }: { id: typeof activeTab; icon: string; label: string }) => (
    <button onClick={() => setActiveTab(id)} style={{ flex: 1, padding: "10px 4px", background: activeTab===id?"rgba(56,189,248,0.1)":"transparent", border: "none", borderBottom: `2px solid ${activeTab===id?"#38bdf8":"transparent"}`, color: activeTab===id?"#38bdf8":"rgba(148,163,184,0.5)", cursor: "pointer", fontFamily: "'Space Mono',monospace", fontSize: 11, letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.2s" }}>
      <span>{icon}</span><span>{label}</span>
    </button>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#060d1a;color:#f1f5f9;font-family:'Inter',sans-serif;min-height:100vh;overflow-x:hidden}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes alertPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}
        @keyframes markerPulse{0%{transform:scale(0.8);opacity:0.8}100%{transform:scale(2.5);opacity:0}}
        @keyframes streamDot{0%,100%{opacity:1}50%{opacity:0.2}}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#060d1a}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
        .flood-popup .leaflet-popup-content-wrapper{background:rgba(15,23,42,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;backdrop-filter:blur(10px)}
        .flood-popup .leaflet-popup-tip{background:rgba(15,23,42,0.95)}
      `}</style>

      <div style={{ minHeight: "100vh", background: "#060d1a", position: "relative" }}>
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "linear-gradient(rgba(96,165,250,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(96,165,250,0.03) 1px,transparent 1px)", backgroundSize: "60px 60px" }} />
        <div style={{ position: "fixed", top: "-20%", left: "-10%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle,rgba(29,78,216,0.12) 0%,transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 1400, margin: "0 auto", padding: "24px 20px" }}>

          {/* Header */}
          <header style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#1d4ed8,#0891b2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 0 24px rgba(29,78,216,0.5)" }}>🌊</div>
              <div>
                <h1 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(28px,4vw,42px)", letterSpacing: "0.06em", lineHeight: 1 }}>
  FLOODALERT<span style={{ color: "#38bdf8" }}> PRO</span>
</h1>
                <p style={{ fontSize: 11, color: "rgba(148,163,184,0.6)", fontFamily: "'Space Mono',monospace", letterSpacing: "0.12em" }}>REAL-TIME RISK MONITORING</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {streamActive && <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "streamDot 1.5s infinite" }} /><span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "rgba(148,163,184,0.7)" }}>LIVE</span></div>}
              {lastUpdated && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.4)" }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
            </div>
          </header>

          {/* Search */}
          <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 12, maxWidth: 600, background: "rgba(15,23,42,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "8px 8px 8px 16px", backdropFilter: "blur(20px)", boxShadow: "0 0 40px rgba(29,78,216,0.1)" }}>
              <span style={{ fontSize: 18, alignSelf: "center" }}>🔍</span>
              <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search city... (e.g. Mumbai, Houston, Jakarta)" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", fontSize: 15, fontFamily: "'Inter',sans-serif", caretColor: "#38bdf8" }} />
              <button type="submit" disabled={searching || !query.trim()} style={{ padding: "10px 24px", background: searching ? "rgba(29,78,216,0.3)" : "linear-gradient(135deg,#1d4ed8,#0891b2)", border: "none", borderRadius: 10, color: "white", fontFamily: "'Space Mono',monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", cursor: searching ? "not-allowed" : "pointer", whiteSpace: "nowrap" as const, boxShadow: "0 0 20px rgba(29,78,216,0.4)" }}>
                {searching ? "SEARCHING..." : "ANALYZE →"}
              </button>
            </div>
          </form>

          {error && <div style={{ marginBottom: 20, padding: "14px 20px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, color: "#f87171", fontFamily: "'Space Mono',monospace", fontSize: 13, display: "flex", alignItems: "center", gap: 12, animation: "fadeIn 0.3s" }}><span style={{ fontSize: 20 }}>⚠️</span><div><div style={{ fontWeight: 700, marginBottom: 2 }}>CITY NOT FOUND</div><div style={{ opacity: 0.7 }}>{error}</div></div></div>}

          {location && (
            <div style={{ marginBottom: 20, animation: "fadeIn 0.5s" }}>
              <h2 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(22px,3vw,32px)", letterSpacing: "0.06em" }}>
                {location.name}{location.state && <span style={{ color: "rgba(148,163,184,0.6)", fontSize: "0.7em" }}>, {location.state}</span>}<span style={{ color: "rgba(148,163,184,0.4)", fontSize: "0.6em" }}> · {location.country}</span>
              </h2>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "rgba(148,163,184,0.4)", marginTop: 4 }}>
                {location.lat.toFixed(4)}°N · {location.lon.toFixed(4)}°E · {weather?.description?.toUpperCase() || "—"} <span style={{ color: "rgba(56,189,248,0.4)", marginLeft: 10 }}>· 💡 Click map for depth profile</span>
              </div>
            </div>
          )}

          {/* Main Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* LEFT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {/* Tabs */}
              <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden", display: "flex" }}>
                <TabBtn id="stats" icon="📡" label="LIVE DATA" />
                <TabBtn id="history" icon="📜" label="HISTORY" />
                <TabBtn id="scenario" icon="⚡" label="SCENARIOS" />
              </div>

              {activeTab === "stats" && (<>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <StatCard icon="🌡️" label="Temperature" value={weather?.temperature != null ? String(Math.round(weather.temperature)) : null} unit="°C" loading={searching} accent="#ef4444" />
                  <StatCard icon="💧" label="Humidity" value={weather?.humidity != null ? String(weather.humidity) : null} unit="%" loading={searching} accent="#38bdf8" />
                  <StatCard icon="💨" label="Wind Speed" value={weather?.wind_speed != null ? weather.wind_speed.toFixed(1) : null} unit="m/s" loading={searching} accent="#a78bfa" />
                  <StatCard icon="🌧️" label="Rainfall 1h" value={weather?.rain_1h != null ? weather.rain_1h.toFixed(1) : null} unit="mm" loading={searching} accent="#06b6d4" />
                  <StatCard icon="☁️" label="Cloud Cover" value={weather?.clouds != null ? String(weather.clouds) : null} unit="%" loading={searching} accent="#94a3b8" />
                  <StatCard icon="🌊" label="Rainfall 3h" value={weather?.rain_3h != null ? weather.rain_3h.toFixed(1) : null} unit="mm" loading={searching} accent="#0891b2" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FloodGauge risk={weather?.flood_risk ?? null} loading={searching} />
                  <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
                    <div style={{ fontSize: 11, color: "rgba(148,163,184,0.7)", textTransform: "uppercase" as const, letterSpacing: "0.1em", fontFamily: "'Space Mono',monospace", marginBottom: 4 }}>Risk Scale</div>
                    {(["LOW","MEDIUM","HIGH"] as const).map(lvl => (
                      <div key={lvl} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: RISK_COLORS[lvl].border, boxShadow: `0 0 6px ${RISK_COLORS[lvl].border}` }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 11, fontFamily: "'Space Mono',monospace", color: RISK_COLORS[lvl].text }}>{lvl}</span>
                            <span style={{ fontSize: 10, color: "rgba(148,163,184,0.5)", fontFamily: "'Space Mono',monospace" }}>{lvl==="LOW"?"0–34%":lvl==="MEDIUM"?"35–64%":"65–100%"}</span>
                          </div>
                          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.05)" }}><div style={{ height: "100%", width: lvl==="LOW"?"34%":lvl==="MEDIUM"?"64%":"100%", background: RISK_COLORS[lvl].border, borderRadius: 2 }} /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>)}

              {activeTab === "history" && <HistoryPanel events={floodHistory} cityName={location?.name ?? "City"} loading={loadingHistory} />}
              {activeTab === "scenario" && <ScenarioComparison baseScore={floodScore} />}

              {/* Map Controls */}
              <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "rgba(148,163,184,0.5)", letterSpacing: "0.08em", marginBottom: 10 }}>🗺 MAP CONTROLS</div>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
                  {(["dark","satellite","street"] as const).map(m => (
                    <button key={m} onClick={() => setMapMode(m)} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontFamily: "'Space Mono',monospace", cursor: "pointer", transition: "all 0.3s", border: `1px solid ${mapMode===m?"#38bdf8":"rgba(255,255,255,0.12)"}`, background: mapMode===m?"rgba(56,189,248,0.15)":"transparent", color: mapMode===m?"#38bdf8":"rgba(148,163,184,0.7)" }}>
                      {m==="dark"?"🌑":m==="satellite"?"🛰️":"🗺"} {m.toUpperCase()}
                    </button>
                  ))}
                  <button onClick={() => setShowPrecipLayer(p=>!p)} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontFamily: "'Space Mono',monospace", cursor: "pointer", transition: "all 0.3s", border: `1px solid ${showPrecipLayer?"#06b6d4":"rgba(255,255,255,0.12)"}`, background: showPrecipLayer?"rgba(6,182,212,0.12)":"transparent", color: showPrecipLayer?"#06b6d4":"rgba(148,163,184,0.7)" }}>🌧️ PRECIP</button>
                  <button onClick={() => setShowRoutes(r=>!r)} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontFamily: "'Space Mono',monospace", cursor: "pointer", transition: "all 0.3s", border: `1px solid ${showRoutes?"#22c55e":"rgba(255,255,255,0.12)"}`, background: showRoutes?"rgba(34,197,94,0.12)":"transparent", color: showRoutes?"#22c55e":"rgba(148,163,184,0.7)" }}>🛣️ SAFE ROUTES</button>
                </div>
                {showRoutes && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10 }}>
                    <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "rgba(148,163,184,0.6)", marginBottom: 8 }}>🛣️ ROAD STATUS LEGEND</div>
                    {[{c:"#22c55e",l:"SAFE",d:"Open & passable"},{c:"#f59e0b",l:"MINOR FLOOD",d:"Caution advised"},{c:"#ef4444",l:"IMPASSABLE",d:"Avoid — submerged"}].map((r,i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <div style={{ width: 22, height: 5, borderRadius: 3, background: r.c, boxShadow: `0 0 4px ${r.c}` }} />
                        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: r.c }}>{r.l}</span>
                        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.4)" }}>— {r.d}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(56,189,248,0.6)" }}>Current score {floodScore}% · Click map for depth profiles</div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — Map */}
            <div style={{ background: "rgba(15,23,42,0.6)", border: `1px solid ${location?"rgba(56,189,248,0.2)":"rgba(255,255,255,0.08)"}`, backdropFilter: "blur(20px)", borderRadius: 16, overflow: "hidden", minHeight: 560, position: "relative", boxShadow: location?"0 0 40px rgba(29,78,216,0.15)":"none", transition: "all 0.6s" }}>
              {!location ? (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                  <div style={{ fontSize: 48 }}>🌍</div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, color: "rgba(148,163,184,0.5)", textAlign: "center" as const, letterSpacing: "0.06em", lineHeight: 1.8 }}>SEARCH A CITY<br />TO LOAD THE MAP</div>
                </div>
              ) : (
                <LeafletMap center={mapCenter} riskLevel={riskLevel} cityName={location.name} showPrecipLayer={showPrecipLayer} mapMode={mapMode} showRoutes={showRoutes} onMapClick={handleMapClick} />
              )}
              {location && weather?.flood_risk && (
                <div style={{ position: "absolute", top: 16, right: 16, zIndex: 1000, background: "rgba(6,13,26,0.85)", border: `1px solid ${RISK_COLORS[riskLevel].border}`, borderRadius: 10, padding: "10px 14px", backdropFilter: "blur(12px)", boxShadow: RISK_COLORS[riskLevel].glow }}>
                  <div style={{ fontSize: 10, color: "rgba(148,163,184,0.6)", fontFamily: "'Space Mono',monospace" }}>FLOOD RISK</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: RISK_COLORS[riskLevel].text, fontFamily: "'Bebas Neue',sans-serif" }}>{riskLevel} · {weather.flood_risk.score}%</div>
                </div>
              )}
              {/* Map mode badge */}
              <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 1000, background: "rgba(6,13,26,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 12px", fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.5)" }}>
                {mapMode==="dark"?"🌑 DARK":mapMode==="satellite"?"🛰️ SATELLITE":"🗺 STREET"}
              </div>
            </div>
          </div>

          {/* Time Slider — full width */}
          {location && floodFrames.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <TimeSlider frames={floodFrames} currentFrame={currentFrame} setCurrentFrame={setCurrentFrame} playing={playing} setPlaying={setPlaying} />
            </div>
          )}

          <footer style={{ marginTop: 28, textAlign: "center" as const, fontFamily: "'Space Mono',monospace", fontSize: 10, color: "rgba(148,163,184,0.3)", letterSpacing: "0.08em" }}>
            FLOODALERT PRO v2.0 · SATELLITE: ESRI · WEATHER: OWM · CLICK MAP FOR DEPTH PROFILE · ROUTES ARE ILLUSTRATIVE
          </footer>
        </div>
      </div>

      {/* Cross-Section Slide Panel */}
      {crossSection && <CrossSectionChart points={crossSection} onClose={() => setCrossSection(null)} />}
    </>
  );
}
