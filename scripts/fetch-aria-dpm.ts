#!/usr/bin/env tsx
// Discovers and downloads the ARIA Damage Proxy Map for the Venezuela earthquake (Jun 24 2026).
// ARIA DPM is a SAR coherence-loss product published by NASA/JPL 1-3 days after major events.
// When found, prints the local filename to stdout and the import command to stderr.
//
// Usage:
//   pnpm tsx scripts/fetch-aria-dpm.ts
//   # Then import with:
//   pnpm import:satellite:sar --dpm-url <file.tif> --write

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ARIA_BASE = "https://aria-share.jpl.nasa.gov/events/";

// Venezuela earthquake 2026-06-24 bbox
const VEN_TERMS = ["Venezuela", "VEN", "20260624", "20260625", "Yaracuy", "Caracas"];

function progress(msg: string) {
  process.stderr.write(`[aria-dpm] ${msg}\n`);
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function extractHrefs(html: string, base: string): string[] {
  return [...html.matchAll(/href="([^"#?]+)"/gi)]
    .map((m) => {
      const href = m[1];
      try {
        return new URL(href, base).href;
      } catch {
        return null;
      }
    })
    .filter((u): u is string => u !== null && u.startsWith("http"));
}

async function scanDir(url: string): Promise<string | null> {
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch {
    return null;
  }
  const links = extractHrefs(html, url);
  // Look for DPM .tif files
  const tifs = links.filter(
    (l) =>
      (l.endsWith(".tif") || l.endsWith(".tiff")) &&
      (l.includes("DPM") || l.includes("dpm") || l.includes("damage") || l.includes("proxy")),
  );
  if (tifs.length > 0) return tifs[0];
  return null;
}

async function main() {
  progress("Buscando eventos en JPL ARIA Share...");
  progress(`Base: ${ARIA_BASE}`);

  let indexHtml: string;
  try {
    indexHtml = await fetchHtml(ARIA_BASE);
  } catch (err) {
    progress(`No se pudo acceder a ${ARIA_BASE}: ${err instanceof Error ? err.message : err}`);
    progress("ARIA DPM puede no estar disponible aún (se publica 1-3 días después del evento).");
    printAlternatives();
    process.exit(1);
  }

  const allLinks = extractHrefs(indexHtml, ARIA_BASE);
  const dirLinks = allLinks.filter((l) => l.endsWith("/") && l !== ARIA_BASE);

  // Score each directory by how many Venezuela terms it contains
  const candidates = dirLinks
    .map((url) => {
      const score = VEN_TERMS.filter((t) =>
        url.toLowerCase().includes(t.toLowerCase()),
      ).length;
      return { url, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // Also look for recent June/July 2026 directories
    const recent = dirLinks.filter((l) => /2026[_-]?0[67]/.test(l));
    if (recent.length > 0) {
      progress(`No se encontró directorio Venezuela específico. Revisando ${recent.length} directorios recientes...`);
      for (const url of recent) {
        progress(`Revisando ${url}`);
        const tif = await scanDir(url);
        if (tif) {
          await download(tif);
          return;
        }
      }
    }

    progress("No se encontraron directorios de Venezuela ni recientes en JPL ARIA.");
    printAlternatives();
    process.exit(1);
  }

  progress(`Encontrados ${candidates.length} directorios candidatos.`);
  for (const { url, score } of candidates) {
    progress(`Revisando (score=${score}): ${url}`);
    const tif = await scanDir(url);
    if (tif) {
      await download(tif);
      return;
    }
  }

  progress("Los directorios candidatos no contienen archivos DPM .tif aún.");
  printAlternatives();
  process.exit(1);
}

async function download(tifUrl: string) {
  const filename = decodeURIComponent(new URL(tifUrl).pathname.split("/").pop() ?? "aria-dpm-venezuela.tif");
  progress(`Descargando ${tifUrl} → ${filename}`);

  const res = await fetch(tifUrl, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida: ${res.status} ${tifUrl}`);

  const contentLength = res.headers.get("content-length");
  if (contentLength) progress(`Tamaño: ${(Number(contentLength) / 1_048_576).toFixed(1)} MB`);

  await pipeline(
    Readable.fromWeb(res.body as import("stream/web").ReadableStream),
    createWriteStream(filename),
  );

  progress(`Descargado: ${filename}`);
  progress(`Importa con:`);
  progress(`  pnpm import:satellite:sar --dpm-url ${filename} --write`);
  console.log(filename); // stdout: usable as $(pnpm tsx scripts/fetch-aria-dpm.ts)
}

function printAlternatives() {
  progress("");
  progress("Alternativas para obtener el DPM:");
  progress("  1. JPL ARIA Share (cuando esté disponible):  https://aria-share.jpl.nasa.gov/events/");
  progress("  2. ASF DAAC ARIA Products:                   https://search.asf.alaska.edu/#/?dataset=ARIA");
  progress("  3. Copernicus EMS EMSR884 (ya en el código): pnpm import:satellite:ems-zones --write");
  progress("  4. GDACS:                                    pnpm import:satellite:gdacs --gdacs-url <url> --write");
  progress("");
  progress("Cuando obtengas el .tif:");
  progress("  pnpm import:satellite:sar --dpm-url <archivo.tif> --write");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
