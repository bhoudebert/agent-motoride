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

/** Forecast models asked in one request; the hourly figures are the cautious reading of them (ADR 0060). */
export const FORECAST_MODELS = ["meteofrance_seamless", "icon_seamless", "ecmwf_ifs025", "best_match"] as const;
/** Models whose temperature is used, in order of preference (AROME is the finest over France). */
const TEMPERATURE_MODELS = ["meteofrance_seamless", "best_match"];
/** A model is dry for an hour below this much rain, mm. */
export const DRY_HOUR_MM = 0.1;
/** Models disagree on rain when one is dry and another gives at least this much in the same hour, mm. */
export const RAIN_DISAGREE_MM = 1;
/** Models disagree on gusts when two differ by at least this much in the same hour, km/h. */
export const GUST_DISAGREE_KMH = 15;

const VARIABLES = [
  "temperature_2m",
  "precipitation_probability",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "weather_code",
] as const;
type Variable = (typeof VARIABLES)[number];
type Series = (number | null)[];

interface ForecastResponse {
  timezone: string;
  utc_offset_seconds: number;
  /** Several models: every key is suffixed with the model, `precipitation_icon_seamless`; one model: no suffix. */
  hourly: { time: string[] } & Record<string, Series | string[]>;
}

/** Hourly series of every model that has data for the place; a model with only empty values is left out. */
function seriesByModel(hourly: ForecastResponse["hourly"]): Array<{ model: string; get: (v: Variable) => Series }> {
  const read = (key: string) => hourly[key] as Series | undefined;
  const suffixed = FORECAST_MODELS.some((m) => read(`precipitation_${m}`));
  const models = suffixed
    ? FORECAST_MODELS.map((model) => ({ model: model as string, get: (v: Variable) => read(`${v}_${model}`) ?? [] }))
    : [{ model: "best_match", get: (v: Variable) => read(v) ?? [] }];
  return models.filter(({ get }) =>
    (["precipitation", "wind_gusts_10m"] as const).some((v) => get(v).some((x) => x !== null && x !== undefined)),
  );
}

const num = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const round1 = (x: number) => Number(x.toFixed(1));

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

export interface ModelReading {
  rainMm: number | null;
  gustKmh: number | null;
}

/** What makes the models disagree in one hour, or null. */
function hourDisagreement(hour: number, models: Record<string, ModelReading>): string | null {
  const rain = Object.entries(models).filter((e): e is [string, { rainMm: number; gustKmh: number | null }] =>
    num(e[1].rainMm),
  );
  const gust = Object.entries(models).filter((e): e is [string, { rainMm: number | null; gustKmh: number }] =>
    num(e[1].gustKmh),
  );
  const parts: string[] = [];
  if (rain.length > 1) {
    const dry = rain.reduce((a, b) => (b[1].rainMm < a[1].rainMm ? b : a));
    const wet = rain.reduce((a, b) => (b[1].rainMm > a[1].rainMm ? b : a));
    if (dry[1].rainMm < DRY_HOUR_MM && wet[1].rainMm >= RAIN_DISAGREE_MM)
      parts.push(`rain ${dry[1].rainMm}-${wet[1].rainMm} mm (${dry[0]} dry, ${wet[0]} ${wet[1].rainMm} mm)`);
  }
  if (gust.length > 1) {
    const low = gust.reduce((a, b) => (b[1].gustKmh < a[1].gustKmh ? b : a));
    const high = gust.reduce((a, b) => (b[1].gustKmh > a[1].gustKmh ? b : a));
    if (high[1].gustKmh - low[1].gustKmh >= GUST_DISAGREE_KMH)
      parts.push(`gusts ${Math.round(low[1].gustKmh)}-${Math.round(high[1].gustKmh)} km/h (${low[0]} to ${high[0]})`);
  }
  return parts.length ? `${String(hour).padStart(2, "0")}h ${parts.join(", ")}` : null;
}

/**
 * Hourly forecast for one place and day (Open-Meteo, up to ~16 days ahead), read from several models at once:
 * every figure is the cautious one (most rain, strongest gust), with the spread per model (ADR 0060).
 */
