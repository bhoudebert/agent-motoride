import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** What the server shows to the internet (src/server.ts): every proxy example must pass these and nothing else. */
const PUBLIC = ["mcp", "health", "enrol", "traffic", "roadbooks", "roadbook/", "follow.js", "follow/", "share/"];

test("the server's own routes are the ones the proxy examples pass", () => {
  const server = read("src/server.ts");
  for (const p of [
    "/enrol",
    "/health",
    "/traffic",
    "/roadbooks",
    "/roadbook/",
    "/follow.js",
    "/follow/",
    "/share/",
    "/mcp",
  ])
    assert.ok(server.includes(`"${p}`), `${p} is a route of the server`);
});

test("Caddy, the NixOS module and nginx pass every public route", () => {
  for (const file of ["deploy/Caddyfile", "nix/modules/nixos-server.nix"]) {
    const line = read(file)
      .split("\n")
      .find((l) => l.includes("@exposed path"));
    assert.ok(line, `${file} has a list of exposed paths`);
    for (const p of PUBLIC) assert.ok(line.includes(`/${p}`), `${file} passes /${p}`);
  }
  const nginx = read("deploy/nginx.conf.example");
  for (const p of ["mcp", "health", "enrol", "traffic", "roadbooks", "roadbook/", "follow\\.js"])
    assert.ok(nginx.includes(p), `nginx passes ${p}`);
  assert.ok(nginx.includes("(follow|share)/"));
});

test("the compose file passes the traffic provider and key in, and the example says how to set it", () => {
  for (const file of ["deploy/docker-compose.yml", "deploy/docker-compose.single.yml"]) {
    const compose = read(file);
    assert.ok(compose.includes("TOMTOM_API_KEY: ${TOMTOM_API_KEY:-}"), `${file} passes the key`);
    assert.ok(compose.includes("TRAFFIC_MAX_PER_DAY"), `${file} passes the cap`);
    assert.ok(
      compose.includes("TRAFFIC_PROVIDER: ${TRAFFIC_PROVIDER:-open-data}"),
      `${file} passes the provider, open data by default`,
    );
  }
  assert.ok(read("deploy/.env.example").includes("TOMTOM_API_KEY"));
  assert.ok(read("nix/modules/nixos-server.nix").includes("environmentFile"));
});

test("the compose files hand VALHALLA_URL to the server and offer an own Valhalla only on request (profile)", () => {
  for (const file of ["deploy/docker-compose.yml", "deploy/docker-compose.single.yml"]) {
    const compose = read(file);
    assert.ok(compose.includes("VALHALLA_URL: ${VALHALLA_URL:-}"), `${file} passes the address`);
    assert.ok(/valhalla:\n\s+image: ghcr\.io\/valhalla\/valhalla-scripted/.test(compose), `${file} has the service`);
    assert.ok(compose.includes('profiles: ["valhalla"]'), `${file}: the service starts only with its profile`);
    assert.ok(compose.includes("build_admins:"), `${file}: the countries of a roadbook need the admin boundaries`);
    // The service block ends at the next service or at the top-level volumes.
    const block = compose.slice(compose.indexOf("\n  valhalla:\n")).split(/\n(?: {2}\w[\w-]*:\n|volumes:)/)[1] ?? "";
    assert.ok(block.includes("image:") && !block.includes("ports:"), `${file}: the service publishes nothing`);
  }
  assert.ok(read("deploy/.env.example").includes("VALHALLA_URL"));
  for (const file of ["deploy/docker-compose.yml", "deploy/docker-compose.single.yml"]) {
    const compose = read(file);
    assert.ok(
      /valhalla2:\n\s+image: ghcr\.io\/valhalla\/valhalla-scripted/.test(compose),
      `${file} has the second instance`,
    );
    assert.ok(compose.includes('profiles: ["valhalla2"]'), `${file}: the second instance is on request too`);
    assert.ok(compose.includes("valhalla2-data:/custom_files"), `${file}: the second instance has its own volume`);
  }
});

/**
 * A `docker` that only writes down what it was asked. FAKE_EXISTS lists the created instances, FAKE_BUILT_<name> the
 * map date an instance reports; an instance that has been brought up (rebuilt) reports a newer date from then on.
 */
function fakeDocker(): { path: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "update-map-"));
  const log = join(dir, "calls.log");
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/sh
echo "$* [rebuild=\${VALHALLA_REBUILD:-}]" >> "${log}"
svc=""; prev=""; last=""
for a in "$@"; do
  case "$prev" in exec) [ "$a" = "-T" ] || svc="$a";; -T) svc="$a";; esac
  last="$a"; prev="$a"
