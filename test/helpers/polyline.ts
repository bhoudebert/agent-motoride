/** Encode points as a polyline (precision 6), the inverse of decodePolyline, for fixtures. */
export function encodePolyline(points: Array<{ lat: number; lon: number }>): string {
  let out = "";
  let lastLat = 0;
  let lastLon = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e6);
    const lon = Math.round(p.lon * 1e6);
    encode(lat - lastLat);
    encode(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return out;
}

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
