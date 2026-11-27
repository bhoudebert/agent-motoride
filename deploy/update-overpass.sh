#!/bin/sh
# Refreshes your own Overpass (the `overpass` profile): empties its database and imports today's extracts again.
# Cameras and stops come from OpenStreetMap as of the last run of this script, so run it from time to time (about once
# a month; see docs/guide/self-hosting.md).
#
#   ./update-overpass.sh          asks first
#   ./update-overpass.sh --yes    does not ask (cron, timers)
#
# While it imports, your Overpass does not answer and agentRide asks the public Overpass servers instead: nothing is down,
# but a lookup waits for them as it did before you ran your own. The import takes a while (minutes for Belgium and the north
# of France, more on a small server). Set MAP_COMPOSE_FILE to use another compose file than docker-compose.single.yml.
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
DC="$DC -f $FILE --profile overpass"

if [ -z "$($DC ps -a -q overpass)" ]; then
  echo "No Overpass container exists. Create it first: $DC up -d overpass (docs/guide/self-hosting.md)." >&2
  exit 1
fi

if [ "${1:-}" != "--yes" ]; then
  printf "Empty your Overpass and import today's extracts again? The public servers answer meanwhile. [y/N] "
  read -r answer
  case "$answer" in y | Y | yes) ;; *) echo "Nothing changed."; exit 0 ;; esac
fi

echo "Stopping Overpass and emptying its database..."
$DC stop overpass
$DC run --rm --no-deps --entrypoint sh overpass -c 'find /db -mindepth 1 -delete'
echo "Importing again (the extracts are downloaded, merged and converted first)..."
$DC up -d --force-recreate overpass

# It answers once the import is done: the first query that returns JSON.
tries=0
while [ "$tries" -lt 360 ]; do
  out="$($DC exec -T overpass sh -c 'wget -qO- "http://localhost/api/interpreter?data=%5Bout:json%5D;node(1);out;" 2>/dev/null || true' 2>/dev/null || true)"
  case "$out" in *'"elements"'*) echo "Overpass answers again."; exit 0 ;; esac
  tries=$((tries + 1))
  sleep 30
done
echo "Overpass does not answer after 3 hours. See: $DC logs overpass" >&2
exit 1
