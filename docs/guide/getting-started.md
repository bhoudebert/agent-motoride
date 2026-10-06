# Getting started

agentMotoride plans one-day motorcycle rides from what you say in a sentence,
from real road, weather and traffic data, and keeps a library of the rides you
liked. You talk to it in one of two ways; the tools, the library and the
exports are the same.

|                    | Terminal                                       | Claude Code or Codex                                     |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------- |
| Who thinks         | This app, with your Anthropic API key          | The model of your Claude Code or Codex plan              |
| What you pay with  | The API key, per use (a few cents to a dollar) | Your existing plan; scouts use the API key if one is set |
| How you talk to it | A menu, then a `refine>` prompt                | Plain words: "plan me a ride on Saturday", "show ride 7" |
| Best for           | Full control, scripts, cost per ride           | Daily use, chatting about rides, from the phone          |

Every page of this guide shows both, side by side.

## Install

You need Node.js 24 or newer.

```bash
git clone https://github.com/bhoudebert/agent-motoride && cd agent-motoride
npm install
cp .env.example .env
```

Then edit `.env`:

| Setting             | What for                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `RIDE_HOME`         | Your start and end point, e.g. `Grenoble` or a street address                |
| `ANTHROPIC_API_KEY` | The terminal app. In Claude Code or Codex, only needed for scouts            |
| `TOMTOM_API_KEY`    | Optional: traffic at departure (free tier at developer.tomtom.com)           |
| `RIDE_MODEL`        | Optional: the model of the terminal app, `claude-sonnet-5-5` is a good value |

Check what is ready and whether the map and weather services answer from your
machine:

```bash
npm run check
```

## Connect

::: code-group

```bash [Terminal]
npm run ride            # start menu: plan a new ride, or open a saved one
```

```bash [Claude Code]
claude                  # in the project folder; approve the "ride" server when asked
```

```bash [Codex]
npm run codex:register  # once per machine, then start codex anywhere
```

:::

## Your first ride

::: code-group

```text [Terminal]
$ npm run ride
  1. Plan a new ride
> 1
What ride do you want?
> this Saturday, no rain, under 250 km, winding roads
```

```text [Claude Code / Codex]
plan me a ride this Saturday, no rain, under 250 km, winding roads
```

:::

::: tip Plain words are enough
In Claude Code and Codex, say what you want as you would to a friend: the
server tells the model to fetch the full planning guidance first. Slash
commands such as `/mcp__ride__plan-ride` are shortcuts, nothing more; type
`/mcp__ride__help` to list them.
:::

A plan takes one to a few minutes. Then keep talking to it: "shorter", "leave
at 10", "skip Tournai", and save it when it suits you.

::: tip What next
[Plan a ride](/plan-a-ride) explains what comes back and how to change it.
:::
