# From your phone

Plan, check and note from the phone, with nothing to install on it but the
Claude or ChatGPT app. The session keeps running on a computer of yours, with
its library, exports and settings; the phone is the keyboard and the screen.
Nothing of agentMotoride is put on the internet.

::: code-group

```bash [Claude Code]
cd agent-motoride
claude remote-control        # prints a URL and a QR code: scan it with the Claude app

# from inside a running session: /rc
```

```text [Codex]
In the ChatGPT desktop app (Mac or Windows):
Settings > Connections > Control this Mac or PC > Set up
Scan the QR code with the phone, then open Codex in the ChatGPT app
and pick this project.
```

:::

Then ask as you would at the computer: "plan me a ride Sunday, under 220 km",
"briefing for ride 7", "cobbles, never again" at a stop.

::: details Codex from the command line (experimental)
Recent Codex CLI releases have an experimental remote-control daemon:
`codex remote-control start`, then `codex remote-control pair` for a
short-lived code to enter in the ChatGPT app, and `codex remote-control stop`
when the host should no longer accept sessions. Its interface may change; the
desktop-app pairing above is the documented path.
:::

## Where the session runs

| Machine                                           | Notes                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Your computer                                     | Zero setup; it must stay awake while you are out                              |
| A small always-on box at home (Raspberry Pi, NAS) | Clone the project there with `.env` and the database; the library lives there |
| A VPS                                             | The same, and the laptop is free                                              |

## Requirements

- **Claude Code**: a Pro, Max, Team or Enterprise plan signed in with `/login`
  (an API key alone does not qualify). Linux hosts work.
- **Codex**: the ChatGPT desktop app on Mac or Windows, signed in on both
  devices with the same account. A Linux machine can sit behind it as an SSH
  host: install Codex there, register the ride server there, and add it in
  **Settings > Connections > SSH**. A workspace administrator may need to
  enable remote control.

## Files

GPX and Markdown are written on the machine that runs the session. At home,
`npm run rides -- share 7` gives the phone a page with the links and the GPX.
Away from home, ask to "show ride 7": the Google Maps links in the answer open
on the phone directly. A track recorded on the phone has to reach that machine
for a review.

## Keep it safe

- Never share `.env`, API keys, the ride database or a pairing code. Treat a
  pairing code like a temporary password.
- Pair only devices signed in to your own account, and remove those that should
  no longer have access.
- Remote control shares the session on your machine; it does not publish the
  ride server. On a remote host, use key-based SSH and a VPN or mesh network,
  never an open port.
