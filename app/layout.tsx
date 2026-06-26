import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import Script from "next/script";
import { SiteFooter } from "@/components/site-footer";
import { SiteShellHeader } from "@/components/site-shell-header";
import { getSiteUrl } from "@/lib/site-url";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const siteUrl = new URL(getSiteUrl());
const googleTagManagerId = "GTM-KDM62295";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Mapa de daños y ayuda ciudadana | Terremoto Venezuela",
    template: "%s | Terremoto Venezuela",
  },
  description:
    "Consulta y reporta daños, encuentra contactos de emergencia y accede a recursos de ayuda tras el terremoto del 24 de junio de 2026 en Venezuela.",
  applicationName: "Terremoto Venezuela",
  keywords: [
    "terremoto Venezuela",
    "sismo Venezuela",
    "mapa de daños Venezuela",
    "reportar daños",
    "emergencias Venezuela",
    "ayuda ciudadana",
  ],
  authors: [{ name: "Terremoto Venezuela" }],
  creator: "Terremoto Venezuela",
  publisher: "Terremoto Venezuela",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "es_VE",
    url: "/",
    siteName: "Terremoto Venezuela",
    title: "Terremoto Venezuela | Mapa de daños y ayuda ciudadana",
    description:
      "Consulta y reporta daños y accede a recursos de emergencia tras el terremoto en Venezuela.",
  },
  twitter: {
    card: "summary",
    title: "Terremoto Venezuela | Mapa de daños y ayuda ciudadana",
    description:
      "Consulta y reporta daños y accede a recursos de emergencia tras el terremoto en Venezuela.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "public safety",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es-VE"
      className={`${geist.variable} ${inter.variable} ${geistMono.variable}`}
    >
      <body>
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${googleTagManagerId}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <SiteShellHeader />
        {children}
        <SiteFooter />
      </body>
      <Script
        id="google-tag-manager"
        strategy="afterInteractive"
      >{`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${googleTagManagerId}');`}</Script>
    </html>
  );
}
