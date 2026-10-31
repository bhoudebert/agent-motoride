#!/bin/sh
# Refreshes the map of your own Valhalla (the `valhalla` profile): downloads today's OpenStreetMap extracts and rebuilds
# the tiles. Routes and roadbook limits come from OpenStreetMap as of the last run of this script, so run it from time to
# time (about once a month; see docs/guide/self-hosting.md).
#
#   ./update-map.sh          asks first
#   ./update-map.sh --yes    does not ask (cron, timers)
#
# Routing is down while it builds (about 2 hours for France and Belgium) and the server needs about 20 GB of free disk
# for it. Set MAP_COMPOSE_FILE to use another compose file than docker-compose.single.yml.
set -eu
cd "$(dirname "$0")"

FILE="${MAP_COMPOSE_FILE:-docker-compose.single.yml}"
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Docker Compose is not installed." >&2
  exit 1
fi
DC="$DC -f $FILE --profile valhalla"

if [ "${1:-}" != "--yes" ]; then
  printf 'Rebuild the map of Valhalla now? Routing is down for about 2 hours. [y/N] '
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Nothing done."; exit 0; }
fi

# True once Valhalla answers inside its container. Needs curl or wget there; says so when it has neither.
answers() {
  $DC exec -T valhalla sh -c 'curl -sf http://localhost:8002/status >/dev/null 2>&1 || wget -qO- http://localhost:8002/status >/dev/null 2>&1'
}

# Waits until Valhalla answers, up to 8 hours; stops early when its container is no longer running.
wait_for_valhalla() {
  $DC exec -T valhalla sh -c 'command -v curl >/dev/null || command -v wget >/dev/null' || {
    echo "Cannot ask Valhalla if it is ready (no curl or wget in its container). Follow it with: $DC logs -f valhalla" >&2
    return 1
  }
  waited=0
  while [ "$waited" -lt 480 ]; do
    if answers; then return 0; fi
    if [ -z "$($DC ps --status running -q valhalla)" ]; then
      echo "Valhalla stopped. Last lines of its log:" >&2
      $DC logs --tail 15 valhalla >&2
      return 1
    fi
    sleep 60
    waited=$((waited + 1))
    [ $((waited % 10)) -ne 0 ] || echo "  still building ($waited min)"
  done
  echo "Valhalla did not answer after 8 hours." >&2
  return 1
}

echo "1/4 Stopping Valhalla"
$DC stop valhalla

echo "2/4 Removing the old extracts, so fresh ones are downloaded"
$DC run --rm --no-deps --user root --entrypoint sh valhalla -c 'rm -f /custom_files/*.osm.pbf /custom_files/file_hashes.txt'

echo "3/4 Downloading and building (follow it with: $DC logs -f valhalla)"
# The rebuild flag stays on this container until step 4 recreates it: if this script stops before then, run step 4 by hand
# once the build has finished: VALHALLA_REBUILD=False $DC up -d --force-recreate valhalla
VALHALLA_REBUILD=True $DC up -d --force-recreate valhalla
wait_for_valhalla

echo "4/4 Restarting Valhalla without the rebuild flag, so a restart of the server does not rebuild again"
VALHALLA_REBUILD=False $DC up -d --force-recreate valhalla
wait_for_valhalla

echo "Done. Extracts and tiles:"
$DC exec -T valhalla ls -l /custom_files
