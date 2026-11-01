# Run it for several riders

Used alone, agentMotoride is one library on your machine and nothing here applies to you. If you want to serve a few
riders (family, a club, friends) from one machine, one instance can hold a library for each of them. They reach it from
Claude Code or Codex through the tools, with a token of their own. Nobody's plan runs on your model or your key: the
rider's own model does the planning.

## Start the server

The quickest way is the container with Caddy in front: [Host it yourself](/self-hosting). By hand, from the code:

```bash
npm run admin -- add alice@example.org     # once per rider: prints the token and the connection lines
npm run serve                              # listens on 127.0.0.1:8788; /mcp for the tools, /health for a check
```

Put a proxy with TLS in front, for example Caddy, which gets the certificate by itself:

```
rides.example.org {
  reverse_proxy 127.0.0.1:8788
}
```

Set `RIDE_SERVER_HOST=0.0.0.0` only when the proxy runs on another machine or in a container. Never expose the port
without TLS: the token travels in a header.

## What a rider does

The rider adds the server once, with the lines `add` printed:

```bash
claude mcp add --transport http ride https://rides.example.org/mcp --header "Authorization: Bearer mrt_…"
```

Codex reads the same address from `~/.codex/config.toml`, with the token in an environment variable. From then on the
rider plans in plain words, as in [Claude Code and Codex](/claude-code-and-codex), and the library they build is theirs
alone. Their own model plans: the server holds no model and no key, so scouting is done by the client's subagents in
Claude Code (Codex explores the areas itself).

## Connect ChatGPT or Claude

Beside the token, the server can let a rider sign in from **ChatGPT or Claude**, on the web (and the phone, once connected
there). Turn it on with `RIDE_OAUTH=1` (the public address in `RIDE_SERVER_URL` must be the https one the chat assistant
reaches; the proxy of the examples passes `/oauth/*` and `/.well-known/oauth-*`). Nothing changes while it is off, and the
token keeps working either way.

```bash
npm run admin -- link alice@example.org    # a one-time code, valid ten minutes, works once
```

Then Alice adds `https://rides.example.org/mcp` as a connector in ChatGPT or Claude (in Settings, on the web), picks sign-in
with OAuth, and types the code on the page the connector opens. There is no password and no account: the code is the proof.
`npm run admin -- connections alice@example.org --revoke` ends her connections to ChatGPT and Claude; suspending or removing
her ends them too, and so does a new token (`token`) or `devices --revoke`. A connection can only use her library through the tools, not her roadbook list or uploads.

ChatGPT's connectors are set up on its website, and Claude's custom connectors on claude.ai; the details are theirs and change.
The addresses a chat assistant may be sent back to are those of Claude and ChatGPT, plus any listed in `RIDE_OAUTH_REDIRECTS`
(a comma-separated list of exact https addresses): if a connection fails at the end of the sign-in, the host reads the address
in the assistant's error and adds it.

## What the server protects

- A **session belongs to the rider who opened it**: another token gets a plain "not found".
- A **suspended or removed rider** is shut out at once, even in an open session.
- **Files stay in the rider's own folder** (`data/tenants/<id>/`): an export lands in its `exports/`, and a path that
  goes elsewhere (`..`, `/tmp/…`, `~/…`) is refused. Files cannot be uploaded yet, so importing a route file or
  reviewing a track from a phone needs that next step.
- At most 20 open sessions a rider (a new one closes the one unused longest) and 200 in all, idle sessions closed after 30 minutes, 300 requests a minute a rider,
  bodies up to 1 MiB.

## What you set up

- A **registry** of riders, a small SQLite file (`data/registry.db`): for each an identifier (a random UUID, not made from
  the email), the email, a status and the hash of a token. The token itself is shown once, when it is made.
- One **library per rider**, a SQLite file at `data/tenants/<id>/agentmotoride.db`, created on first use. Nothing a
  rider saves, rates or notes can be seen with another rider's token.
- An update changes no library until its rider is next served: each library is migrated, after a backup, the first time
  it is opened ([ADR 0022](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0022-versioned-schema-migrations.md)).

## The commands

```bash
npm run admin -- add alice@example.org       # prints the token once, and how to connect
npm run admin -- list                        # identifier, email, status, size of the library, last seen
npm run admin -- suspend alice@example.org   # the token stops working; nothing is lost
npm run admin -- resume alice@example.org
npm run admin -- invite alice@example.org    # a QR code for her phone (see below)
npm run admin -- token alice@example.org     # a new token; the old one stops working at once
npm run admin -- remove alice@example.org    # the library is kept aside in data/removed/
npm run admin -- remove alice@example.org --purge --yes   # and this deletes it for good
npm run admin -- backup                      # a consistent copy of everything into data/backups/<date>/
nix run .#admin -- list                      # the same, with Nix
```

Set `RIDE_SERVER_URL` (for example `https://rides.example.org`) so `add` prints the right connection text, and
`RIDE_DATA_DIR` to keep the data on a mounted volume.

## Connect a phone: the invitation

The MotoRide app needs the server's address and a token. Rather than send a long secret, make an **invitation**:

```bash
npm run admin -- invite alice@example.org --pin --out alice.png
```

It prints a QR code in the terminal, the link behind it, when it expires, and a PIN of six digits; `--out` also saves the QR
code as a PNG or SVG file you can send. Alice scans it with her phone's camera, the app opens and asks whether to use the
server, asks for the PIN, and receives a token of its own. The QR code holds no token, only a one-time code that works once
and lasts 24 hours (`--hours=48` for longer), so sending it by email or chat is safe; send the PIN another way, such as a
call. Three wrong PINs burn the invitation. Without `--pin`, whoever scans it first joins. An email that is not registered
yet is registered by its invitation. `--url=https://...` overrides `RIDE_SERVER_URL`.

**What the rider does:** install the MotoRide app, scan the QR code with the phone's camera (or open the link you sent
on the phone), tap the link the camera offers, then in the app read the address, type the PIN if there is one, and tap
**Join**. Then Menu, Server, **Test** shows that it works. If the camera does not offer to open the link, send the link
itself in a message and tap it on the phone. If it says the invitation is no longer valid, it was used or it expired:
make another.

A phone's token is separate from the rider's own (Claude Code keeps working). `npm run admin -- devices alice@example.org
--revoke` stops all of Alice's phones; suspending or removing her stops them too.

## Looking into a rider's library

```bash
RIDE_TENANT=<id> npm run rides -- roadbooks
```

`RIDE_TENANT` makes the terminal commands and the stdio server use that rider's library. Without it, and without a
registry, everything works as it always did with `data/agentmotoride.db`.

## What to know

- Emails are the riders' only personal data here, apart from their libraries. A library is not encrypted: protect the
  machine and the backups like any other place that holds people's data.
- Tokens are 256 random bits and are never stored. A lost token is replaced with `token`, not recovered.
- Why one instance with a file per rider, and not a container or a Postgres schema each:
  [ADR 0027](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0027-one-instance-one-sqlite-file-per-user.md).
