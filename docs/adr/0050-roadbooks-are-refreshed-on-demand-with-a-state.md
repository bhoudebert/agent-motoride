# 0050. Roadbooks are refreshed on demand, with a state for the phone

- Status: accepted
- Date: 2026-10-31

## Context

A roadbook file is a trace of the saved route on a Valhalla map, with Overpass land use and, optionally, Mapillary signs, made when the
phone asks. When the host rebuilds its own map (ADR 0049) or a roadbook changes, the file the phone holds is out of date, and the
version stamp is how the phone knows. A first design made the stamp change at once, so the phone offered an update that then waited for the
file to be traced, and a restart could make the stamp flap and offer every roadbook twice. Looking for outdated roadbooks on the
server would mean opening every rider's library (each is its own database, ADR 0027) whenever the map changes.

## Decision

The server keeps, per rider, the last file it made for each roadbook with its stamp and the map day it was made on (a folder of the rider's
library), and serves it at once. A roadbook's state is derived when the phone lists: `current`, `outdated` (the roadbook or the map
differ from the file's), `refreshing`, `failed`. The listed stamp is the ready file's, so it changes only when a new file exists. A new file
is made in the background, one at a time for the server, when the rider taps (`POST /roadbook/<id>/refresh`) or, from the list, for a
roadbook with a ride dated in the next 14 days. The server never goes through the libraries when the map changes. The map day is
kept in the data folder so a restart does not lose it.

## Consequences

The phone never waits on a download of an existing roadbook, can show "under refresh", and an app that ignores the state keeps
working. A rider who never opens the app costs nothing. After a rebuild a roadbook shows as outdated until the rider taps it (or its
ride is near), which is a tap per roadbook; refreshing everything ahead of time is left to a later option. Ready files take disk (about a
file per roadbook, in the rider's folder) and are deleted with their roadbook. One slow refresh at a time keeps the shared Valhalla,
Overpass and Mapillary from being hit all at once; the cells they share are cached across riders.

## Alternatives considered

Refreshing every library when the map changes: opens every database and traces every roadbook, for riders who may not be
riding. A stamp that changes with the map at once: the phone offers an update that is not ready. Keeping files only in memory: a
restart empties them and every roadbook becomes outdated with no file to offer.
