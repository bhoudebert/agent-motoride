# Weather, Daylight and Traffic Specification

## Purpose

Give the planner and the rider the forecast for the hours and places of the
ride, the daylight frame of the day, and the traffic delay at departure.

## Requirements

### Requirement: Hourly forecast

`getWeather` SHALL return, for a place and a day up to 16 days ahead, hourly temperature, rain probability and amount, wind, gusts and sky for a chosen hour window, with a summary and a `dry` flag, plus the day's daylight. The figures SHALL be the cautious reading of several forecast models (see "Several forecast models, the cautious reading").

#### Scenario: Morning in Lille

- **WHEN** the forecast is asked for Lille on 10 October from 9 to 12
- **THEN** four hours come back, the summary says dry with the strongest gust, and the day's sunrise and sunset are attached

### Requirement: Several forecast models, the cautious reading

`getWeather` SHALL ask Open-Meteo, in one request, for the models `meteofrance_seamless`, `icon_seamless`, `ecmwf_ifs025` and `best_match` (one list in the code), and SHALL read them cautiously, hour by hour:

- `rainMm`, `gustKmh` and `windKmh` SHALL be the highest value of the models; `rainProbPct` the highest value a model gives (a model with no probability, such as `meteofrance_seamless`, is skipped); the sky SHALL be the most severe weather code of the models; the wind direction SHALL be that of the model with the strongest gust;
- `tempC` SHALL come from `meteofrance_seamless`, else `best_match`, else any model with a value;
- each hour SHALL carry a compact spread, the rain in mm and the gust in km/h of every model, and the summary the total rain and the strongest gust of every model;
- a model that returns no value at all for the place (AROME outside its domain) SHALL be ignored, never read as zero;
- the summary's `dry` SHALL be true only when the cautious figures are dry: the highest rain probability below 25% and the sum of the hourly highest rain below 0.2 mm, so that every model is dry over the hours asked;
- the models SHALL be said to disagree (`modelsDisagree`, and a one-line `disagreement` naming the hour, the range and the models) when, in the same hour, one model gives less than 0.1 mm of rain and another 1 mm or more, or the gusts of two models differ by 15 km/h or more. The thresholds are constants in the code.

#### Scenario: One model dry, another wet

- **WHEN** at 9h `meteofrance_seamless` gives 0 mm, `icon_seamless` 2 mm and `best_match` 2.9 mm
- **THEN** the hour's rain is 2.9 mm, the spread lists each model's rain, the day is not dry, and the summary says the models disagree on rain at 9h

#### Scenario: Gusts far apart

- **WHEN** at 8h the models give gusts of 29, 38, 11 and 35 km/h and agree on rain
- **THEN** the hour's gust is 38 km/h and the models are said to disagree on gusts at 8h

#### Scenario: AROME outside its domain

- **WHEN** `meteofrance_seamless` returns only empty values for the place
- **THEN** it is left out of the reading and the spread, and the other models give the figures

#### Scenario: Models agree

- **WHEN** every model gives no rain and gusts within 15 km/h of each other
- **THEN** the day is dry and `modelsDisagree` is false

### Requirement: Daylight for any date

`getDaylight` SHALL compute sunrise, sunset, first and last usable light and daylight hours for any date, localised with the timezone's offset on that date (summer and winter time).

#### Scenario: December ride

- **WHEN** the date is 21 December in northern France
- **THEN** sunrise and sunset are given in winter time

### Requirement: Weather on planned rides

On save and refresh, when the ride date is within forecast range, the forecast SHALL be stored at four points of the route for the hours the rider would be there, stamped with its time. Beyond the 16-day range no forecast SHALL be stored (a previous one is dropped) and the view SHALL say "Weather: no forecast stored (date beyond the 16-day range at the last refresh)". When the lookup fails, the previous forecast SHALL be kept and the failure shown.

#### Scenario: Ride next week

- **WHEN** a ride dated within the 16-day range is saved or refreshed
- **THEN** the forecast is stored for the start, one third, two thirds and the finish of the route, each for the hours the rider would be there, and the view says when it was gathered and how many hours ago

#### Scenario: Ride beyond the forecast range

- **WHEN** a ride dated three weeks ahead is refreshed
- **THEN** no forecast is stored, any earlier one is dropped, and the view says "Weather: no forecast stored (date beyond the 16-day range at the last refresh)"

#### Scenario: Forecast lookup fails

- **WHEN** a ride within range is refreshed and the weather lookup fails
- **THEN** the forecast gathered last time is kept, and the view says the last lookup failed, showing the previous result

### Requirement: Traffic

`getTraffic` SHALL return travel time, free-flow time and delay for a departure time when `TOMTOM_API_KEY` is set. The delay SHALL be the expected travel time minus the free-flow time (predicted congestion for that departure, incidents included), with the share due to reported incidents given apart; and SHALL otherwise report that no source is configured so the planner says "not checked" rather than guessing. Traffic SHALL be a final check on the chosen loop, not a selection criterion.

#### Scenario: Rush hour without incidents

- **WHEN** a Monday 07:30 departure is expected to take 106 minutes against 83 without traffic, with no incident reported
- **THEN** the delay is 23 minutes and the incident delay 0

### Requirement: Crosswind and low sun along the route

For a routed trip, a date and a departure time, the system SHALL sample the route every few kilometres with its heading and estimated time of passage and report:

- crosswind: the gust component across the direction of travel, from the forecast gusts and direction at the nearest forecast point and hour, the gust being the strongest of the forecast models (with that model's direction); stretches at 35 km/h or more are flagged, at 50 km/h or more as strong;
- low sun: stretches where the sun is between 0 and 15 degrees above the horizon and within 30 degrees of the direction of travel at the time of passage.

Results SHALL appear in the ride-day briefing and on planned rides when the date is within forecast range; glare SHALL be computed for any date.

#### Scenario: Low sun ahead on the way home

- **WHEN** the last leg heads west at 18:40 in October
- **THEN** the stretch is reported with its time and the sun's elevation

#### Scenario: One model forecasts stronger gusts

- **WHEN** at the hour of passage one model gives gusts of 38 km/h from the west and the others 11 to 29 km/h, on a stretch heading north
- **THEN** the crosswind is computed from the 38 km/h gust and the stretch is flagged
