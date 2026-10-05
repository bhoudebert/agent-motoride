# Notice

## Licence

agentRide is open source under the MIT licence (see `LICENSE`). It is provided
"as is", without warranty of any kind.

## Data and services

The planner reads public data and services at run time. They have their own
licences and terms, which apply to anything the planner outputs:

| Source                                                   | Used for                                                                       | Licence and attribution                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap, via Overpass API                          | Roads, curvature, speed limits, speed cameras, fuel stations, cafés, addresses | © OpenStreetMap contributors, Open Database License (ODbL). Derived outputs (itineraries, GPX, Markdown) carry this attribution |
| Valhalla, public instance by FOSSGIS e.V.                | Routing on the motorcycle profile, speed limits per segment                    | Routing engine under the MIT licence; the public instance has a fair-use policy for non-commercial use                          |
| Open-Meteo                                               | Forecasts, timezone, town geocoding                                            | CC BY 4.0: "Weather data by Open-Meteo.com"                                                                                     |
| Photon (komoot) and Nominatim (OpenStreetMap Foundation) | Addresses and reverse geocoding                                                | OpenStreetMap data, ODbL; public instances with usage policies                                                                  |
| TomTom Routing API (optional, your own key)              | Traffic at departure                                                           | TomTom developer terms apply to your key                                                                                        |
| Anthropic API (optional, your own key)                   | The built-in planner and the scouts                                            | Anthropic's terms apply to your key                                                                                             |

Please respect the usage policies of the public instances: the app serialises
and caches its requests for that reason. For heavy or commercial use, host your
own instances or use a commercial provider.

## Trademarks and affiliation

OpenStreetMap, Valhalla, Open-Meteo, Photon, komoot, Nominatim, TomTom,
Anthropic, Claude, Claude Code, OpenAI, ChatGPT, Codex, Google Maps, Waze,
Liberty Rider, Kurviger, Calimoto, OsmAnd, Garmin, GitHub and Telegram are
trademarks or trade names of their respective owners. They are mentioned to
describe compatibility and data sources. This project is independent: it is not
affiliated with, endorsed by, or sponsored by any of them.

## Safety

agentRide is a planning aid, not a navigation system and not a source of
truth about the road. Riding times are estimates; speed limits, cameras, stops,
opening hours and forecasts come from public data that can be wrong, outdated
or incomplete, and conditions change. Always obey the road signs and the law,
check conditions before and during the ride, and use a proper navigation app
on the road. The rider is responsible for the ride. In some countries the use
or display of speed-camera positions is regulated; the app reports fixed
cameras mapped in OpenStreetMap as information only, and it is the rider's
responsibility to comply with local law.
