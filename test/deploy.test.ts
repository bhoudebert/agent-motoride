import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** What the server shows to the internet (src/server.ts): every proxy example must pass these and nothing else. */
const PUBLIC = ["mcp", "health", "enrol", "traffic", "follow.js", "follow/", "share/"];

test("the server's own routes are the ones the proxy examples pass", () => {
  const server = read("src/server.ts");
  for (const p of ["/enrol", "/health", "/traffic", "/follow.js", "/follow/", "/share/", "/mcp"])
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
  for (const p of ["mcp", "health", "enrol", "traffic", "follow\\.js"])
    assert.ok(nginx.includes(p), `nginx passes ${p}`);
  assert.ok(nginx.includes("(follow|share)/"));
});

test("the compose file passes the traffic key in, and the example says how to set it", () => {
  const compose = read("deploy/docker-compose.yml");
  assert.ok(compose.includes("TOMTOM_API_KEY: ${TOMTOM_API_KEY:-}"));
  assert.ok(compose.includes("TRAFFIC_MAX_PER_DAY"));
  assert.ok(read("deploy/.env.example").includes("TOMTOM_API_KEY"));
  assert.ok(read("nix/modules/nixos-server.nix").includes("environmentFile"));
});
