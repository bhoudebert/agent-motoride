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

### With your own nginx (or another proxy)

If ports 80 and 443 are already taken by a proxy of yours, run the server alone: it is published on the loopback address of
the machine only, and your proxy passes the few paths it shows to the internet.

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.nginx.yml --env-file deploy/.env up -d ride
curl http://127.0.0.1:8788/health          # {"ok":true,...}
sudo cp deploy/ride-proxy.conf.example /etc/nginx/ride-proxy.conf
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/rides.conf    # set the domain and your certificate
sudo nginx -t && sudo systemctl reload nginx
curl https://rides.example.org/health
```

`up -d ride` starts the server and not Caddy. Keep the paths of the example: `/mcp`, `/health`, `/enrol`, `/traffic`, `/roadbooks`, `/roadbook/*`, `/follow.js`,
`/follow/*` and `/share/*` are exposed and everything else is 404. Keep `proxy_buffering off` and the long read timeout:
the tools answer as a stream. `RIDE_DOMAIN` can be left as it is: only Caddy reads it.

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

Everything lives in one place, the Docker volume `ride-data` unless you choose a folder (below): the registry and one library per rider. Back it up, or copy the backups
folder somewhere else. An update is a new image and a restart; each library migrates itself, after a backup of its own,
the first time its rider is served ([ADR 0022](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0022-versioned-schema-migrations.md)).

### Keep the data in a folder of your own

To have the data on a disk path you choose, rather than in a Docker volume, set `RIDE_DATA_PATH` in `deploy/.env`:

```bash
sudo mkdir -p /srv/agent-motoride && sudo chown 1000:1000 /srv/agent-motoride   # the container runs as uid 1000 (node)
echo 'RIDE_DATA_PATH=/srv/agent-motoride' >> deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d ride    # add the nginx override if you use one
```

The registry (`registry.db`), the riders' libraries (`tenants/`) and the backups are then ordinary files there, which you
can back up with your usual tools. To move data that is already in the volume (stop the server first):

```bash
docker compose -f deploy/docker-compose.yml stop ride
docker run --rm -v deploy_ride-data:/from -v /srv/agent-motoride:/to alpine sh -c 'cp -a /from/. /to/ && chown -R 1000:1000 /to'
```

(The volume is named after the folder the compose file is in: `docker volume ls` shows it.) Keep `RIDE_DATA_PATH` set from
then on; the old volume stays until you remove it.

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

Caddy passes only `/mcp` (the tools, with a token), `/health`, `/enrol` (a phone exchanging its one-time invitation), `/traffic` (the phone's traffic, with a token), `/roadbooks` and `/roadbook/<id>` (the phone's list of the rider's roadbooks and the roadbook file, with a token), and the live ride relay and its page (`/share/*`, `/follow/*`,
`/follow.js`, [Share a ride live](/live-sharing)). The administration stays inside the container: there
is no web page to log in to, and a rider can only be added from the machine. The container runs as an ordinary user, listens
on the loopback address of the host, and keeps nothing but the data volume. A token travels in a header, so the port
must never be reachable without TLS.

## Your own routing engine (optional)

### What Valhalla does here, and why run your own

[Valhalla](https://github.com/valhalla/valhalla) is the routing engine agentRide uses. It does two jobs: it routes between your points, and it
traces the road under a finished route (road class, name, tagged speed limit, country, roundabouts). The roadbook file's limits, countries and
roundabouts come from that trace.

By default agentRide asks the shared public server (`valhalla1.openstreetmap.de`): free, but shared and rate-limited, with no promise of service.
A long ride can hit its limit and an export then lacks limits for a leg. If your server has the room, it can run its own Valhalla for the countries
you ride in: planning gets faster, the shared limit goes away, and you decide when the map is updated.

### Where its map comes from, and why it gets old

Valhalla does not read OpenStreetMap live. It is built from an **extract**, a snapshot of a whole country that [Geofabrik](https://download.geofabrik.de/)
publishes about once a day, and the build turns it into routing tiles (hours of work). After the build the map is a snapshot: **its date is the day the
extracts were downloaded**. A road mapped, closed or re-signed in OpenStreetMap afterwards appears only after the next rebuild, and Valhalla cannot apply
single edits: every update is a full rebuild from fresh extracts.

| Comes from the Valhalla snapshot (as old as its last update) | Read live, not affected                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Routes, road classes, names                                  | Built-up land used for the 50 guess (Overpass)                     |
| Speed limits tagged in OpenStreetMap                         | Speed cameras (Overpass)                                           |
| The country of each stretch, roundabouts                     | Speed limit signs (Mapillary, if a token is set), weather, traffic |

The public server is updated by its operators on a schedule this project does not know.

**What it takes** (estimates, not measured: tell us what you see). For France and Belgium: about 6 GB of map downloads and 10 to 15 GB of disk; a first
build of one to a few hours (2 hours 10 minutes on one VPS) that wants 8 to 16 GB of memory while it runs; afterwards 2 to 4 GB of memory and one or two
cores to serve. Run the first build at a quiet hour.

### Set it up

1. Start it with the profile: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile valhalla up -d valhalla`. The first start
   downloads the extracts (`VALHALLA_TILE_URLS`, France and Belgium by default) and builds the tiles; follow it with `docker compose logs -f valhalla`.
   It builds the administrative boundaries (the countries of a roadbook come from them) and no elevation.
2. Once it answers, put `VALHALLA_URL=http://valhalla:8002` in `deploy/.env` and restart the server (`up -d ride`). Nothing is published: only the server reaches it.
   Check it: `docker compose exec ride node src/check.ts` (or `npm run check`) tests the route service it uses.

`VALHALLA_URL` can list several servers, separated by commas: `VALHALLA_URL=http://valhalla:8002,http://valhalla2:8002`. The server asks each one's
`/status` for the date its map was built (kept five minutes) and uses the newest; when it fails or is rebuilding, the next answers. `npm run check`
shows each one's map date. Put the public server in the list only if you want it to compete: its map is rebuilt often, so it would usually win.
Unset `VALHALLA_URL` and it goes back to the public server. The image is Valhalla's own,
[`ghcr.io/valhalla/valhalla-scripted`](https://github.com/valhalla/valhalla/tree/master/docker): read its README if a variable seems different. (Earlier
versions of this guide used the community image `gis-ops/docker-valhalla`, now archived; moving over means one rebuild, so run `deploy/update-map.sh`.)
The phone still asks the public server itself; having the phone use yours through the rider's server is the next step (ADR 0043).

### Keep the map current

Nothing refreshes it on its own: left alone, the map stays the one of the first start. Run `deploy/update-map.sh` from the `deploy` folder:

```
cd deploy
./update-map.sh            # asks first
./update-map.sh --yes      # does not ask (for cron)
```

It stops Valhalla, deletes the old extracts, recreates it so it downloads today's and rebuilds the tiles, waits until it answers, then recreates it once
more without the rebuild flag and prints the extract dates. It uses `docker-compose.single.yml`; set `MAP_COMPOSE_FILE=docker-compose.yml` for the other file.

- **Why the extracts are deleted.** `VALHALLA_REBUILD=True` alone only rebuilds from the files already on disk, so it spends hours rebuilding the same old map.
  The image downloads when the extracts are missing (seen on a real server). That is why you should not set the flag by hand.
- **What the phones see.** After a rebuild every roadbook is _outdated_ on the phone: the old file still works, and a tap makes the
  server trace it again on the new map, in the background, one roadbook at a time. The server does not go through the riders' libraries
  when the map changes: a rider's phone asking for its list is what starts a refresh, for a ride dated in the next two weeks.
- **How often.** About once a month. OpenStreetMap changes daily, but speed limits and roads change slowly. Weekly costs the same downtime for little gain.
- **Downtime.** While it builds (about 2 hours for France and Belgium) the server cannot route or build roadbook files, and there is no fallback to the
  public server. It needs about 20 GB of free disk while old and new files exist together. Pick a night.
- **Automatic.** At 3 am on the first of each month, in `crontab -e`: `0 3 1 * * cd /path/to/deploy && ./update-map.sh --yes >> update-map.log 2>&1`.
- **How old is my map?** `docker compose -f docker-compose.single.yml --profile valhalla exec valhalla ls -l /custom_files`: the dates of the two
  `.osm.pbf` files are the age of the map.
- **With two servers it rebuilds only the older one.** See the next section: the other keeps answering, so there is no downtime.
- **If the script stops half way.** It says why. If Valhalla ran out of memory, free some and run it again. If the container was left with the rebuild flag
  on, any restart would rebuild again: run `VALHALLA_REBUILD=False docker compose -f docker-compose.single.yml --profile valhalla up -d --force-recreate valhalla`
  once the build has finished.

### Two Valhalla servers: updates without downtime

A single own Valhalla is down for the 2 hours of each rebuild. With two, one keeps answering while the other rebuilds, and agentRide always
uses the one whose map is newest (it asks each one's `/status`, see `VALHALLA_URL` above). You pay for it twice in disk and memory.

**What it takes.** About 11 GB of disk per instance (the two extracts and the tiles), so about 22 GB, plus the temporary files of a build. Memory:
2 to 4 GB for each to serve, and 8 to 16 GB more while one builds. A server with 16 GB or more is comfortable; one with 8 GB should keep a single instance.

1. Create the second instance (its first build is a full one, about 2 hours, while the first keeps serving; run it at a quiet hour):
   `docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile valhalla2 up -d valhalla2`
   (for the single-container file, `-f deploy/docker-compose.single.yml`). Follow it with `docker compose logs -f valhalla2`.
2. In `deploy/.env`, list both: `VALHALLA_URL=http://valhalla:8002,http://valhalla2:8002`, and restart the server (`up -d ride`).
   `npm run check` then shows the map date of each.
3. From now on `deploy/update-map.sh` asks both instances when their map was built and rebuilds only the older one. The newest keeps serving
   meanwhile, and when the rebuilt one is done it is the newest and takes over. There is no switch to flip and no file to edit.

Because nothing goes down, you can run it more often: every week keeps the newest map under a week old (each run refreshes the older of the two,
so the pair alternates). A server that does not answer `/status` counts as the oldest and is rebuilt first. The public server is not in the list on
purpose: its map is rebuilt often, so it would usually win and yours would idle; add it only as a last resort you accept.

## Traffic for the phone (optional)

One server does it all: the same container serves the planning tools (MCP), the live ride relay and the phone's traffic. Traffic needs no key and no
set-up: by default (`TRAFFIC_PROVIDER=open-data`) the server reads **open government data**, the measured speeds of the main roads, and tells the
phone where the road ahead is slow (green, orange, red). It costs nothing per rider and sends your riders' positions to nobody.

**What it covers today: France only** (Belgium is next; more countries on request). Only roads the governments measure: the national roads outside the
motorway concessions, mostly near cities. Elsewhere the phone shows no traffic. After a restart the server needs about an hour to learn what each road's
normal speed is; until then it says "unknown". Set `TRAFFIC_PROVIDER=off` for none.

**TomTom (`tomtom-flow`).** You add your own [TomTom](https://developer.tomtom.com/) key and set `TRAFFIC_PROVIDER=tomtom-flow`. The key in
`TOMTOM_API_KEY` is also the planner's, so it never turns traffic on by itself. You accept TomTom's terms and answer for them and for the quota. Read
them first: as of 2026-10-23 they allow an evaluation key for evaluation only, forbid keeping results to serve several users (so the server asks
TomTom again for every rider's refresh, up to `TRAFFIC_MAX_PER_DAY`, 600 by default), and exclude turn-by-turn "navigation functionality" unless
TomTom agrees in writing. Whether showing traffic on a ride app falls under that is for you and TomTom to settle; this project cannot say.
It takes the place of the open data when you choose it.

- **Docker:** put `TOMTOM_API_KEY=...` and `TRAFFIC_PROVIDER=tomtom-flow` in `deploy/.env` (the compose file passes it in), then
  `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`.
- **NixOS:** `services.agent-motoride.environmentFile = "/run/secrets/agent-motoride.env";` with the lines `TOMTOM_API_KEY=...` and `TRAFFIC_PROVIDER=tomtom-flow` in that file.
- **The single-container file** (`deploy/docker-compose.single.yml`, no Caddy): the same lines; `--env-file` or a `.env` next to it.
- **Your own proxy:** pass `/traffic` too (it is in the example above); a proxy that lists paths answers 404 for it otherwise.

### Road signs for the roadbook files (optional)

The roadbook file takes its speed limits from OpenStreetMap, then guesses. With a [Mapillary](https://www.mapillary.com/developer) token in
`MAPILLARY_ACCESS_TOKEN` it also reads the speed limit signs seen in street-level photos near the route, and uses them where they are reliable
(see [Limits](limits.md)). The token is free: log in to Mapillary, register an application in its developer dashboard and copy its client token.
You accept Mapillary's terms of use and answer for them; read them before you share roadbook files with others. Without a token nothing changes.
The token goes in the same places as the TomTom key: `.env` for the terminal app, MCP and CLI; `deploy/.env` for Docker (the compose files pass it
in); the environment file for NixOS. Whoever builds a roadbook file needs it: the machine that runs the export (your computer, or the server for
the phone's downloads). Check it with `npm run check`.

Check it: `curl https://rides.example.org/health` says `"traffic":true`. The phone shows a traffic chip only then. The phone
sends the server seven points of the road ahead, so the server learns roughly where a rider rides: run it for people you trust.

## When something is wrong

| What you see                       | What to check                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `curl localhost:8788/health` fails | Port 8788 is published to the host only with the nginx override (`docker-compose.nginx.yml`); with Caddy it is reached only by Caddy |
| `curl …/health` fails              | `docker compose … ps`; the logs with `docker compose … logs ride caddy`; the domain's `A` record; ports 80 and 443 open              |
| A rider gets 401                   | The token is wrong or was replaced (`token` makes a new one and ends the old one), or the rider is suspended (`list`)                |
| A rider gets 429                   | More than 300 requests a minute or 5 open sessions: wait a minute, close a client                                                    |
| Certificate errors                 | Caddy needs the domain to point at this machine and port 80 open to get the certificate                                              |
| A rider forgot the token           | There is no recovery: `token` makes a new one                                                                                        |

## Costs and risks, plainly

You run a service for other people. Their libraries are not encrypted on disk (protect the machine and the backups),
their emails are in the registry, and you are the one to answer when it is down. Keep it to people you know, or read
the terms and privacy side before offering it widely.
