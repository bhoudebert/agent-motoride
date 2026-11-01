# Use it from ChatGPT or Claude, phone included

Plan, check, rate and review rides by talking to **ChatGPT** or **Claude**, on the web or in their phone apps, with your own
library behind them. Nothing runs on your computer: the assistant reaches your agentMotoride server over the internet, and the
roadbooks it saves are the ones the MotoRide app lists.

This is the same server, the same tools and the same library as [Claude Code and Codex](/claude-code-and-codex), and the same
roadbooks the [MotoRide app](/phone-and-gps) rides. What changes is where you talk to it.

## Three ways to talk to your library from a phone

| Way                                              | What runs where                                                              | Needs                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **A connector in ChatGPT or Claude** (this page) | The assistant calls your server directly. Your computer can be off.          | A server you can reach over https, with sign-in enabled                             |
| [Remote control of a session](/from-your-phone)  | A Claude Code or Codex session stays open on a computer or a VPS of yours.   | That machine, awake                                                                 |
| The MotoRide app, for the ride itself            | The app downloads roadbooks from your server, and records and uploads rides. | A registered server, or none at all ([see what changes](/with-or-without-a-server)) |

They are not exclusive: one library serves all three.

## Before you start

- **A server of yours.** Hosting one is covered in [Host it yourself](/self-hosting) and [Run it for several riders](/several-riders).
  A rented server, bought from the app, is planned and not available yet.
- **Sign-in switched on.** The host sets `RIDE_OAUTH=1` and `RIDE_SERVER_URL` to the public https address
  ([Connect ChatGPT or Claude](/several-riders#connect-chatgpt-or-claude)). Check it from any browser:

  ```bash
  curl https://rides.example.org/health                                   # says "oauth":true
  curl https://rides.example.org/.well-known/oauth-authorization-server   # answers JSON, not 404
  ```

  If a proxy sits in front of the server, it has to pass `/oauth/*` and `/.well-known/oauth-*` as well as `/mcp`.

- **A paid plan that allows connectors** on your assistant. Who gets custom connectors, and where they are added, is
  decided by [OpenAI](https://help.openai.com/it-it/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)
  and [Anthropic](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers) and
  changes often; check their pages.
- **A one-time code**, made just before you connect (below).

## Get a one-time code

The sign-in page asks for a code instead of a password or an account. The code is how the server knows which rider you are. It
has 8 characters, lasts **10 minutes** and works **once**.

```bash
npm run admin -- link alice@example.org
# Code for alice@example.org: K7QM-3XPD
```

On a Docker server, run it inside the container:
`docker compose exec ride node src/admin.ts link alice@example.org`. A later version of the app will show the code itself.

Make the code when you are about to connect, not before.

## Connect Claude

On claude.ai, in a browser:

1. Open **Settings**, then **Connectors** (the menu is also called **Customize**), and choose **Add custom connector**.
2. Give it a name, such as `Rides`, and the address of your server with `/mcp`: `https://rides.example.org/mcp`.
3. Leave any OAuth client ID and secret empty. Claude registers itself with your server.
4. Choose **Connect**. A page of your server opens and asks for the code. Type it.
5. Back in Claude, the connector is on. Open a conversation and ask for your roadbooks.

<!-- Screenshots for the Claude steps come in a following change. -->

Connectors added on the web are available in Claude's phone apps with the same account: open a new conversation on the
phone and the tools are there.

## Connect ChatGPT

On chatgpt.com, in a browser (connectors are added there, not in the phone app):

1. Open **Settings**, then **Apps & Connectors** (or **Connectors**, depending on the version), open **Advanced settings** and
   turn on **Developer mode**.
2. Create a new connector: a name, the address `https://rides.example.org/mcp`, and **OAuth** as the authentication.
3. Leave any client ID and secret empty: ChatGPT registers itself with your server.
4. Create it. ChatGPT opens a page of your server and asks for the code. Type it.
5. In a conversation, choose the connector from the tools menu and ask for your roadbooks.

<!-- Screenshots for the ChatGPT steps come in a following change. -->

The names of the menus move from one release to the next; if you do not find them, follow what OpenAI's page says for custom
connectors and keep the three values above: the `/mcp` address, OAuth, and no client ID.

## What to say

Plain words, as in the terminal. The assistant calls the tools; you never name them.

```text
show my roadbooks
plan a ride from Namur on Saturday morning, under 220 km, winding roads
briefing for roadbook 7 tomorrow at 9
save it                  (the MotoRide app then lists it as "On your server")
cobbles, never again, on the way to Ciney
how was my last recorded ride?
```

For a new ride the assistant follows the planning guide of the server and checks its own answer against the rules in code, as it
does anywhere. Roadbooks you save are listed by the MotoRide app, which downloads them with their speed limits and cameras.

## What it cannot do yet

- **Hand it a file.** The tools read files that are on the server, so a GPX or KML on your phone cannot be given to the chat. A
  photo of a paper map or a list of places typed in the chat does work. See [Import a route](/import-a-route).
- **Plan as well as Claude Code?** Not measured. Claude Code can send helpers to scout several areas at once; a chat app plans
  the same way but with what its own tools allow. Claude Code remains the most complete way to plan, and the connector is the
  most convenient one.
- **Show a connection in the app, or end a single one.** The administrator can end all of a rider's connections
  (`npm run admin -- connections alice@example.org --revoke`), and the assistant's own settings can remove the connector.

## What it gives access to, and what it does not

- A connector can use **your library through the tools**: plan, read and change roadbooks, notes and ratings, and review the
  rides you uploaded. It is not given the phone's own endpoints (the roadbook files, the uploads, traffic), and it cannot reach
  other riders.
- What you ask and what comes back, with the places in it, **passes through ChatGPT or Claude**, as with any chat.
  The server holds no model and no key of yours: the assistant is the one you pay for.
- **Type a code only on a page you started yourself**, just now, from your own assistant. If someone sends you a link to a
  sign-in page, or asks you for a code, do not give it: a code gives whoever uses it your library.
- Codes and tokens are kept as hashes on the server. Access lasts an hour and renews by itself for up to 90 days. A new
  token (`npm run admin -- token`), stopping the phones (`devices --revoke`), suspending or removing the rider also end
  the connections.

## When something goes wrong

| What you see                                                        | What to check                                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Couldn't reach the MCP server", or the server "is not working"     | `/health` says `"oauth":true`; the discovery address answers JSON; the proxy passes `/oauth/*` and `/.well-known/oauth-*`; the address is https                        |
| ChatGPT: "Dynamic client registration failed… invalid_redirect_uri" | The server is older than the version that accepts ChatGPT's per-connector callback: update it. If it names another address, the host adds it to `RIDE_OAUTH_REDIRECTS` |
| The page says the code is not valid                                 | It expired (10 minutes), was used, or was mistyped: make a new one with `admin link`                                                                                   |
| The sign-in page says too many tries                                | Wait a minute: the server allows 30 tries a minute in all                                                                                                              |
| It connects, then the tools fail with 401 after a while             | The connection was ended (new token, rider suspended): connect again with a new code                                                                                   |
| A first attempt failed and a second worked                          | Often a code that expired before it was typed, or a server restarting. If it keeps happening, tell us what the assistant said                                          |

The host can read what the server saw in its log (`docker compose logs ride`): each sign-in request is a line with its method,
path and answer, such as `[oauth] POST /oauth/token 400`, and never a code or a token.
