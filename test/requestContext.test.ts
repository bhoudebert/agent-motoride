import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { currentContext, defaultContext, exportDir, inRoot, runInContext } from "../src/requestContext.ts";
import { setGeoAnchor, usePersistentGeoCache } from "../src/tools/geo.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";

test("alone there is no context: the default one is the process's, and paths are left as given", () => {
  assert.equal(currentContext(), defaultContext);
  assert.equal(inRoot("~/track.gpx"), "~/track.gpx");
  assert.equal(inRoot("/tmp/x.gpx"), "/tmp/x.gpx");
  assert.equal(exportDir("/project/exports"), "/project/exports");
});

test("on a server a path stays inside the rider's folder, a relative one from the folder asked", () => {
  const root = mkdtempSync(join(tmpdir(), "ride-root-"));
  runInContext({ fileRoot: root }, () => {
    assert.equal(inRoot("track.gpx"), join(root, "track.gpx"));
    assert.equal(inRoot("track.gpx", "exports"), join(root, "exports", "track.gpx"));
    assert.equal(inRoot(join(root, "exports", "a.gpx"), "exports"), join(root, "exports", "a.gpx"));
    assert.equal(exportDir("/project/exports"), join(root, "exports"));
    for (const bad of ["../x.gpx", "a/../../x.gpx", "/etc/passwd", "~/x.gpx", join(root, "..", "other", "x.gpx")])
      assert.throws(() => inRoot(bad), /stay inside your own folder/, bad);
  });
});

test("two riders served at once keep their own start point and place-name cache", async () => {
  installFakeServices();
  const results: string[] = [];
  const rider = (name: string, place: string, store: Record<string, string>) =>
    runInContext({}, async () => {
      usePersistentGeoCache({ get: (k) => store[k], set: (k, v) => void (store[k] = v) });
      const point = await setGeoAnchor(place);
      // Other work goes on between the two steps.
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(currentContext().anchor?.lat, point.lat, `${name} still has their own anchor`);
      results.push(`${name}:${point.lat.toFixed(2)}`);
      return store;
    });
  const aliceStore: Record<string, string> = {};
  const bobStore: Record<string, string> = {};
  await Promise.all([rider("alice", "Lille", aliceStore), rider("bob", "Cassel", bobStore)]);
  assert.deepEqual(results.sort(), ["alice:50.63", "bob:50.80"]);
  assert.equal(currentContext(), defaultContext, "and nothing leaked into the default context");
  assert.equal(defaultContext.anchor, undefined);
});
