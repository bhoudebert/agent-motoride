# Changelog

## [1.4.0](https://github.com/bhoudebert/agent-motoride/compare/v1.3.0...v1.4.0) (2026-10-06)


### Features

* **mcp:** scout with the client's parallel subagents when API scouts are off ([#48](https://github.com/bhoudebert/agent-motoride/issues/48)) ([3b15365](https://github.com/bhoudebert/agent-motoride/commit/3b153655523b5cee44f381733b090344e57f60f4))
* **memory:** recall what past sessions learnt before scouting a region ([#46](https://github.com/bhoudebert/agent-motoride/issues/46)) ([4457cd4](https://github.com/bhoudebert/agent-motoride/commit/4457cd495f77cbe6643bfcede9b7bd7f2b4344f2))


### Bug Fixes

* **scouts:** start the loops from the place the request names, not always from home ([#49](https://github.com/bhoudebert/agent-motoride/issues/49)) ([e57dc04](https://github.com/bhoudebert/agent-motoride/commit/e57dc0480ef85bbfc8189ab84d77601137e74832))

## [1.3.0](https://github.com/bhoudebert/agent-motoride/compare/v1.2.0...v1.3.0) (2026-10-06)


### Features

* **export:** a map picture of a saved ride, with its stops and cameras ([#44](https://github.com/bhoudebert/agent-motoride/issues/44)) ([215d9bf](https://github.com/bhoudebert/agent-motoride/commit/215d9bfb67fc64aa2cf562deddc80378d24b461d))
* **mcp:** all four hints on every tool, every tool tested by name, a maintained QR library ([#41](https://github.com/bhoudebert/agent-motoride/issues/41)) ([c88808b](https://github.com/bhoudebert/agent-motoride/commit/c88808b423b042d665551329b41eb4169d223fbf))
* **mcp:** rate a saved ride or one of its legs from Claude Code or Codex ([#43](https://github.com/bhoudebert/agent-motoride/issues/43)) ([0174a17](https://github.com/bhoudebert/agent-motoride/commit/0174a17918f8b3e7afba19a6076b13512417ae75))
* **trust-index:** add m8ven badge ([b3407a4](https://github.com/bhoudebert/agent-motoride/commit/b3407a402427949df6d7c9a3f7c436dc79ee8e90))

## [1.2.0](https://github.com/bhoudebert/agent-motoride/compare/v1.1.0...v1.2.0) (2026-10-06)


### Features

* **export:** add a whole-ride overview link when navigation is split in parts ([#32](https://github.com/bhoudebert/agent-motoride/issues/32)) ([0496635](https://github.com/bhoudebert/agent-motoride/commit/049663579916342de47abd13be05974fc8f9d544))
* **mcp:** ask the rider in forms for review ratings and repeat saves; rides as resources ([#34](https://github.com/bhoudebert/agent-motoride/issues/34)) ([3658b58](https://github.com/bhoudebert/agent-motoride/commit/3658b58f6a780092b225ba5999f57bd8726c727c))
* **mcp:** plain words get the full planning guidance in every client ([#36](https://github.com/bhoudebert/agent-motoride/issues/36)) ([9f54b7c](https://github.com/bhoudebert/agent-motoride/commit/9f54b7cf71b2cca388a460ea96cc163eff77935c))
* **planner:** check every itinerary in code, send failures back once ([#27](https://github.com/bhoudebert/agent-motoride/issues/27)) ([e2930b9](https://github.com/bhoudebert/agent-motoride/commit/e2930b97635341de676f1e86e6d2870b50617cbb))
* **planner:** plan a ride from a photo of a map or a route screenshot ([#30](https://github.com/bhoudebert/agent-motoride/issues/30)) ([afe0192](https://github.com/bhoudebert/agent-motoride/commit/afe019289da22efbb83547d3a3720900a4056bf8))
* **rides:** import GPX and KML routes as rides of the library ([#31](https://github.com/bhoudebert/agent-motoride/issues/31)) ([1f57f70](https://github.com/bhoudebert/agent-motoride/commit/1f57f70f5b4dfe4dccdbf8ade1b219a0fd279eea))
* **routing:** report fast expressways apart from motorways, and keep leisure rides off them ([#37](https://github.com/bhoudebert/agent-motoride/issues/37)) ([f9f4e59](https://github.com/bhoudebert/agent-motoride/commit/f9f4e59787f3821ca9a09b68c581b1ab2f2c9397))
* **trace:** export logged sessions as OpenTelemetry traces ([#29](https://github.com/bhoudebert/agent-motoride/issues/29)) ([8e49b18](https://github.com/bhoudebert/agent-motoride/commit/8e49b1810c2d0582b9b29256694eb752ad073132))


### Bug Fixes

* **traffic:** report expected congestion as the delay, not only incidents ([#26](https://github.com/bhoudebert/agent-motoride/issues/26)) ([0abb9ae](https://github.com/bhoudebert/agent-motoride/commit/0abb9aeb6caf0d55f7199e61640c415d03b641c6))

## [1.1.0](https://github.com/bhoudebert/agent-motoride/compare/v1.0.0...v1.1.0) (2026-10-06)


### Features

* **conditions:** crosswind, low-sun glare and road surface along the route ([#21](https://github.com/bhoudebert/agent-motoride/issues/21)) ([11f5e37](https://github.com/bhoudebert/agent-motoride/commit/11f5e37767c42a43ca97b5618fcec376944c69c2))
* **evals:** eval cases and code graders, recorded once and replayed for free ([#25](https://github.com/bhoudebert/agent-motoride/issues/25)) ([e9f6eb1](https://github.com/bhoudebert/agent-motoride/commit/e9f6eb1ea16510e75a8baadfead97892c39730d2))
* **feedback:** rate the roads you rode from notes and recorded tracks ([#24](https://github.com/bhoudebert/agent-motoride/issues/24)) ([07c3e9a](https://github.com/bhoudebert/agent-motoride/commit/07c3e9a6a5de9e6e93b1fc2cdecd69b230660f1a))


### Bug Fixes

* **routing:** request road surface from the router ([#23](https://github.com/bhoudebert/agent-motoride/issues/23)) ([a91e6ea](https://github.com/bhoudebert/agent-motoride/commit/a91e6ea742a50729fa083ea8d3f74b5abd7c5fd5))

## 1.0.0 (2026-10-05)


### Features

* **DB:** Add little DB save part to reuse segment etc and caching api calls ([7d93e0f](https://github.com/bhoudebert/agent-motoride/commit/7d93e0f0db61a2a89c0cdcd131b302ee80d1c2d9))
* **gpx:** add export feature ([0e8c92a](https://github.com/bhoudebert/agent-motoride/commit/0e8c92a4cfde539758f3013c05d3746a025c39f0))
* **init:** add first version ([1916297](https://github.com/bhoudebert/agent-motoride/commit/1916297b66c7bdb48d9b158dc225beb24a2798a7))
* **mcp:** add MCP support through Claude to avoid paying API ([8997290](https://github.com/bhoudebert/agent-motoride/commit/8997290e25364c5cd2d2a8aee286edddccf06f7a))
* **mcp:** support codex ([0dadacc](https://github.com/bhoudebert/agent-motoride/commit/0dadacc9a6848a7b1e6d0e17b9cc4b65c1e7fdd6))
* **mcp:** support Codex ([d390d34](https://github.com/bhoudebert/agent-motoride/commit/d390d34f022394fe62df1f71118b6c95a2392984))
* **mcp:** support Codex ([dae5790](https://github.com/bhoudebert/agent-motoride/commit/dae5790a318f603d633bd368fc20ab2bbc4b814e))
* **md:** improve display, radar, weather, cofee, break, md export ([1865769](https://github.com/bhoudebert/agent-motoride/commit/1865769cf72b0fa62df280fc88fd44ab6c335605))
* **refresh:** refresh a ride with -- today for weather, traffic, stops ([3d87fe7](https://github.com/bhoudebert/agent-motoride/commit/3d87fe7ee0187bb7180cd03c37c620aef75fe4bb))
* **site:** one-page website on GitHub Pages; rename to agentMotoride ([#16](https://github.com/bhoudebert/agent-motoride/issues/16)) ([1ad8ef9](https://github.com/bhoudebert/agent-motoride/commit/1ad8ef981acc5dfd94d0053dfe5170ec162d3b7e))
* **stops:** add more information on force stop/pause for refuel and profile ([f48cb32](https://github.com/bhoudebert/agent-motoride/commit/f48cb32cc99fc99a1d0ffbb40acd924653226461))
* **test:** openspec, tests, partial refresh, runs scout/or not, use api even with MCP if required ([093dadb](https://github.com/bhoudebert/agent-motoride/commit/093dadbd8e1fe78a3c158c6cba137086585318d9))

## Changelog

Maintained by release automation from Conventional Commits. Entries appear here
when a release pull request is merged.
