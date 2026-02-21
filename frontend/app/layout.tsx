import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FloodLoop — Real-Time Flood Risk Dashboard",
  description: "Monitor live weather conditions and flood risk probability for any city worldwide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#060d1a" }}>
        {children}
      </body>
    </html>
  );
}
