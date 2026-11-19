# 0060. Read the weather as the cautious reading of several models

- Status: accepted
- Date: 2026-11-19

## Context

`getWeather` asked Open-Meteo for its default `best_match` blend: one number per hour, with no sign of how sure it is. The
models it blends disagree a lot in northern France. For Pont-à-Marcq on 20 November 2026 at 9h, `best_match` gave 2.9 mm of
rain, `meteofrance_seamless` 0, `icon_seamless` 2.0, `ecmwf_ifs025` 0.3, `ukmo_seamless` 0.2; the gusts at 8h were 29, 38, 11,
35 and 17 km/h. A rider told "dry" or "gusts 29" by one blend can meet rain or a 38 km/h gust that another model saw.
`precipitation_probability` is ensemble-based (the same in `best_match` and `ecmwf_ifs025`) and absent for
`meteofrance_seamless`; AROME (`meteofrance_seamless`) covers France and its borders only.

## Decision

`getWeather` asks, in one request, for `meteofrance_seamless`, `icon_seamless`, `ecmwf_ifs025` and `best_match` (one constant).
Every hour is read cautiously: the highest rain, gust and wind of the models, the highest probability any model gives, the
most severe sky, the wind direction of the model with the strongest gust, and the temperature of AROME, else `best_match`. Each
hour keeps the spread (rain and gust per model). A model with no value for the place is ignored, not read as zero. The models
disagree when, in one hour, one is dry (under 0.1 mm) and another gives 1 mm or more, or two gusts differ by 15 km/h or more;
the summary says so in one line, the briefing lists it as a caution. Crosswind, the `dry` flag and the go or no-go use the
cautious figures.

## Consequences

The forecast is wetter and windier than before on days when the models diverge, by design: a rider prefers a false alarm to
a soaking or a gust across a bridge. The planner and the briefing can say how sure the forecast is. A response is about four
times larger, still one request per point, cached as before. Callers keep the same fields; the spread and the disagreement are
additions.

## Alternatives considered

The mean or the median of the models: hides the wet model that matters. Keeping `best_match` and showing the others beside it:
the figures that decide (dry, crosswind, verdict) would still ignore them. One request per model: four times the calls on a
shared free service. Adding `ukmo_seamless`: it added little over the others in the cases looked at, and the list is one
constant to change.
