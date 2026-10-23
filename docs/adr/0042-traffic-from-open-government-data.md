# 0042. Traffic from open government data

- Status: accepted
- Date: 2026-10-23

## Context

TomTom's terms (ADR 0041) forbid a cache shared between riders, limit an evaluation key to evaluation and exclude navigation functionality
without a written agreement; its price grows with every rider. HERE's quotas are no better. A rider mostly wants to know where the road ahead
is orange or red, not the exact speed. Governments publish measured speeds under open licences.

## Decision

The default traffic provider, `open-data`, reads public feeds and answers the same levels as any provider. For France it reads the speeds of the
stations of the national roads outside the motorway concessions (transport.data.gouv.fr, Licence Ouverte 2.0, refreshed every six minutes) and
their reference list (positions in Lambert-93, converted here). The feed has no free-flow speed, so the server learns each station's usual speed as the
90th percentile of the last 288 readings and says `unknown` until it has twelve. The feed is read at most every five minutes whatever the
number of riders: a rider costs nothing. A point is answered by the nearest measured section within 1.5 km (the phone's points are rounded
to about a kilometre); anything else is `unknown`. `/health` lists the countries covered, so the phone can say where traffic works.
Belgium (Flanders, CC-BY) follows as another source in the same provider.

## Consequences

Traffic is free and has no per-rider cost, and no rider's position leaves the server. It covers only measured roads: about 700 sections in France,
mostly main roads near cities, and no concession motorway. It starts blind for about an hour after a restart (the learning is in memory). Where
there is no feed the app shows no traffic, and says which countries are supported; another country is one more source.

## Alternatives considered

Learning from the riders' own speeds: no data until there are riders. A fixed speed per road class instead of learning: wrong on every road that
is slow for another reason. Traficolor (city traffic states): a tree of per-city files in several shapes, left for later.
