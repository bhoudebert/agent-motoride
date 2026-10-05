export { encodePolyline } from "../../src/geometry.ts";

/** A line from a to b with `n` points, bulging sideways by `bulge` degrees in the middle. */
export function bentLine(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  n = 50,
  bulge = 0,
): Array<{ lat: number; lon: number }> {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { lat: a.lat + (b.lat - a.lat) * t + bulge * Math.sin(Math.PI * t), lon: a.lon + (b.lon - a.lon) * t };
  });
}
