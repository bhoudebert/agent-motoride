/** What the phone writes about a ride in the `motoride:ride` element of its GPX header (all optional). */
export interface RideHeader {
  /** The roadbook's name (not the title of the GPX, which has the date). */
  name?: string;
  state?: "completed" | "stopped" | "recovered";
  climbM?: number;
  peakLeftDeg?: number;
  peakRightDeg?: number;
}

export const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The header of a recorded ride's GPX: only what is there and makes sense. */
export function rideHeader(gpx: string): RideHeader {
  const header = /<motoride:ride\b([^>]*)\/?>/.exec(gpx)?.[1] ?? "";
  const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(header)?.[1];
  const number = (name: string): number | undefined => {
    const text = attr(name);
    const n = text === undefined || text.trim() === "" ? NaN : Number(text);
    return Number.isFinite(n) ? n : undefined;
  };
  const name = unescapeXml(attr("name") ?? "").trim();
  const state = attr("state");
  const climbM = number("climbM");
  const peakLeftDeg = number("peakLeftDeg");
  const peakRightDeg = number("peakRightDeg");
  return {
    ...(name ? { name: name.slice(0, 200) } : {}),
    ...(state === "completed" || state === "stopped" || state === "recovered" ? { state } : {}),
    ...(climbM !== undefined ? { climbM } : {}),
    ...(peakLeftDeg !== undefined ? { peakLeftDeg } : {}),
    ...(peakRightDeg !== undefined ? { peakRightDeg } : {}),
  };
}
