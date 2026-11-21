/**
 * The route a phone asks of the server (spec multi-user-server, "Routes for the phone"): a few places and the motorcycle options
 * the phone knows. It is rebuilt here into the request Valhalla gets, never passed on as it came, so a rider's token cannot be used
 * to ask a private Valhalla for anything else (isochrones, matrices, a map of the whole country).
 */
export const MAX_ROUTE_LOCATIONS = 5;
export const MAX_ALTERNATES = 2;
/** The size of the body asked for: a few places and options. */
export const MAX_ROUTE_BODY = 2048;

export interface RouteLocation {
  lat: number;
  lon: number;
  heading?: number;
  heading_tolerance?: number;
}

type Parsed = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function location(raw: unknown): RouteLocation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { lat, lon, heading, heading_tolerance } = raw as Record<string, unknown>;
  if (!isNumber(lat) || !isNumber(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const out: RouteLocation = { lat, lon };
  if (heading !== undefined) {
    if (!isNumber(heading) || heading < 0 || heading > 360) return null;
    out.heading = Math.round(heading);
    if (heading_tolerance !== undefined) {
      if (!isNumber(heading_tolerance) || heading_tolerance < 0 || heading_tolerance > 180) return null;
      out.heading_tolerance = Math.round(heading_tolerance);
    }
  }
  return out;
}

/** The request for Valhalla from what a phone sent, or why it is not valid. */
export function parseRouteRequest(input: unknown): Parsed {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const list = raw["locations"];
  if (!Array.isArray(list) || list.length < 2 || list.length > MAX_ROUTE_LOCATIONS)
    return { ok: false, error: `Two to ${MAX_ROUTE_LOCATIONS} locations {lat, lon} are needed.` };
  const locations = list.map(location);
  if (locations.some((l) => l === null)) return { ok: false, error: "A location is not valid." };
  if (raw["costing"] !== undefined && raw["costing"] !== "motorcycle")
    return { ok: false, error: 'Only the "motorcycle" costing is offered.' };
  const options: Record<string, number | boolean> = {};
  const given = raw["costing_options"];
  if (given !== undefined) {
    const mine =
      typeof given === "object" && given !== null ? (given as Record<string, unknown>)["motorcycle"] : undefined;
    if (typeof mine !== "object" || mine === null)
      return { ok: false, error: "costing_options.motorcycle is not valid." };
    for (const [key, value] of Object.entries(mine)) {
      if (key === "use_highways" && isNumber(value) && value >= 0 && value <= 1) options[key] = value;
      else if (key === "shortest" && typeof value === "boolean") options[key] = value;
      else return { ok: false, error: `The motorcycle option "${key}" is not offered.` };
    }
  }
  const alternates = raw["alternates"];
  if (
    alternates !== undefined &&
    (!Number.isInteger(alternates) || (alternates as number) < 0 || (alternates as number) > MAX_ALTERNATES)
  )
    return { ok: false, error: `alternates is 0 to ${MAX_ALTERNATES}.` };
  return {
    ok: true,
    body: {
      locations,
      costing: "motorcycle",
      ...(Object.keys(options).length ? { costing_options: { motorcycle: options } } : {}),
      ...(typeof alternates === "number" && alternates > 0 ? { alternates } : {}),
      directions_type: "none",
    },
  };
}
