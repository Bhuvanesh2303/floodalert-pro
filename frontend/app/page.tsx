"use client";
import dynamic from "next/dynamic";

// Disable SSR for the dashboard (Leaflet requires window)
const FloodLoopDashboard = dynamic(
  () => import("../components/FloodLoopDashboard"),
  { ssr: false }
);

export default function Home() {
  return <FloodLoopDashboard />;
}
