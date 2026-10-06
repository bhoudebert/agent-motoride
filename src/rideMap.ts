// A small map of a saved ride, drawn from the ride's own data (route line,
// towns, planned stops, fixed cameras) in the roadbook style of the site.
// No map tiles: nothing is fetched, and the picture is the same everywhere.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { decodePolyline, type LatLon } from "./geometry.ts";
import type { SavedRide } from "./store.ts";
import { haversineKm } from "./tools/geo.ts";

const W = 1200;
const HEADER = 118;
const MARGIN = 70;
/** The picture's height follows the ride's shape, between these bounds. */
const MIN_H = 620;
const MAX_H = 1150;
/** Room kept under the drawing for the legend row. */
const LEGEND = 30;

const C = {
  paper: "#f3eee4",
  card: "#fbf8f1",
  ink: "#1c1d1a",
  ink2: "#4a4b44",
  moss: "#24382d",
  rust: "#a8432a",
  signal: "#e6b422",
  contour: "#e2d9c6",
};
// The site's families, bundled under assets/fonts (SIL Open Font License).
const FONT = "Space Grotesk";
const MONO = "JetBrains Mono";
const FONT_FILES = ["SpaceGrotesk-Medium.ttf", "SpaceGrotesk-Bold.ttf", "JetBrainsMono-Regular.ttf"].map((f) =>
  fileURLToPath(new URL(`../assets/fonts/${f}`, import.meta.url)),
);

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const coordsOf = (text: string): LatLon => {
  const [lat = 0, lon = 0] = text.split(",").map(Number);
  return { lat, lon };
};

const COUNTRIES = new Set([
  "belgium",
  "belgique",
  "belgië",
  "france",
  "nederland",
  "netherlands",
  "deutschland",
  "germany",
  "luxembourg",
  "españa",
  "spain",
  "italia",
  "italy",
  "schweiz",
  "suisse",
  "switzerland",
]);

/**
 * The town of a leg end, for a label: "Rue de Vendegies near Sommaing" -> "Sommaing",
 * "Route Nationale, Coutiches" -> "Coutiches". Null for bare coordinates, kept
 * by rides saved before ends were named.
 */
export function townOf(label: string): string | null {
  const near = / near (.+)$/.exec(label);
  if (near) return near[1]!;
  const parts = label
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^-?\d+(\.\d+)?$/.test(p) && !COUNTRIES.has(p.toLowerCase()));
  return parts.at(-1) ?? null;
}

interface Point {
  x: number;
  y: number;
}
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Height of the picture for a ride of this shape: a wide ride gets a shorter picture. */
function heightFor(points: LatLon[]): number {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const kx = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
  const ratio = (Math.max(...lats) - Math.min(...lats)) / Math.max((Math.max(...lons) - Math.min(...lons)) * kx, 1e-6);
  const areaH = (W - 2 * MARGIN) * ratio;
  return Math.round(Math.min(MAX_H, Math.max(MIN_H, HEADER + 2 * MARGIN + LEGEND + areaH)));
}

/** Equirectangular projection fitted to the drawing area, north up, true proportions. */
function projector(points: LatLon[], H: number) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const x0 = Math.min(...lons) * kx;
  const x1 = Math.max(...lons) * kx;
  const y0 = Math.min(...lats);
  const y1 = Math.max(...lats);
  const areaW = W - 2 * MARGIN;
  const areaH = H - HEADER - 2 * MARGIN - LEGEND;
  const scale = Math.min(areaW / Math.max(x1 - x0, 1e-6), areaH / Math.max(y1 - y0, 1e-6));
  const offX = MARGIN + (areaW - (x1 - x0) * scale) / 2;
  const offY = HEADER + MARGIN + (areaH - (y1 - y0) * scale) / 2;
  // A tenth of a pixel is plenty, and keeps the SVG small.
  const r = (n: number) => Math.round(n * 10) / 10;
  const project = (p: LatLon): Point => ({ x: r(offX + (p.lon * kx - x0) * scale), y: r(offY + (y1 - p.lat) * scale) });
  // km per pixel, for the scale bar: one degree of latitude is about 111.2 km.
  return { project, kmPerPx: 111.2 / scale };
}

