import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { renderUnicodeCompact } from "uqr";
import { buildGpx, type GpxInput } from "./gpx.ts";

/** Print a QR code for a short text (a link) in the terminal, two modules per character. */
export function printQr(text: string): Promise<void> {
  console.log(renderUnicodeCompact(text, { border: 2 }));
  return Promise.resolve();
}

/** First non-loopback IPv4 address: what a phone on the same Wi-Fi can reach. */
export function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return undefined;
}

export interface Shared {
  name: string;
  mapsUrl: string;
  mapsUrls?: string[];
  /** One link showing the whole ride, when it needs several parts. */
  overviewUrl?: string | null;
  gpx: GpxInput;
  itinerary: string;
  /** The ride's map picture (PNG), for a saved ride. */
  picture?: Buffer;
  /** The roadbook file (`.motoride.json`) for the MobileMotoRide app, made on first request: it traces the route. */
  roadbookFile?: () => Promise<string>;
}

/** Run an async job once and share its result; a failure is not kept, so the next request tries again. */
export function once<T>(job: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= job().catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
}

/** The link that makes the MotoRide app download and import a roadbook file (`mobilemotoride://import?url=`). */
export const importLink = (fileUrl: string) => `mobilemotoride://import?url=${encodeURIComponent(fileUrl)}`;

/** Escape text for HTML content and quoted attributes. */
export const escapeHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const esc = escapeHtml;
/** Only web links become buttons: a "javascript:" URL in stored data must not. */
const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/**
 * A tiny web server on the local network: one page with the map link, the
 * itinerary and a GPX download, for the phone. Content is read on each request,
 * so the page follows the current itinerary. Nothing leaves the local network.
 */
export function startShareServer(
  current: () => Shared | undefined,
  port: number,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const shared = current();
    if (!shared) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("No itinerary to share yet.");
    }
    if (req.url?.startsWith("/ride.motoride.json") && shared.roadbookFile) {
      shared
        .roadbookFile()
        .then((body) => {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": 'attachment; filename="ride.motoride.json"',
            "cache-control": "no-store",
          });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
          res.end("The roadbook file could not be made right now; try again.");
        });
      return;
    }
    if (req.url?.startsWith("/map.png") && shared.picture) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(shared.picture);
    }
    if (req.url?.startsWith("/ride.gpx")) {
      res.writeHead(200, {
        "content-type": "application/gpx+xml",
        "content-disposition": 'attachment; filename="ride.gpx"',
      });
      return res.end(buildGpx(shared.gpx));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(shared.name)}</title>
<body style="font: 16px/1.5 system-ui, sans-serif; margin: 1.5rem; max-width: 40rem">
<h1 style="font-size:1.4rem">${esc(shared.name)}</h1>
<p>${(shared.mapsUrls ?? [shared.mapsUrl])
      .filter(isWebLink)
      .map(
        (url, i, all) =>
          `<a href="${esc(url)}" style="display:inline-block;margin:.2rem .4rem .2rem 0;padding:.8rem 1.2rem;background:#1a73e8;color:#fff;border-radius:.5rem;text-decoration:none">Google Maps${all.length > 1 ? ` part ${i + 1}` : ""}</a>`,
      )
      .join("")}
${shared.overviewUrl && isWebLink(shared.overviewUrl) ? `<a href="${esc(shared.overviewUrl)}" style="display:inline-block;margin:.2rem .4rem .2rem 0;padding:.8rem 1.2rem;background:#fff;color:#1a73e8;border:2px solid #1a73e8;border-radius:.5rem;text-decoration:none">Whole ride (overview)</a>` : ""}
&nbsp; <a href="/ride.gpx" style="display:inline-block;padding:.8rem 1.2rem;background:#444;color:#fff;border-radius:.5rem;text-decoration:none">Download GPX</a></p>
${shared.roadbookFile ? `<p><a href="${esc(importLink(`http://${req.headers.host ?? "localhost"}/ride.motoride.json`))}" style="display:inline-block;padding:.8rem 1.2rem;background:#0a7d3b;color:#fff;border-radius:.5rem;text-decoration:none">Open in MotoRide</a> <a href="/ride.motoride.json" style="display:inline-block;padding:.8rem 1.2rem;background:#444;color:#fff;border-radius:.5rem;text-decoration:none">Roadbook file</a></p>` : ""}
${shared.picture ? `<p><img src="/map.png" alt="Map of the ride" style="width:100%;height:auto;border-radius:.5rem"></p>` : ""}
<pre style="white-space:pre-wrap;background:#f4f4f4;padding:1rem;border-radius:.5rem">${esc(shared.itinerary)}</pre>
</body>`);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      const host = lanAddress() ?? "localhost";
      resolve({ server, url: `http://${host}:${port}/` });
    });
  });
}
