import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";
import { buildGpx, type GpxInput } from "./gpx.ts";

/** Print a QR code for a short text (a link) in the terminal. */
export function printQr(text: string): Promise<void> {
  return new Promise((resolve) => {
    qrcode.generate(text, { small: true }, (code: string) => {
      console.log(code);
      resolve();
    });
  });
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
  gpx: GpxInput;
  itinerary: string;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
<p>${(shared.mapsUrls ?? [shared.mapsUrl]).map((url, i, all) => `<a href="${esc(url)}" style="display:inline-block;margin:.2rem .4rem .2rem 0;padding:.8rem 1.2rem;background:#1a73e8;color:#fff;border-radius:.5rem;text-decoration:none">Google Maps${all.length > 1 ? ` part ${i + 1}` : ""}</a>`).join("")}
&nbsp; <a href="/ride.gpx" style="display:inline-block;padding:.8rem 1.2rem;background:#444;color:#fff;border-radius:.5rem;text-decoration:none">Download GPX</a></p>
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
