import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
});

/** A `docker` that only writes down what it was asked, and the rebuild flag it was asked with. */
function fakeDocker(): { path: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "update-map-"));
  const log = join(dir, "calls.log");
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/sh\necho "$* [rebuild=\${VALHALLA_REBUILD:-}]" >> "${log}"\ncase "$*" in *"ps --status running"*) echo abc123;; esac\nexit 0\n`,
  );
  chmodSync(join(dir, "docker"), 0o755);
  return { path: dir, log };
}

test("update-map.sh is a runnable script that rebuilds Valhalla from fresh extracts and then clears the rebuild flag", () => {
  const script = new URL("../deploy/update-map.sh", import.meta.url).pathname;
  assert.ok(statSync(script).mode & 0o111, "it is executable");
  execFileSync("sh", ["-n", script]);
  const { path, log } = fakeDocker();
  const out = execFileSync(script, ["--yes"], {
    env: { ...process.env, PATH: `${path}:${process.env.PATH}` },
  }).toString();
  assert.match(out, /Done\./);
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => /\b(stop|run|up) /.test(l));
  assert.deepEqual(
    calls.map((l) => /(stop|run|up)\b/.exec(l)![1]),
    ["stop", "run", "up", "up"],
  );
  assert.ok(readFileSync(log, "utf8").includes("pull valhalla"), "it pulls the image first");
  assert.match(calls[1]!, /rm -f \/custom_files\/\*\.osm\.pbf/);
  assert.match(calls[2]!, /--force-recreate valhalla \[rebuild=True\]/);
  assert.match(calls[3]!, /--force-recreate valhalla \[rebuild=False\]/);
  for (const call of calls) assert.ok(call.includes("-f docker-compose.single.yml --profile valhalla"), call);
});

test("update-map.sh does nothing unless the rider says yes", () => {
  const script = new URL("../deploy/update-map.sh", import.meta.url).pathname;
  const { path, log } = fakeDocker();
  const out = execFileSync(script, [], {
    env: { ...process.env, PATH: `${path}:${process.env.PATH}` },
    input: "n\n",
  }).toString();
  assert.match(out, /Nothing done/);
  assert.ok(!readFileSync(log, "utf8").match(/\b(stop|run|up) /), "no command changed anything");
});