/** A round number of km that fits a scale bar of about 160 px. */
function scaleKm(kmPerPx: number): number {
  const target = kmPerPx * 160;
  return [1, 2, 5, 10, 20, 25, 50, 100].findLast((k) => k <= target) ?? 1;
}

/**
 * Places labels where they cross the least: the route, the markers, the other
 * labels and the picture's edges. Each label tries a few positions around its
 * point and keeps the cheapest.
 */
class Labels {
  readonly #taken: Box[] = [];
  readonly #route: Point[];
  readonly #bounds: Box;

  constructor(route: Point[], bounds: Box) {
    this.#route = route;
    this.#bounds = bounds;
  }

  /** A marker the labels must not cover. */
  block(at: Point, radius: number): void {
    this.#taken.push({ x0: at.x - radius, y0: at.y - radius, x1: at.x + radius, y1: at.y + radius });
  }

  /** Where to write `text` next to `at`: the anchor, the baseline and the alignment. */
  place(at: Point, text: string, size: number, gap: number): { x: number; y: number; anchor: "start" | "end" } {
    const width = text.length * size * 0.56;
    const candidates = [
      { dx: gap, dy: size * 0.35, anchor: "start" as const },
      { dx: -gap, dy: size * 0.35, anchor: "end" as const },
      { dx: gap, dy: -gap, anchor: "start" as const },
      { dx: gap, dy: gap + size * 0.8, anchor: "start" as const },
      { dx: -gap, dy: -gap, anchor: "end" as const },
      { dx: -gap, dy: gap + size * 0.8, anchor: "end" as const },
    ];
    let best: { cost: number; x: number; y: number; anchor: "start" | "end"; box: Box } | undefined;
    for (const c of candidates) {
      const x = at.x + c.dx;
      const y = at.y + c.dy;
      const box = {
        x0: c.anchor === "start" ? x : x - width,
        x1: c.anchor === "start" ? x + width : x,
        y0: y - size,
        y1: y + size * 0.25,
      };
      const inside = (p: Point) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
      const overlaps = this.#taken.filter(
        (t) => t.x0 < box.x1 && t.x1 > box.x0 && t.y0 < box.y1 && t.y1 > box.y0,
      ).length;
      const out =
        box.x0 < this.#bounds.x0 || box.x1 > this.#bounds.x1 || box.y0 < this.#bounds.y0 || box.y1 > this.#bounds.y1;
      // Covering a marker or a label is worse than crossing the route line.
      const cost = (out ? 1000 : 0) + overlaps * 300 + this.#route.filter(inside).length;
      if (!best || cost < best.cost) best = { cost, x, y, anchor: c.anchor, box };
    }
    this.#taken.push(best!.box);
    return best!;
  }
}

