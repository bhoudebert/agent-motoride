# Limits and troubleshooting

agentMotoride is a planning aid, not a navigation system: riding times are
estimates, public data can be wrong or out of date, and you are responsible for
the ride and for the local rules, including on speed-camera information.

## Limits

- The public Overpass and Valhalla servers are shared, rate-limited community
  services. Fine for personal use, not for heavy or commercial traffic.
- Forecasts change. A ride judged dry on Thursday should be rechecked on the day.
- Road data comes from OpenStreetMap and can be incomplete or out of date.
  Closures and roadworks are not checked.
- A saved ride keeps the result, not the conversation: `--ride` starts a new
  conversation from the stored ride.
- Duplicate detection compares road footprints. The way out of and back into
  your home town is shared by most rides and counts toward the overlap.
- The built-in SQLite module of Node is recent; the file format is standard
  SQLite and readable by any SQLite tool.
- Output is text, navigation links, a GPX file, a Markdown document and a
  phone page on request. Nothing can be sent to Waze.
- Stop timing uses fixed breaks (10 min fuel, 15 min pause, 45 min lunch) and
  ignores traffic.
- Claude is the only provider. OpenAI is not implemented.
- Unit tests cover the deterministic parts and the planner loop against fake
  services; the model's actual behaviour is only checked by real runs.

## When something goes wrong

| Symptom                                                   | Cause and fix                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `No Claude credentials...`                                | `.env` missing or `ANTHROPIC_API_KEY` empty                                                                                                                                                                                                                  |
| `Claude API rejected the credentials`                     | Key invalid or revoked                                                                                                                                                                                                                                       |
| `Claude API rate limit hit`                               | Wait a minute, or lower `RIDE_EFFORT`                                                                                                                                                                                                                        |
| `No start point...`                                       | Pass `--from` or set `RIDE_HOME`                                                                                                                                                                                                                             |
| Agent says "traffic not checked"                          | Expected without `TOMTOM_API_KEY`. Add the key to `.env` to enable traffic                                                                                                                                                                                   |
| Agent says the road search failed on a first try          | Public Overpass servers are shared and sometimes overloaded. The tool retries five times across three public instances (main, OSM France, the main service's second entry point), which can take up to a minute, and the model retries too. Usually harmless |
| `searchRoads` fails with "unavailable right now"          | All Overpass attempts failed. Retry later                                                                                                                                                                                                                    |
| Speed-limit share reported as unverified                  | The Valhalla speed lookup failed for that route. Distance and time are still valid                                                                                                                                                                           |
| Cameras or stops "last lookup failed" in a ride view      | The OpenStreetMap query service was unavailable; the previous result is kept. `npm run rides -- refresh <id>` retries                                                                                                                                        |
| Camera or stop lookups take minutes                       | The public query service is shared and often slow. Routes are queried in chunks and dense ones are split; results are cached 30 days per route                                                                                                               |
| Connection refused by overpass-api.de                     | The main instance blocks an address temporarily after heavy use; the app falls back on the OSM France instance. It lifts by itself                                                                                                                           |
| HTTP 403 "only available to white-listed usages"          | That instance filters by User-Agent; the app sends a contact-style one (`src/http.ts`). Keep that format if you change it                                                                                                                                    |
| Claude Code still shows old behaviour after a code change | The server process is the old one; quit and relaunch Claude Code, then check `npm run rides -- runs` for a new row                                                                                                                                           |
| A stop is "route point 22 of 40" in Liberty Rider         | Stages are unnamed there; the ride view gives the stop's name, road and village, and its km mark                                                                                                                                                             |
| `Place not found`                                         | None of the three geocoders knows the text. Check spelling, write it as `"street, town"`, or use `"lat,lon"`                                                                                                                                                 |
| `Stopped after 40 tool rounds`                            | The model did not converge. Loosen the constraints or rerun                                                                                                                                                                                                  |
| `.env not found. Continuing without it.`                  | Informational only, printed by Node when no `.env` exists                                                                                                                                                                                                    |

Run `npm run smoke` to tell a data-service problem from a Claude API problem.
