import { fetchJson } from "../http.ts";
import { resolvePoint } from "./geo.ts";

export interface DaylightInput {
  location: string;
  date: string; // YYYY-MM-DD
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Sunrise, sunset and civil twilight for any date (NOAA solar equations,
 * accurate to a couple of minutes). `utcOffsetSeconds` localises the result.
 */
export function sunTimes(lat: number, lon: number, date: string, utcOffsetSeconds: number) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  // Equation of time and declination (NOAA, fractional year in radians).
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (12 - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const hourAngle = (zenithDeg: number) => {
    const cosH =
      Math.cos(toRad(zenithDeg)) / (Math.cos(toRad(lat)) * Math.cos(decl)) - Math.tan(toRad(lat)) * Math.tan(decl);
    if (cosH > 1 || cosH < -1) return null; // polar day or night
    return toDeg(Math.acos(cosH));
  };
  const minutesUtc = (ha: number, rise: boolean) => 720 - 4 * (lon + (rise ? ha : -ha)) - eqTime;
  const local = (minutes: number) => {
    const total = Math.round((((minutes + utcOffsetSeconds / 60) % 1440) + 1440) % 1440);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const sun = hourAngle(90.833); // sun's upper limb at the horizon, with refraction
  const civil = hourAngle(96); // civil twilight: enough light to ride without lights
  if (sun === null) return null;
  const daylightMinutes = 2 * 4 * sun;
  return {
    sunrise: local(minutesUtc(sun, true)),
    sunset: local(minutesUtc(sun, false)),
    firstLight: civil === null ? null : local(minutesUtc(civil, true)),
    lastLight: civil === null ? null : local(minutesUtc(civil, false)),
    daylightHours: Number((daylightMinutes / 60).toFixed(1)),
  };
}

interface TimezoneResponse {
  timezone: string;
  utc_offset_seconds: number;
}

/** UTC offset of a named timezone on a given day, so winter and summer time both come out right. */
export function utcOffsetSecondsOn(timezone: string, date: string): number {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    day: "numeric",
  }).formatToParts(noonUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const dayShift = get("day") - noonUtc.getUTCDate();
  return (
    ((dayShift === 0 ? 0 : dayShift > 0 || dayShift < -1 ? 24 : -24) + get("hour") - 12) * 3600 + get("minute") * 60
  );
}

/** Daylight for a place and day, any date; the timezone comes from Open-Meteo. */
export async function getDaylight(input: DaylightInput) {
  const point = await resolvePoint(input.location);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  const tz = await fetchJson<TimezoneResponse>(url.toString());
  const times = sunTimes(point.lat, point.lon, input.date, utcOffsetSecondsOn(tz.timezone, input.date));
  return {
    location: point.label,
    date: input.date,
    timezone: tz.timezone,
    ...(times ?? { sunrise: null, sunset: null, firstLight: null, lastLight: null, daylightHours: 0 }),
    note: "Plan to be back before sunset; lastLight is the latest the rider can still see the road without relying on headlights.",
  };
}

export interface WeatherInput {
  location: string;
  date: string; // YYYY-MM-DD
  fromHour?: number;
  toHour?: number;
}

interface ForecastResponse {
  timezone: string;
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    weather_code: number[];
  };
}

// WMO weather interpretation codes (subset grouping used by Open-Meteo).
function describeCode(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

/** Hourly forecast for one place and day (Open-Meteo, up to ~16 days ahead). */
export async function getWeather(input: WeatherInput) {
  const fromHour = input.fromHour ?? 8;
  const toHour = input.toHour ?? 20;
  const point = await resolvePoint(input.location);

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code",
  );
  url.searchParams.set("start_date", input.date);
  url.searchParams.set("end_date", input.date);
  url.searchParams.set("timezone", "auto");
  const data = await fetchJson<ForecastResponse>(url.toString());

  const h = data.hourly;
  const hours = h.time
    .map((time, i) => ({
      hour: Number(time.slice(11, 13)),
      tempC: h.temperature_2m[i]!,
      rainProbPct: h.precipitation_probability[i] ?? null,
      rainMm: h.precipitation[i]!,
      windKmh: h.wind_speed_10m[i]!,
      gustKmh: h.wind_gusts_10m[i]!,
      sky: describeCode(h.weather_code[i]!),
    }))
    .filter((row) => row.hour >= fromHour && row.hour <= toHour);
  if (hours.length === 0) {
    throw new Error(`No forecast data for ${input.date} between ${fromHour}h and ${toHour}h`);
  }

  const maxRainProbPct = Math.max(...hours.map((r) => r.rainProbPct ?? 0));
  const totalRainMm = Number(hours.reduce((sum, r) => sum + r.rainMm, 0).toFixed(1));
  return {
    location: point.label,
    coords: { lat: point.lat, lon: point.lon },
    date: input.date,
    timezone: data.timezone,
    daylight: sunTimes(point.lat, point.lon, input.date, utcOffsetSecondsOn(data.timezone, input.date)),
    summary: {
      dry: maxRainProbPct < 25 && totalRainMm < 0.2,
      maxRainProbPct,
      totalRainMm,
      minTempC: Math.min(...hours.map((r) => r.tempC)),
      maxTempC: Math.max(...hours.map((r) => r.tempC)),
      maxGustKmh: Math.max(...hours.map((r) => r.gustKmh)),
    },
    hours,
  };
}
