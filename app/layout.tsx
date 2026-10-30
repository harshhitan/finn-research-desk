import type { Metadata } from "next";
import "./globals.css";
import "./portfolio.css";

export const metadata: Metadata = {
  title: "FINN | Indian portfolio monitoring",
  description: "Monitor 20 Indian companies through primary exchange filings, completed-session market data and inspectable evidence.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FINN", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
