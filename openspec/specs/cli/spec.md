# CLI Specification

## Purpose

Plan, refine, save, view and export rides from the terminal, with the current
settings always visible and no accidental exit.

## Requirements

### Requirement: Entry points

`npm run ride` with no arguments SHALL open a menu (plan a new ride, open a roadbook from a list of 20 per page, newest first, `n` and `p` turning the pages, quit); with a request SHALL plan directly; `--roadbook <id>` (also `--ride`) without a request SHALL open the prompt on that ride; `--show <id>` SHALL display a ride without any model call.

#### Scenario: Turning the pages of roadbooks

- **WHEN** the rider runs `npm run ride`, picks "Open a roadbook" and the library holds 45 roadbooks
- **THEN** the 20 newest are listed, `n` shows the next 20 and `p` the previous ones

#### Scenario: Show only

- **WHEN** the rider runs `npm run ride -- --show 7`
- **THEN** roadbook 7 is displayed and the program exits without any model call

### Requirement: Refine prompt

After an itinerary the prompt SHALL stay open for changes and questions, SHALL show the motorway state in its text, and SHALL accept commands: `/save`, `/roadbooks`, `/rides`, `/plan`, `/show`, `/rate`, `/gpx`, `/md`, `/qr`, `/share`, `/motorways on|off`, `/bike`, `/settings`, `/usage`, `/trace`, `/back`, `/quit`, `/help`. An empty line SHALL do nothing; Ctrl-D SHALL step back one level; leaving with an unsaved itinerary SHALL ask once.

#### Scenario: Back to the menu

- **WHEN** the rider types `/back` from a ride opened through the menu
- **THEN** the menu reappears and another ride can be opened

### Requirement: Settings visibility

Session start SHALL print start point, motorway state, slow-zone targets, the fast-expressway ceiling, traffic availability, model and effort, and the bike profile.

#### Scenario: Default settings from Lille

- **WHEN** a session starts from Lille with the default settings
- **THEN** it prints "Start: Lille | motorways: FORBIDDEN | 30 zones: aim <= 3% | long straights: aim <= 15% | 50 zones: aim <= 20% | fast expressway: <= 25%", the traffic check state, "model: claude-opus-5-5, effort high"
- **AND** a line "Bike:" with the tank range and the fuel deadline

### Requirement: Library command

`npm run rides` SHALL provide help (everything, by moment, from the catalogue), roadbooks and rides, each with `--page N` (`list` only points to these two), plan, delete (roadbook or ride, confirmed), cancel, versions, restore, copy, rate-day, rate-stretch, rated, unrate-stretch, today with a day, tidy, show, export, export-md, qr, share, rate, rate-leg, refresh (with `--stops`), bike, trace, runs, delete, clear-cache.

#### Scenario: The old list command

- **WHEN** the rider runs `npm run rides -- list`
- **THEN** it lists nothing and points to `npm run rides -- roadbooks` and `npm run rides -- rides`

### Requirement: Safety

Tests and scripted runs SHALL never reach the real model API with the rider's key; the CLI SHALL warn on an unknown model id and SHALL print the run id of every session for later replay.

#### Scenario: Misspelt model

- **WHEN** `RIDE_MODEL` is set to a model id the app has no price for
- **THEN** the session warns that it is not a model this app knows and names the known ones
- **AND** each turn prints "(run #N; replay later with: npm run rides -- trace N)"
