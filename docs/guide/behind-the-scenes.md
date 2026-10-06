# Behind the scenes

agentMotoride is also a working example of an agentic application, built and
measured like a product. If you want to know how, start here.

| Where                                                                                           | What                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Engineering notes](https://github.com/bhoudebert/agent-motoride/blob/main/docs/ENGINEERING.md) | How it works: the planner and its scouts, the tools and their data sources, the riding-time model, model choice and cost, evals, observability, project layout |
| [Decision records](https://github.com/bhoudebert/agent-motoride/tree/main/docs/adr)             | Why it is built this way, one decision per page                                                                                                                |
| [Specifications](https://github.com/bhoudebert/agent-motoride/tree/main/openspec/specs)         | What it does, as requirements with scenarios, one capability per page                                                                                          |
| [How it evolves](https://github.com/bhoudebert/agent-motoride/blob/main/docs/EVOLVING.md)       | The path of every change: idea, decision, spec, code in every mode, tests, docs, release                                                                       |
| [Contributing](https://github.com/bhoudebert/agent-motoride/blob/main/CONTRIBUTING.md)          | Setup, commits, pull requests                                                                                                                                  |

In short:

- **The model decides, tools supply every number, code enforces the rules.**
  Roads, limits and routing come from OpenStreetMap and Valhalla, forecasts from
  Open-Meteo, traffic from TomTom. No motorway unless allowed, no repeat of a
  saved ride, and every itinerary is checked against your limits before you see
  it.
- **Scouts**: two to four smaller model sessions explore riding areas in
  parallel, and the planner compares what they found.
- **Evaluated**: scripted rider requests are graded by code, recorded once
  against the real services and replayed for free on every change, including a
  prompt-injection case planted in map data.
- **Observable**: every session is traced and costed, can be replayed step by
  step, and exported to any OpenTelemetry tool.