export async function getWeather(input: WeatherInput) {
  const fromHour = input.fromHour ?? 8;
  const toHour = input.toHour ?? 20;
  const point = await resolvePoint(input.location);

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set("hourly", VARIABLES.join(","));
  url.searchParams.set("models", FORECAST_MODELS.join(","));
  url.searchParams.set("start_date", input.date);
  url.searchParams.set("end_date", input.date);
  url.searchParams.set("timezone", "auto");
  const data = await fetchJson<ForecastResponse>(url.toString());

  const models = seriesByModel(data.hourly);
  if (models.length === 0) throw new Error(`No forecast model has data for ${point.label} on ${input.date}`);
  const hours = data.hourly.time
    .map((time, i) => {
      const at = (v: Variable) => models.map((m) => ({ model: m.model, value: m.get(v)[i] }));
      const values = (v: Variable) => at(v).flatMap((x) => (num(x.value) ? [x.value] : []));
      const rain = values("precipitation");
      const gusts = at("wind_gusts_10m").filter((x): x is { model: string; value: number } => num(x.value));
      const wind = values("wind_speed_10m");
      const probability = values("precipitation_probability");
      const codes = values("weather_code");
      const temps = at("temperature_2m");
      const temp =
        TEMPERATURE_MODELS.map((m) => temps.find((t) => t.model === m)?.value).find(num) ??
        temps.map((t) => t.value).find(num);
      const strongest = gusts.length ? gusts.reduce((a, b) => (b.value > a.value ? b : a)) : undefined;
      const direction = models.find((m) => m.model === strongest?.model)?.get("wind_direction_10m")[i];
      const spread: Record<string, ModelReading> = {};
      for (const m of models) {
        const r = m.get("precipitation")[i];
        const g = m.get("wind_gusts_10m")[i];
        spread[m.model] = { rainMm: num(r) ? r : null, gustKmh: num(g) ? g : null };
      }
      return {
        hour: Number(time.slice(11, 13)),
        tempC: temp ?? null,
        rainProbPct: probability.length ? Math.max(...probability) : null,
        rainMm: rain.length ? Math.max(...rain) : null,
        windKmh: wind.length ? Math.max(...wind) : null,
        gustKmh: strongest?.value ?? null,
        // Direction the wind blows from, degrees clockwise from north, of the model with the strongest gust.
        windFromDeg: num(direction) ? direction : null,
        sky: codes.length ? describeCode(Math.max(...codes)) : "unknown",
        models: spread,
      };
    })
    .filter((row) => row.hour >= fromHour && row.hour <= toHour)
    .flatMap(({ tempC, rainMm, windKmh, gustKmh, models: spread, ...row }) =>
      // An hour no model has figures for is left out rather than read as calm and dry.
      num(tempC) && num(rainMm) && num(windKmh) && num(gustKmh)
        ? [{ ...row, tempC, rainMm, windKmh, gustKmh, models: spread }]
        : [],
    );
  if (hours.length === 0) {
    throw new Error(`No forecast data for ${input.date} between ${fromHour}h and ${toHour}h`);
  }

  const maxRainProbPct = Math.max(...hours.map((r) => r.rainProbPct ?? 0));
  const totalRainMm = round1(hours.reduce((sum, r) => sum + r.rainMm, 0));
  const disagreements = hours.flatMap((h) => hourDisagreement(h.hour, h.models) ?? []);
  return {
    location: point.label,
    coords: { lat: point.lat, lon: point.lon },
    date: input.date,
    timezone: data.timezone,
    daylight: sunTimes(point.lat, point.lon, input.date, utcOffsetSecondsOn(data.timezone, input.date)),
    summary: {
      // Sum of the hourly highest rain: below 0.2 mm, every model is dry.
      dry: maxRainProbPct < 25 && totalRainMm < 0.2,
      maxRainProbPct,
      totalRainMm,
      minTempC: Math.min(...hours.map((r) => r.tempC)),
      maxTempC: Math.max(...hours.map((r) => r.tempC)),
      maxGustKmh: Math.max(...hours.map((r) => r.gustKmh)),
      modelsDisagree: disagreements.length > 0,
      disagreement: disagreements.length
        ? `Models disagree: ${disagreements.slice(0, 3).join("; ")}${disagreements.length > 3 ? `; ${disagreements.length - 3} more hours` : ""}. Figures are the most cautious model.`
        : null,
      models: models.map((m) => {
        const inWindow = hours.map((h) => h.models[m.model]!);
        const rain = inWindow.flatMap((x) => (num(x.rainMm) ? [x.rainMm] : []));
        const gust = inWindow.flatMap((x) => (num(x.gustKmh) ? [x.gustKmh] : []));
        return {
          model: m.model,
          totalRainMm: round1(rain.reduce((a, b) => a + b, 0)),
          maxGustKmh: gust.length ? Math.max(...gust) : null,
        };
      }),
    },
    hours,
  };
}
