# Notes and review

Rating a whole ride is too coarse to say "the D 40 after Maroilles was the best
part" or "never again on those cobbles", and nobody remembers the details by
the evening. So the app takes notes while you ride, places them on the road
afterwards, and turns them into ratings the next plans follow.

## During the ride

At a stop, say it in a few words. A note covers the ten minutes before it, or
as many as you say, and goes to the ride dated today.

::: code-group

```bash [Terminal]
npm run rides -- note "last 10 min awesome"
npm run rides -- note "cobbles, never again" --back 5
npm run rides -- note "nice bends" --rating 4 --roadbook 7

# in a refine> session: /note last 10 min awesome
```

```text [Claude Code / Codex]
last 10 minutes awesome
cobbles, never again

(plain words are enough)
```

:::

From the phone, with the session running at home, this is a few words in the
Claude or ChatGPT app: see [From your phone](/from-your-phone).

## After the ride

Export the track from whatever recorded it (Liberty Rider, Strava, a Garmin,
OsmAnd: any GPX with times), then review:

::: code-group

```bash [Terminal]
npm run rides -- review 7 ~/Downloads/track.gpx
```

```text [Claude Code / Codex]
review my ride with ~/Downloads/track.gpx
```

:::

```text
Review of roadbook #7 "Avesnois loop"
Ridden: 171.2 km, 2 h 51 moving, 60 km/h on average.
Planned: 167.6 km, 2 h 55, 57 km/h.
Detours from the plan (2 km or more):
  10:12-10:24  D 962, Maroilles to Le Favril, 6.1 km
Notes:
  #2  09:30-09:40  "last 10 min awesome"
      D 40, Marly to Sommaing, 10 km: proposed rating 5
```

Each note lands on the stretch you actually rode in its time window, so a
detour you took on a whim is the one rated, not the planned road you skipped.
That day's ride is marked ridden and keeps the track's path; if you changed
the roadbook since, your notes still land on the route you rode that day.

## Confirm the ratings

::: code-group

```text [Terminal]
#2 "last 10 min awesome" [5]:        Enter keeps 5, a digit changes it
#3 "cobbles, never again" [0]:       d dismisses the note, s skips it for now

(--yes accepts every proposal)
```

```text [Claude Code / Codex]
Claude Code shows one form: a rating per note, the proposal filled in,
and a box to dismiss each one. Submit to store, close to keep them pending.

(other clients ask you in the chat)
```

:::

Proposals come from your words: "never again" is 0, "awesome" is 5. A rating
you said yourself always wins.

## What it changes

Every confirmed note becomes a rated stretch of road. From then on, every plan
reports how much of a candidate runs on roads you rated: **0 or 1** are
avoided, and a loop with 10% or more on them is only offered when nothing else
fits; **4 or 5** are sought out as building blocks.

::: tip No track?
`review 7` without a file places the notes on the planned route by the time
since departure, marked approximate. Notes waiting for review are announced
when the app opens, so nothing has to be remembered.
:::
