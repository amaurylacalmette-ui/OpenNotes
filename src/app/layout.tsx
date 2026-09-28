import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenNotes — Free handwritten notes for iPad, Mac & Windows",
  description:
    "OpenNotes is a free, open-source handwriting and note-taking app. Pressure-sensitive ink, highlighters, precision erasers, laser pointer and PDF export — private by design, all data stays on your device.",
  applicationName: "OpenNotes",
  keywords: [
    "OpenNotes",
    "open source",
    "handwriting",
    "note taking",
    "GoodNotes alternative",
    "Apple Pencil",
    "PWA",
    "iPad",
    "Mac",
    "Windows",
  ],
  authors: [{ name: "OpenNotes Contributors" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "OpenNotes",
  },
  openGraph: {
    title: "OpenNotes — Free handwritten notes for iPad, Mac & Windows",
    description:
      "A free, open-source, privacy-first handwriting app. Install it on any device — no account, no cloud, no subscription.",
    siteName: "OpenNotes",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#8a5a32",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground overscroll-none">
        {children}
      </body>
    </html>
  );
}
