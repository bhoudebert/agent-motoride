#!/bin/sh
# Refreshes the map of your own Valhalla (the `valhalla` profile): downloads today's OpenStreetMap extracts and rebuilds
# the tiles. Routes and roadbook limits come from OpenStreetMap as of the last run of this script, so run it from time to
# time (about once a month; see docs/guide/self-hosting.md).
#
#   ./update-map.sh          asks first
#   ./update-map.sh --yes    does not ask (cron, timers)
#
# With one Valhalla (`valhalla`), routing is down while it builds (about 2 hours for France and Belgium). With two
# (`valhalla` and `valhalla2`, both created, VALHALLA_URL listing both) it rebuilds only the one whose map is older, and
# the other keeps answering: agentRide uses the one with the newest map. Needs about 20 GB of free disk per instance.
# Set MAP_COMPOSE_FILE to use another compose file than docker-compose.single.yml.
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
DC="$DC -f $FILE --profile valhalla --profile valhalla2"

# The instances that have been created (a started or stopped container).
INSTANCES=""
for s in valhalla valhalla2; do
  if [ -n "$($DC ps -a -q "$s")" ]; then INSTANCES="$INSTANCES $s"; fi
done
if [ -z "$INSTANCES" ]; then
  echo "No Valhalla container exists. Create it first: $DC up -d valhalla (docs/guide/self-hosting.md)." >&2
  exit 1
fi

# When the map of an instance was built (epoch seconds), 0 when it does not answer or does not say.
built() {
  out="$($DC exec -T "$1" sh -c 'curl -sf http://localhost:8002/status 2>/dev/null || wget -qO- http://localhost:8002/status 2>/dev/null' 2>/dev/null || true)"
  n="$(printf '%s' "$out" | sed -n 's/.*"tileset_last_modified": *\([0-9][0-9]*\).*/\1/p')"
  echo "${n:-0}"
}

# The instance with the older map (the first one when equal); an instance that does not answer counts as the oldest.
TARGET=""
TARGET_BUILT=""
for s in $INSTANCES; do
  b="$(built "$s")"
  echo "  $s: map built $([ "$b" -gt 0 ] && date -u -d "@$b" +%Y-%m-%d 2>/dev/null || echo unknown)"
  if [ -z "$TARGET" ] || [ "$b" -lt "$TARGET_BUILT" ]; then
    TARGET="$s"
    TARGET_BUILT="$b"
  fi
done
COUNT="$(echo "$INSTANCES" | wc -w)"

if [ "$COUNT" -gt 1 ]; then
  echo "Rebuilding $TARGET, the older one; the other keeps answering, so routing stays up."
else
  echo "Rebuilding $TARGET, the only one: routing is down while it builds (about 2 hours)."
fi

if [ "${1:-}" != "--yes" ]; then
  printf 'Go on? [y/N] '
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Nothing done."; exit 0; }
fi

# True once the instance answers inside its container. Needs curl or wget there; says so when it has neither.
answers() {
  $DC exec -T "$1" sh -c 'curl -sf http://localhost:8002/status >/dev/null 2>&1 || wget -qO- http://localhost:8002/status >/dev/null 2>&1'
}

# Waits until the instance answers, up to 8 hours; stops early when its container is no longer running.
wait_for_valhalla() {
  $DC exec -T "$1" sh -c 'command -v curl >/dev/null || command -v wget >/dev/null' || {
    echo "Cannot ask $1 if it is ready (no curl or wget in its container). Follow it with: $DC logs -f $1" >&2
    return 1
  }
  waited=0
  while [ "$waited" -lt 480 ]; do
    if answers "$1"; then return 0; fi
    if [ -z "$($DC ps --status running -q "$1")" ]; then
      echo "$1 stopped. Last lines of its log:" >&2
      $DC logs --tail 15 "$1" >&2
      return 1
    fi
    sleep 60
    waited=$((waited + 1))
    [ $((waited % 10)) -ne 0 ] || echo "  still building ($waited min)"
  done
  echo "$1 did not answer after 8 hours." >&2
  return 1
}

echo "1/4 Fetching the latest Valhalla image, then stopping $TARGET"
$DC pull "$TARGET"
$DC stop "$TARGET"

echo "2/4 Removing the old extracts of $TARGET, so fresh ones are downloaded"
$DC run --rm --no-deps --user root --entrypoint sh "$TARGET" -c 'rm -f /custom_files/*.osm.pbf /custom_files/file_hashes.txt'

echo "3/4 Downloading and building (follow it with: $DC logs -f $TARGET)"
# The rebuild flag stays on this container until step 4 recreates it: if this script stops before then, run step 4 by hand
# once the build has finished: VALHALLA_REBUILD=False $DC up -d --no-deps --force-recreate $TARGET
VALHALLA_REBUILD=True $DC up -d --no-deps --force-recreate "$TARGET"
wait_for_valhalla "$TARGET"

echo "4/4 Restarting $TARGET without the rebuild flag, so a restart of the server does not rebuild again"
VALHALLA_REBUILD=False $DC up -d --no-deps --force-recreate "$TARGET"
wait_for_valhalla "$TARGET"

echo "Done. Extracts and tiles of $TARGET:"
$DC exec -T "$TARGET" ls -l /custom_files
