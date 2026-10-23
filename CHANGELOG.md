# Changelog

## [1.10.0](https://github.com/bhoudebert/agent-motoride/compare/v1.9.0...v1.10.0) (2026-10-23)


### Features

* **follow:** show a possible crash on the follower page when the rider's phone says so ([#113](https://github.com/bhoudebert/agent-motoride/issues/113)) ([51f148e](https://github.com/bhoudebert/agent-motoride/commit/51f148e4b36dc235b102dd32b4d8f446749d7aa1))
* **traffic:** answer the phone's traffic with TomTom flow, using the host's key ([#116](https://github.com/bhoudebert/agent-motoride/issues/116)) ([ec8a685](https://github.com/bhoudebert/agent-motoride/commit/ec8a685dc0b22906b0938fd1a94dc71827c4207a))
* **traffic:** read French open data by default, with no key ([#121](https://github.com/bhoudebert/agent-motoride/issues/121)) ([ddd2ce7](https://github.com/bhoudebert/agent-motoride/commit/ddd2ce7b0d5c1942baa9167ebaaf095e8442a893))


### Bug Fixes

* **deploy:** let the proxy pass /traffic and hand the TomTom key to the container ([#118](https://github.com/bhoudebert/agent-motoride/issues/118)) ([0b55074](https://github.com/bhoudebert/agent-motoride/commit/0b550742c2fb282e7128a22b21152c93ab726e9f))
* **ops:** single docker ([677bbf8](https://github.com/bhoudebert/agent-motoride/commit/677bbf82056c03f303e5063ab08281732d23b751))
* **site:** keep the menu links on one line and stack them under the name when they do not fit ([#108](https://github.com/bhoudebert/agent-motoride/issues/108)) ([e889df9](https://github.com/bhoudebert/agent-motoride/commit/e889df956ade9b75ad83d2ea01763b830a7d2a36))
* **traffic:** keep TomTom off by default and stop sharing its results between riders ([#120](https://github.com/bhoudebert/agent-motoride/issues/120)) ([a30baf6](https://github.com/bhoudebert/agent-motoride/commit/a30baf620ebd34467547ade664647b8c4aea6551))

## [1.9.0](https://github.com/bhoudebert/agent-motoride/compare/v1.8.0...v1.9.0) (2026-10-20)


### Features

* **admin:** invite a rider's phone with a QR code and a one-time code ([#101](https://github.com/bhoudebert/agent-motoride/issues/101)) ([0bd0ab9](https://github.com/bhoudebert/agent-motoride/commit/0bd0ab98003018cc45dfb2299ad10558c44af3dd))
* **deploy:** keep the data in a folder of your choice with RIDE_DATA_PATH ([#104](https://github.com/bhoudebert/agent-motoride/issues/104)) ([1ee6b3e](https://github.com/bhoudebert/agent-motoride/commit/1ee6b3ecbb9a65f086f516bac8dfaf1f098305bd))
* **live:** relay a ride live to followers, encrypted so the server cannot read it ([#100](https://github.com/bhoudebert/agent-motoride/issues/100)) ([0b99af8](https://github.com/bhoudebert/agent-motoride/commit/0b99af82549a56f3d4c91c26c97e0da1e9c4ae31))
* **server:** a container image, compose with Caddy, a NixOS module and a self-hosting guide ([#99](https://github.com/bhoudebert/agent-motoride/issues/99)) ([f5dbb9d](https://github.com/bhoudebert/agent-motoride/commit/f5dbb9d89817e7be4084d5f0ef1603c7da2eef15))
* **server:** a registry of riders with a library each, and an admin command ([#94](https://github.com/bhoudebert/agent-motoride/issues/94)) ([edf7f35](https://github.com/bhoudebert/agent-motoride/commit/edf7f357919819938e4455b5acd1a62a4cf6bb52))
* **server:** identify a rider by a random UUID ([#98](https://github.com/bhoudebert/agent-motoride/issues/98)) ([68e2445](https://github.com/bhoudebert/agent-motoride/commit/68e244567cf9f6e396bd114d597f05b36dc470de))
* **server:** serve the MCP tools over HTTP, one session and one library per rider ([#96](https://github.com/bhoudebert/agent-motoride/issues/96)) ([60c8972](https://github.com/bhoudebert/agent-motoride/commit/60c89721180490da13f204f2691d26f85f7d5d0b))

## [1.8.0](https://github.com/bhoudebert/agent-motoride/compare/v1.7.0...v1.8.0) (2026-10-19)


### Features

* **feedback:** rate a stretch of road directly, list rated roads, remove a stretch rating ([#73](https://github.com/bhoudebert/agent-motoride/issues/73)) ([20e180a](https://github.com/bhoudebert/agent-motoride/commit/20e180afe23b9fb31d96a27f8876577bc746f8ec))
* **mcp:** one capability catalogue behind the help, a capabilities tool and rides help ([#75](https://github.com/bhoudebert/agent-motoride/issues/75)) ([4b13414](https://github.com/bhoudebert/agent-motoride/commit/4b134143642dfe339bad86ad55fef50501d5dc65))
* **nix:** add nix ([#85](https://github.com/bhoudebert/agent-motoride/issues/85)) ([4331754](https://github.com/bhoudebert/agent-motoride/commit/433175488eb1b31296c5817539378ddee70478d0))
* **ratings:** narrowest rating wins; a low roadbook rating asks roads or loop ([#76](https://github.com/bhoudebert/agent-motoride/issues/76)) ([33a080c](https://github.com/bhoudebert/agent-motoride/commit/33a080cbe139f71c0eef5bc154d5373e8b590bf7))
* **review:** match a MotoRide track to its roadbook by number and name, export the origin ([#93](https://github.com/bhoudebert/agent-motoride/issues/93)) ([c9c8954](https://github.com/bhoudebert/agent-motoride/commit/c9c89547214b944226bfc3c11c7dae25ebed973b))
* **roadbook:** export file ([#90](https://github.com/bhoudebert/agent-motoride/issues/90)) ([852e1f8](https://github.com/bhoudebert/agent-motoride/commit/852e1f8d2396f3e93944f2b432a47ca459522cef))
* **route-analysis:** measure long straights and prefer fewer before fewer 50 zones ([#83](https://github.com/bhoudebert/agent-motoride/issues/83)) ([513dac0](https://github.com/bhoudebert/agent-motoride/commit/513dac0e1f2c0c611182e14a9caa82dae14dcd1a))
* **route-exports:** write the country of each stretch, leave out cameras where warning is banned ([#92](https://github.com/bhoudebert/agent-motoride/issues/92)) ([82267f9](https://github.com/bhoudebert/agent-motoride/commit/82267f939a617cc9f201c49e7f086b5fcd907a36))
* **route-exports:** write the roundabouts of the line into the roadbook file ([#91](https://github.com/bhoudebert/agent-motoride/issues/91)) ([60ca8d6](https://github.com/bhoudebert/agent-motoride/commit/60ca8d65d4bdccb9754de0792c6dfb6ad8ac0cbd))


### Bug Fixes

* **planner:** ask once for the JSON object when a model answers in prose ([#86](https://github.com/bhoudebert/agent-motoride/issues/86)) ([b9dd238](https://github.com/bhoudebert/agent-motoride/commit/b9dd23868b390fe61e2284e1d3b8b62e9bdfc094))
* **planner:** read answers wrapped in a code fence or with ride as a … ([#84](https://github.com/bhoudebert/agent-motoride/issues/84)) ([c3bffe5](https://github.com/bhoudebert/agent-motoride/commit/c3bffe5439df8cec270de7c711efea7666274e03))

## [1.7.0](https://github.com/bhoudebert/agent-motoride/compare/v1.6.0...v1.7.0) (2026-10-07)


### Features

* **mcp:** client subagents report their verdict with reportScout, remembered like a scout's ([#68](https://github.com/bhoudebert/agent-motoride/issues/68)) ([4420e3c](https://github.com/bhoudebert/agent-motoride/commit/4420e3c7d022768483dc15395b2b528528e04e77))
* **planner:** the fast-expressway ceiling as a setting, 25% by default ([#69](https://github.com/bhoudebert/agent-motoride/issues/69)) ([4fec6ec](https://github.com/bhoudebert/agent-motoride/commit/4fec6eca5088a51279f4f2ec6aea0b0785810c57))


### Bug Fixes

* **mcp:** name the shared tools' hints annotations, as MCP does, so a source scan finds them ([#66](https://github.com/bhoudebert/agent-motoride/issues/66)) ([283d602](https://github.com/bhoudebert/agent-motoride/commit/283d6026e6cdd4291e998c82b2e12cb17235c56b))

## [1.6.0](https://github.com/bhoudebert/agent-motoride/compare/v1.5.0...v1.6.0) (2026-10-07)


### Features

* **feedback:** close the roadbooks change: the reviewed track kept on its ride; specs folded ([#64](https://github.com/bhoudebert/agent-motoride/issues/64)) ([641c06d](https://github.com/bhoudebert/agent-motoride/commit/641c06d3e75456339b157451b098d898b4541b3a))
* **library:** rides keep the version they rode; a change names the rides that follow ([#62](https://github.com/bhoudebert/agent-motoride/issues/62)) ([eb5532d](https://github.com/bhoudebert/agent-motoride/commit/eb5532dc29d2063ed9f26bd71f1abcba7286c9ca))

## [1.5.0](https://github.com/bhoudebert/agent-motoride/compare/v1.4.0...v1.5.0) (2026-10-07)


### Features

* **cli:** page the start menu's roadbooks, 20 at a time; attach the newest 20 over MCP ([#61](https://github.com/bhoudebert/agent-motoride/issues/61)) ([1b603b7](https://github.com/bhoudebert/agent-motoride/commit/1b603b7ac3d89f9edd32714afde0e4e81f636cd8))
* **library:** change a roadbook in place and keep versions; restore and copy ([#59](https://github.com/bhoudebert/agent-motoride/issues/59)) ([1309290](https://github.com/bhoudebert/agent-motoride/commit/130929084a0e001f6a8cfa5bf455632adc1b567b))
* **library:** delete roadbooks and rides once confirmed, cancel rides, tidy the library ([#57](https://github.com/bhoudebert/agent-motoride/issues/57)) ([2e70bbc](https://github.com/bhoudebert/agent-motoride/commit/2e70bbcf5d6822105a7d38ba3f6a524ca9d8d1b1))
* **library:** plan a ride from a roadbook on a day, in a sentence or a command, no copy ([#55](https://github.com/bhoudebert/agent-motoride/issues/55)) ([1b3b627](https://github.com/bhoudebert/agent-motoride/commit/1b3b627f88b4b03d60e0642382d9cd4ab360234d))
* **library:** the start from the first leg, the day's own rating, the briefing on a chosen ride ([#60](https://github.com/bhoudebert/agent-motoride/issues/60)) ([8be2af4](https://github.com/bhoudebert/agent-motoride/commit/8be2af4907dd16c9f0348e906e13beab3997e9bf))
* **store:** store saved rides as roadbooks and rides, behaviour unchanged ([#53](https://github.com/bhoudebert/agent-motoride/issues/53)) ([3f41b47](https://github.com/bhoudebert/agent-motoride/commit/3f41b4798a18c6bed10261a034f7f22dd83e8b0c))
* **store:** versioned schema migrations, each in a transaction after a backup ([#51](https://github.com/bhoudebert/agent-motoride/issues/51)) ([8944c76](https://github.com/bhoudebert/agent-motoride/commit/8944c7631657359aa10014a1708eb97336375438))


### Bug Fixes

* findings from the Valenciennes run: past departures, opening days, town names, slow-zone targets ([#58](https://github.com/bhoudebert/agent-motoride/issues/58)) ([109c67a](https://github.com/bhoudebert/agent-motoride/commit/109c67a5713dff7de00c58467a4299ac314fe4f8))
* **mcp:** write the four hints on every shared tool, so a source scan sees them ([#56](https://github.com/bhoudebert/agent-motoride/issues/56)) ([2d3beb8](https://github.com/bhoudebert/agent-motoride/commit/2d3beb878f35621a08827926fe52d8918e39df27))

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
