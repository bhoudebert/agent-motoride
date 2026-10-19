# Host it yourself

One small machine can serve several riders: a home server, a Raspberry Pi, or a cheap VPS. You run one container, a
reverse proxy for HTTPS, and one folder of data. This page is the whole procedure, with Docker or with NixOS. What the
server is, and why it is shaped this way, is in [Run it for several riders](/several-riders).

## What you need

- A machine with Docker (or NixOS) that stays on.
- A **domain name** pointing at it (an `A` record), and ports **80 and 443** reachable from the internet, so that Caddy
  can get its certificate. Without a domain, keep it on your own network and use the address of the machine.
- About 200 MB of memory and a little disk: a library is a few megabytes.

No model and no API key are needed: each rider's own Claude Code or Codex does the planning.

## With Docker

```bash
git clone https://github.com/bhoudebert/agent-motoride && cd agent-motoride
cp deploy/.env.example deploy/.env        # set RIDE_DOMAIN and RIDE_SERVER_URL
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Caddy gets and renews the certificate for your domain by itself. Check it:

```bash
curl https://rides.example.org/health      # {"ok":true,...}
```

To run the published image instead of building it, replace `build:` with
`image: ghcr.io/bhoudebert/agent-motoride:latest` in `deploy/docker-compose.yml`, and pin a version tag if you want to
choose when an update happens.

### Add the riders

```bash
docker compose -f deploy/docker-compose.yml exec ride node src/admin.ts add alice@example.org
docker compose -f deploy/docker-compose.yml exec ride node src/admin.ts list
```

`add` prints the token once and the line for Claude Code and for Codex. Send it to the rider; it is the only copy. For the
MotoRide app on a phone, make an invitation instead of sending a token: `exec ride node src/admin.ts invite alice@example.org
--pin` prints a QR code to scan ([Run it for several riders](/several-riders)). The
other commands (`suspend`, `resume`, `token`, `remove`, `backup`) are in [Run it for several riders](/several-riders).
An alias saves typing: `alias ride-admin='docker compose -f deploy/docker-compose.yml exec ride node src/admin.ts'`.

### Back up, update

```bash
docker compose -f deploy/docker-compose.yml exec ride node src/admin.ts backup      # into /data/backups/<date>/
docker compose -f deploy/docker-compose.yml pull && docker compose -f deploy/docker-compose.yml up -d
```

Everything lives in the `ride-data` volume: the registry and one library per rider. Back it up, or copy the backups
folder somewhere else. An update is a new image and a restart; each library migrates itself, after a backup of its own,
the first time its rider is served ([ADR 0022](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0022-versioned-schema-migrations.md)).

## With NixOS

The flake carries a NixOS module that runs the same image, puts Caddy in front, opens the ports, installs an admin
command and backs up every night:

```nix
# flake.nix of your machine
inputs.agent-motoride.url = "github:bhoudebert/agent-motoride";

# configuration.nix
imports = [ inputs.agent-motoride.nixosModules.ride-server ];
services.agent-motoride = {
  enable = true;
  domain = "rides.example.org";
  # image = "ghcr.io/bhoudebert/agent-motoride:1.9.0";   # pin a version
  # backup.keep = 14;                                     # nightly backups kept
};
```

After `nixos-rebuild switch`:

```bash
sudo agent-motoride-admin add alice@example.org
sudo agent-motoride-admin list
sudo agent-motoride-admin backup
```

The data is in `/var/lib/agent-motoride` (set `dataDir` to move it), the nightly backups in its `backups/` folder.

## What is exposed

Caddy passes only `/mcp` (the tools, with a token), `/health`, `/enrol` (a phone exchanging its one-time invitation), and the live ride relay and its page (`/share/*`, `/follow/*`,
`/follow.js`, [Share a ride live](/live-sharing)). The administration stays inside the container: there
is no web page to log in to, and a rider can only be added from the machine. The container runs as an ordinary user, listens
on the loopback address of the host, and keeps nothing but the data volume. A token travels in a header, so the port
must never be reachable without TLS.

## When something is wrong

| What you see             | What to check                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `curl …/health` fails    | `docker compose … ps`; the logs with `docker compose … logs ride caddy`; the domain's `A` record; ports 80 and 443 open |
| A rider gets 401         | The token is wrong or was replaced (`token` makes a new one and ends the old one), or the rider is suspended (`list`)   |
| A rider gets 429         | More than 300 requests a minute or 5 open sessions: wait a minute, close a client                                       |
| Certificate errors       | Caddy needs the domain to point at this machine and port 80 open to get the certificate                                 |
| A rider forgot the token | There is no recovery: `token` makes a new one                                                                           |

## Costs and risks, plainly

You run a service for other people. Their libraries are not encrypted on disk (protect the machine and the backups),
their emails are in the registry, and you are the one to answer when it is down. Keep it to people you know, or read
the terms and privacy side before offering it widely.
