# Stops and your bike

Stops are chosen, not just listed: from a small profile of your bike and your
rhythm, the planner places a fuel stop before the tank runs low, a pause when
you would want one, and lunch when the ride crosses midday.

## Your bike profile

::: code-group

```bash [Terminal]
npm run rides -- bike                                   # show
npm run rides -- bike range=250 reserve=40 pause=75 stint=90 lunch=yes

# at the refine> prompt: /bike range=300
```

```text [Claude Code / Codex]
my bike does 300 km on a tank
pause every hour and a half, no lunch stop
```

:::

| Setting   | Default | Used for                                                             |
| --------- | ------- | -------------------------------------------------------------------- |
| `range`   | 250 km  | Realistic range on a full tank                                       |
| `reserve` | 40 km   | Fuel before range minus reserve, so the tank never runs into reserve |
| `pause`   | 75 min  | A café or bakery stop after this much riding since the last stop     |
| `stint`   | 90 min  | A warning when no stop can be placed within this stretch             |
| `lunch`   | yes     | A restaurant where the ride crosses 12:30, when it spans midday      |

"I leave with half a tank" in your request moves the first fuel stop.

## What you get

Each stop has a kind, a name, a km mark, an arrival time and a reason, plus the
return time with breaks and warnings: no fuel in reach, a long stint, no
restaurant near midday. Places open at your arrival time are preferred, from
the opening hours in OpenStreetMap; hours that cannot be read count as "not
known", never as open.

On the bike, the stops are already in your phone: the navigation links carry
them as waypoints, so they are announced in turn, and the GPX holds them as
named waypoints with their times.

## Good to know

- After changing the profile, rebuild the stop plan of a roadbook with
  `npm run rides -- refresh 3 --stops` (instant once the stops are cached).
- Stop timing uses fixed breaks: 10 minutes for fuel, 15 for a pause, 45 for
  lunch.
- On the morning of the ride, the [briefing](/phone-and-gps#the-morning-of-the-ride)
  checks every stop against its opening hours again.
