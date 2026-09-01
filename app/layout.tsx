import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Analytics from "@/components/Analytics";

/* Archivo carries a real width axis, so the condensed display setting is the
   typeface's own design rather than a horizontally scaled fake. One family
   across every width keeps the page from reading as two fonts bolted together. */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

/* Reserved for catalogue numbers, durations and counts — anything that is data. */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Heardzz — name the record",
  description:
    "Hear a fraction of a second of a jazz recording. Name the artist and the tune.",
};

export const viewport: Viewport = {
  themeColor: "#0d0c0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} h-full`}>
      <body className="grain min-h-full bg-ink text-paper">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
