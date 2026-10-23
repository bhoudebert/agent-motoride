import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { VALHALLA_CLIENT_ID } from "../src/http.ts";

// The public Valhalla server (FOSSGIS) asks apps that use it to send an identifying X-Client-Id.
test("the client id is a short name, and every request to the public Valhalla server sends it", () => {
  assert.equal(VALHALLA_CLIENT_ID, "agentmotoride");
  for (const file of ["src/tools/trip.ts", "src/check.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const calls = source.match(/fetchJson[^(]*\(\s*(?:`\$\{valhallaUrl\(\)\})/g)?.length ?? 0;
    const sent = source.match(/"X-Client-Id": VALHALLA_CLIENT_ID/g)?.length ?? 0;
    assert.ok(calls > 0, `${file} has no Valhalla call: update this test`);
    assert.equal(sent, calls, `${file}: ${calls} Valhalla requests, ${sent} send the client id`);
  }
});
