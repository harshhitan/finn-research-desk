import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FINN | Reliance research desk",
  description: "Company intelligence, grounded in the source. Explore Reliance's financials, filings, cash quality and management commentary.",
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
