# Open source, and how to help

agentMotoride is open source under the MIT licence, built on open data, and
developed in the open. You can read every line, run it on your own machine,
change it, and send improvements back.

## On open data

| What                                             | From                            | Run by                                                                                                  |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Roads, speed limits, bends, cameras, fuel, cafés | OpenStreetMap, through Overpass | the OpenStreetMap community                                                                             |
| Routing and the speed profile of a route         | Valhalla                        | an open-source project, public instance by FOSSGIS e.V.                                                 |
| Forecasts, daylight, place names                 | Open-Meteo                      | an open-source project                                                                                  |
| Addresses                                        | Photon, Nominatim               | open-source projects on OpenStreetMap data, public instances by komoot and the OpenStreetMap Foundation |
| Traffic (optional)                               | TomTom                          | a commercial API, only with your key                                                                    |

Their licences and the attribution they ask for are in
[NOTICE.md](https://github.com/bhoudebert/agent-motoride/blob/main/NOTICE.md).
When a plan is wrong because the data is (a limit not mapped, a camera
missing, opening hours out of date), the best fix is in
[OpenStreetMap](https://www.openstreetmap.org): it improves every plan, and
every other app built on it.

## Yours to run

Everything runs on your machine. Your roadbooks, rides, notes and ratings are
one SQLite file in `data/`, which never leaves it. The app sends no
telemetry: it calls the data services above, the model you chose, TomTom if
you add a key, and an OpenTelemetry tool only if you point it at one.

## Built in the open

- **Requirements** for every capability in `openspec/specs/`, written before
  the code.
- **Decisions** and the alternatives that lost, in `docs/adr/`.
- **Evals**: rider requests graded by code, recorded once and replayed for
  free, so anyone can check a change did not make the agent worse.
- **Every change** is a public pull request saying what was verified and what
  was not.

## How to help

The most useful contributions are small and need no API key:

| Contribution                                      | Where                                              | How                                                               |
| ------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Your country's legal speed default, or a region's | `src/tools/trip.ts` (`RURAL_DEFAULT_KMH`)          | a pull request with its source, or a "Country rules" issue        |
| A fix in the map data                             | [openstreetmap.org](https://www.openstreetmap.org) | edit it there                                                     |
| A request the agent gets wrong                    | `evals/cases.ts`                                   | an "Eval case" issue; the maintainer records it                   |
| A bug                                             | an issue                                           | with the run id and trace (`npm run rides -- runs`, `trace <id>`) |
| Another traffic source, a map background          | `src/tools/`                                       | see the roadmap first                                             |

How to set up, the commit rules and the pull request template are in
[CONTRIBUTING.md](https://github.com/bhoudebert/agent-motoride/blob/main/CONTRIBUTING.md).
