# 0019. Draw the ride map from the ride's own data, rendered with resvg

- Status: accepted
- Date: 2026-10-06

## Context

Riders want to see a ride as a whole on one picture: the loop, the towns,
where to stop, where the fixed cameras are and at what limit. The picture must
work in every mode: a file next to the GPX, the phone page, the Markdown
export, and in Claude Code or Codex, where a tool can return an image. Chat
clients and the Claude API accept PNG or JPEG, not SVG.

A map background from tile.openstreetmap.org was considered. Its usage policy
allows "normal interactive viewing by a human" and forbids bulk or pre-emptive
downloading and offline use; baking tiles into saved pictures, on a public
open-source project whose users would all do it, is at best a grey area.

## Decision

The map is drawn from data the ride already holds: the route line per leg, the
towns at the leg ends, the planned stops with their arrival times, the fixed
cameras with their posted limits, km marks, a scale bar, north, and the ride's
figures in a header, in the roadbook style of the site. No tiles, no network.
The picture is built as SVG in code and converted to PNG with
`@resvg/resvg-js`, with the site's fonts bundled under `assets/fonts` (SIL Open
Font License) and system fonts disabled, so it is the same on every machine.
Labels are placed where they cross the least route, markers and other labels.

## Consequences

Testable and deterministic; works offline; nothing to attribute beyond the
OpenStreetMap data the route comes from, which the picture credits. It is a
roadbook sketch, not a road map: no other roads or places are shown, and the
Google Maps links remain for the real map. One native dependency (resvg ships
prebuilt binaries); it was checked to load on NixOS before adoption.

## Alternatives considered

OpenStreetMap tiles: policy, above. A static-map provider with its own key
(MapTiler, Stadia, Geoapify): possible later as an option, like traffic with
TomTom. SVG only: no picture in chat clients. A pure-JavaScript rasteriser:
text rendering would have to be written by hand.
