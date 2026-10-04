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

### Requirement: Weather on saved rides

On save and refresh, when the ride date is within forecast range, the forecast SHALL be stored at four points of the route for the hours the rider would be there, stamped with its time; beyond range the previous forecast SHALL be kept and the view SHALL say so.

### Requirement: Traffic

`getTraffic` SHALL return travel time, free-flow time and delay for a departure time when `TOMTOM_API_KEY` is set, and SHALL otherwise report that no source is configured so the planner says "not checked" rather than guessing. Traffic SHALL be a final check on the chosen loop, not a selection criterion.
