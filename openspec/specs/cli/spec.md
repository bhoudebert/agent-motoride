# CLI Specification

## Purpose
Plan, refine, save, view and export rides from the terminal, with the current
settings always visible and no accidental exit.

## Requirements

### Requirement: Entry points
`npm run ride` with no arguments SHALL open a menu (plan a new ride, open a saved ride, quit); with a request SHALL plan directly; `--ride <id>` without a request SHALL open the prompt on that ride; `--show <id>` SHALL display a ride without any model call.

### Requirement: Refine prompt
After an itinerary the prompt SHALL stay open for changes and questions, SHALL show the motorway state in its text, and SHALL accept commands: `/save`, `/list`, `/show`, `/rate`, `/gpx`, `/md`, `/qr`, `/share`, `/motorways on|off`, `/bike`, `/settings`, `/usage`, `/trace`, `/back`, `/quit`, `/help`. An empty line SHALL do nothing; Ctrl-D SHALL step back one level; leaving with an unsaved itinerary SHALL ask once.

#### Scenario: Back to the menu
- **WHEN** the rider types `/back` from a ride opened through the menu
- **THEN** the menu reappears and another ride can be opened

### Requirement: Settings visibility
Session start SHALL print start point, motorway state, slow-zone targets, traffic availability, model and effort, and the bike profile.

### Requirement: Library command
`npm run rides` SHALL provide list, show, export, export-md, qr, share, rate, rate-leg, refresh (with `--stops`), bike, trace, runs, delete, clear-cache.

### Requirement: Safety
Tests and scripted runs SHALL never reach the real model API with the rider's key; the CLI SHALL warn on an unknown model id and SHALL print the run id of every session for later replay.