/** The ride as an SVG picture, 1200 wide, its height following the ride's shape. */
export function rideMapSvg(ride: SavedRide): string {
  const legs = (ride.shapes ?? []).map((s) => decodePolyline(s));
  if (!legs.length) throw new Error(`Roadbook #${ride.id} has no stored route line; refresh it first.`);
  const all = legs.flat();
  const H = heightFor(all);
  const { project, kmPerPx } = projector(all, H);
  const out: string[] = [];
  const push = (s: string) => out.push(s);
  const route = all.filter((_, i) => i % 2 === 0).map(project);
  const labels = new Labels(route, { x0: 10, y0: HEADER + 8, x1: W - 10, y1: H - LEGEND - 18 });

  push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  push(`<rect width="${W}" height="${H}" fill="${C.paper}"/>`);
  // Faint contour-like lines, as on the site's hero.
  for (let y = HEADER + 80; y < H - LEGEND; y += 120) {
    push(
      `<path d="M -20 ${y} C 300 ${y - 50} 600 ${y + 60} 900 ${y - 10} S 1150 ${y - 40} 1230 ${y}" fill="none" stroke="${C.contour}" stroke-width="1.2"/>`,
    );
  }

  // Route, leg by leg, alternating moss and rust, on a paper casing.
  const path = (pts: LatLon[]) =>
    pts
      .map((p, i) => {
        const q = project(p);
        return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      })
      .join(" ");
  for (const leg of legs) {
    push(
      `<path d="${path(leg)}" fill="none" stroke="${C.card}" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }
  legs.forEach((leg, i) => {
    push(
      `<path d="${path(leg)}" fill="none" stroke="${i % 2 ? C.rust : C.moss}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  });

  // Markers first, so their labels keep clear of all of them.
  const waypoints = [ride.legs[0], ...ride.legs].flatMap((leg, i) =>
    leg ? [{ at: coordsOf(i === 0 ? leg.fromCoords : leg.toCoords), name: townOf(i === 0 ? leg.from : leg.to) }] : [],
  );
  const loop = ride.roundTrip || haversineKm(waypoints[0]!.at, waypoints.at(-1)!.at) < 0.5;
  const towns = loop ? waypoints.slice(0, -1) : waypoints;
  const cameras = (ride.extras?.cameras ?? []).map((cam) => ({ ...cam, q: project(coordsOf(cam.coords)) }));
  const stops = (ride.extras?.stopPlan?.stops ?? []).map((stop) => ({ ...stop, q: project(coordsOf(stop.coords)) }));
  for (const w of towns) labels.block(project(w.at), 10);
  for (const cam of cameras) labels.block(cam.q, 14);
  for (const stop of stops) labels.block(stop.q, 14);

  // km marks every 25 km; one closer than 30 px to another (the same road ridden back) is left out,
  // and so is one on a marker.
  const marks: Point[] = [];
  let km = 0;
  let next = 25;
  for (let i = 1; i < all.length; i++) {
    km += haversineKm(all[i - 1]!, all[i]!);
    if (km < next) continue;
    const q = project(all[i]!);
    // A mark on a camera, a stop or a town would hide under it: that spot is marked already.
    const markers = [...cameras.map((c) => c.q), ...stops.map((st) => st.q), ...towns.map((w) => project(w.at))];
    const near = (m: Point) => Math.hypot(m.x - q.x, m.y - q.y);
    if (next < ride.distanceKm - 5 && !marks.some((m) => near(m) < 30) && !markers.some((m) => near(m) < 24)) {
      marks.push(q);
      labels.block(q, 5);
      const at = labels.place(q, String(next), 15, 9);
      push(`<circle cx="${q.x}" cy="${q.y}" r="4" fill="${C.card}" stroke="${C.ink}" stroke-width="1.5"/>`);
      push(
        `<text x="${at.x}" y="${at.y}" text-anchor="${at.anchor}" font-family="${MONO}" font-size="15" fill="${C.ink2}" stroke="${C.paper}" stroke-width="4" paint-order="stroke">${next}</text>`,
      );
    }
    next += 25;
  }

  // Towns in riding order; the start is the bold one.
  towns.forEach((w, i) => {
    const q = project(w.at);
    const role = loop ? "start and finish" : "start";
    const label = i === 0 ? (w.name ? `${w.name} · ${role}` : role[0]!.toUpperCase() + role.slice(1)) : w.name;
    push(
      `<circle cx="${q.x}" cy="${q.y}" r="${i === 0 ? 10 : 7}" fill="${i === 0 ? C.ink : C.card}" stroke="${C.ink}" stroke-width="2.5"/>`,
    );
    if (!label) return;
    const size = i === 0 ? 21 : 18;
    const at = labels.place(q, label, size, 15);
    push(
      `<text x="${at.x}" y="${at.y}" text-anchor="${at.anchor}" font-family="${FONT}" font-size="${size}" font-weight="${i === 0 ? 700 : 500}" fill="${C.ink}" stroke="${C.paper}" stroke-width="5" paint-order="stroke">${esc(label)}</text>`,
    );
  });
  if (!loop) {
    const q = project(waypoints.at(-1)!.at);
    push(`<rect x="${q.x - 9}" y="${q.y - 9}" width="18" height="18" fill="${C.ink}"/>`);
  }

  // Fixed speed cameras: a red-rimmed badge with the posted limit.
  for (const cam of cameras) {
    const limit = cam.limitKmh === null ? "?" : String(cam.limitKmh);
    push(`<circle cx="${cam.q.x}" cy="${cam.q.y}" r="13" fill="#ffffff" stroke="${C.rust}" stroke-width="3.5"/>`);
    push(
      `<text x="${cam.q.x}" y="${cam.q.y + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="${limit.length > 2 ? 10.5 : 12.5}" font-weight="700" fill="${C.ink}">${esc(limit)}</text>`,
    );
  }

  // Planned stops: a yellow square with the kind's letter, and the arrival time.
  const letter = { fuel: "F", pause: "C", lunch: "L" } as const;
  for (const stop of stops) {
    const { q } = stop;
    push(
      `<rect x="${q.x - 13}" y="${q.y - 13}" width="26" height="26" fill="${C.signal}" stroke="${C.ink}" stroke-width="2"/>`,
    );
    push(
      `<text x="${q.x}" y="${q.y + 6}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${C.ink}">${letter[stop.kind]}</text>`,
    );
    const text = `${stop.eta} ${stop.name}`;
    const at = labels.place(q, text, 14, 20);
    push(
      `<text x="${at.x}" y="${at.y}" text-anchor="${at.anchor}" font-family="${MONO}" font-size="14" fill="${C.ink}" stroke="${C.paper}" stroke-width="4" paint-order="stroke">${esc(text)}</text>`,
    );
  }

  // Header: the ride in figures, as the roadbook's top strip.
  const s = ride.speedLimits as { openRoadPct?: number } | null;
  push(`<rect width="${W}" height="${HEADER}" fill="${C.ink}"/>`);
  push(
    `<text x="40" y="58" font-family="${FONT}" font-size="34" font-weight="700" fill="${C.paper}">${esc(ride.name)}</text>`,
  );
  const figures = [
    `${ride.distanceKm} km`,
    `${fmtMinutes(ride.ridingMinutes)} riding`,
    s?.openRoadPct === undefined ? null : `${s.openRoadPct}% open road`,
    ride.rideDate ? `${ride.rideDate}${ride.departure ? ` · dep ${ride.departure}` : ""}` : null,
  ].filter(Boolean);
  push(
    `<text x="40" y="94" font-family="${MONO}" font-size="19" fill="${C.signal}">${esc(figures.join("   ·   ").toUpperCase())}</text>`,
  );

  // Legend, scale bar, north arrow, attribution.
  const ly = H - 30;
  const scale = scaleKm(kmPerPx);
  push(`<rect x="40" y="${ly - 6}" width="${(scale / kmPerPx).toFixed(1)}" height="6" fill="${C.ink}"/>`);
  push(`<text x="40" y="${ly - 14}" font-family="${MONO}" font-size="14" fill="${C.ink2}">${scale} km</text>`);
  push(`<path d="M ${W - 60} ${HEADER + 70} l -12 30 l 12 -8 l 12 8 z" fill="${C.ink}"/>`);
  push(
    `<text x="${W - 60}" y="${HEADER + 58}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${C.ink}">N</text>`,
  );
  const legend = [
    `<circle cx="0" cy="-5" r="9" fill="#ffffff" stroke="${C.rust}" stroke-width="3"/><text x="16" y="0" font-family="${FONT}" font-size="15" fill="${C.ink2}">fixed camera, limit</text>`,
    `<rect x="-9" y="-14" width="18" height="18" fill="${C.signal}" stroke="${C.ink}" stroke-width="1.5"/><text x="16" y="0" font-family="${FONT}" font-size="15" fill="${C.ink2}">stop: F fuel, C coffee, L lunch</text>`,
  ];
  legend.forEach((item, i) => push(`<g transform="translate(${300 + i * 230} ${ly})">${item}</g>`));
  push(
    `<text x="${W - 40}" y="${ly}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${C.ink2}">Route data © OpenStreetMap contributors · agentMotoride</text>`,
  );
  push("</svg>");
  return out.join("\n");
}

/** The ride as a PNG picture, with the bundled fonts only, so it is the same on every machine. */
export function rideMapPng(ride: SavedRide): Buffer {
  const resvg = new Resvg(rideMapSvg(ride), {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONT },
  });
  return Buffer.from(resvg.render().asPng());
}

const EXPORT_DIR = fileURLToPath(new URL("../exports/", import.meta.url));

/** File name of a ride's exports: "7-avesnois-loop-from-coutiches". */
export function exportBase(ride: SavedRide): string {
  const slug = ride.name
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${ride.id}-${slug || "ride"}`;
}

/** Write the ride's map as a PNG, by default in exports/. Returns the path. */
export function writeRideMap(ride: SavedRide, file?: string): string {
  const path = resolve(file?.trim() || resolve(EXPORT_DIR, `${exportBase(ride)}.png`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rideMapPng(ride));
  return path;
}
