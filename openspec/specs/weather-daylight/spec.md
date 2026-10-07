# Weather, Daylight and Traffic Specification

## Purpose

Give the planner and the rider the forecast for the hours and places of the
ride, the daylight frame of the day, and the traffic delay at departure.

## Requirements

### Requirement: Hourly forecast

`getWeather` SHALL return, for a place and a day up to 16 days ahead, hourly temperature, rain probability and amount, wind, gusts and sky for a chosen hour window, with a summary and a `dry` flag, plus the day's daylight.

### Requirement: Daylight for any date

`getDaylight` SHALL compute sunrise, sunset, first and last usable light and daylight hours for any date, localised with the timezone's offset on that date (summer and winter time).

#### Scenario: December ride

- **WHEN** the date is 21 December in northern France
- **THEN** sunrise and sunset are given in winter time

### Requirement: Weather on planned rides

On save and refresh, when the ride date is within forecast range, the forecast SHALL be stored at four points of the route for the hours the rider would be there, stamped with its time; beyond range the previous forecast SHALL be kept and the view SHALL say so.

### Requirement: Traffic

`getTraffic` SHALL return travel time, free-flow time and delay for a departure time when `TOMTOM_API_KEY` is set. The delay SHALL be the expected travel time minus the free-flow time (predicted congestion for that departure, incidents included), with the share due to reported incidents given apart; and SHALL otherwise report that no source is configured so the planner says "not checked" rather than guessing. Traffic SHALL be a final check on the chosen loop, not a selection criterion.

#### Scenario: Rush hour without incidents

- **WHEN** a Monday 07:30 departure is expected to take 106 minutes against 83 without traffic, with no incident reported
- **THEN** the delay is 23 minutes and the incident delay 0

### Requirement: Crosswind and low sun along the route

For a routed trip, a date and a departure time, the system SHALL sample the route every few kilometres with its heading and estimated time of passage and report:

- crosswind: the gust component across the direction of travel, from the forecast wind speed, gusts and direction at the nearest forecast point and hour; stretches at 35 km/h or more are flagged, at 50 km/h or more as strong;
- low sun: stretches where the sun is between 0 and 15 degrees above the horizon and within 30 degrees of the direction of travel at the time of passage.

Results SHALL appear in the ride-day briefing and on planned rides when the date is within forecast range; glare SHALL be computed for any date.

#### Scenario: Low sun ahead on the way home

- **WHEN** the last leg heads west at 18:40 in October
- **THEN** the stretch is reported with its time and the sun's elevation
