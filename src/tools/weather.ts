import { fetchJson } from "../http.ts";
import { resolvePoint } from "./geo.ts";

export interface WeatherInput {
  location: string;
  date: string; // YYYY-MM-DD
  fromHour?: number;
  toHour?: number;
}

interface ForecastResponse {
  timezone: string;
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