done
case "$*" in
  *" ps -a -q "*) for s in $FAKE_EXISTS; do [ "$s" = "$last" ] && echo "id-$s"; done; exit 0;;
  *" ps --status running -q "*) echo running; exit 0;;
  *" up "*) touch "${dir}/up_$last"; exit 0;;
  *" exec -T "*)
    case "$*" in *"/status"*)
      if [ -e "${dir}/up_$svc" ]; then echo '{"tileset_last_modified":4000000000}'; exit 0; fi
      case "$svc" in valhalla) b="$FAKE_BUILT_valhalla";; valhalla2) b="$FAKE_BUILT_valhalla2";; esac
      if [ -n "$b" ]; then echo '{"tileset_last_modified":'"$b"'}'; exit 0; fi
      exit 1;;
    esac
    exit 0;;
esac
exit 0
`,
  );
  chmodSync(join(dir, "docker"), 0o755);
  return { path: dir, log };
}

const script = new URL("../deploy/update-map.sh", import.meta.url).pathname;
/** A call without the compose file and profile flags, which name both instances. */
const without = (call: string) => call.replace(/^.*--profile valhalla2 /, "");
const run = (env: Record<string, string>, args: string[] = ["--yes"], input?: string) => {
  const { path, log } = fakeDocker();
  const result = spawnSync(script, args, {
    env: { ...process.env, ...env, PATH: `${path}:${process.env.PATH}` },
    input,
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const changing = calls.filter((l) => /\b(pull|stop|run|up) /.test(l));
  return { ...result, calls, changing };
};

test("update-map.sh is an executable, valid script", () => {
  assert.ok(statSync(script).mode & 0o111, "it is executable");
  execFileSync("sh", ["-n", script]);
});

test("update-map.sh rebuilds only the instance with the older map, from fresh extracts, and clears the rebuild flag", () => {
  const r = run({ FAKE_EXISTS: "valhalla valhalla2", FAKE_BUILT_valhalla: "2000", FAKE_BUILT_valhalla2: "1000" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Rebuilding valhalla2, the older one; the other keeps answering/);
  assert.deepEqual(
    r.changing.map((l) => /\b(pull|stop|run|up)\b/.exec(l)![1]),
    ["pull", "stop", "run", "up", "up"],
  );
  for (const call of r.changing) {
    assert.ok(/valhalla2( |$)/.test(without(call)), call);
    assert.ok(!/(^| )valhalla( |$)/.test(without(call)), `the other instance is not touched: ${call}`);
    assert.ok(call.includes("-f docker-compose.single.yml --profile valhalla --profile valhalla2"), call);
  }
  assert.match(r.changing[2]!, /rm -f \/custom_files\/\*\.osm\.pbf/);
  assert.match(r.changing[3]!, /--no-deps --force-recreate valhalla2 \[rebuild=True\]/);
  assert.match(r.changing[4]!, /--no-deps --force-recreate valhalla2 \[rebuild=False\]/);
});

test("update-map.sh picks the first instance when it is the older one", () => {
  const r = run({ FAKE_EXISTS: "valhalla valhalla2", FAKE_BUILT_valhalla: "1000", FAKE_BUILT_valhalla2: "2000" });
  assert.match(r.stdout, /Rebuilding valhalla, the older one/);
  for (const call of r.changing) assert.ok(!without(call).includes("valhalla2"), call);
});

test("update-map.sh rebuilds an instance that does not answer before one that does", () => {
  const r = run({ FAKE_EXISTS: "valhalla valhalla2", FAKE_BUILT_valhalla: "1000" });
  assert.match(r.stdout, /Rebuilding valhalla2, the older one/);
});

test("update-map.sh with one instance says routing is down while it builds", () => {
  const r = run({ FAKE_EXISTS: "valhalla", FAKE_BUILT_valhalla: "1000" });
  assert.match(r.stdout, /Rebuilding valhalla, the only one: routing is down/);
  assert.equal(r.changing.length, 5);
});

test("update-map.sh does nothing unless the rider says yes", () => {
  const r = run({ FAKE_EXISTS: "valhalla valhalla2", FAKE_BUILT_valhalla: "1", FAKE_BUILT_valhalla2: "2" }, [], "n\n");
  assert.match(r.stdout, /Nothing done/);
  assert.deepEqual(r.changing, []);
});

test("update-map.sh stops with a message when no Valhalla container exists", () => {
  const r = run({ FAKE_EXISTS: "" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No Valhalla container exists/);
  assert.deepEqual(r.changing, []);
});
