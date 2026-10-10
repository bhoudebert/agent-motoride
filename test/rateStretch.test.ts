import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRatedRoads, rateStretch } from "../src/library.ts";
import { Store } from "../src/store.ts";
import { setGeoAnchor } from "../src/tools/geo.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";

const api = installFakeServices();
await setGeoAnchor("Lille");

test("rate a stretch: a road rating with its roads and cells, no roadbook", async () => {
  const store = new Store(":memory:");
  const { id, text } = await rateStretch(store, { from: "Lille", to: "Cassel", rating: 5, reason: "very nice" });
  assert.match(
    text,
    /^Rated 5\/5 \(#1\): D 938 \/ Rue de la Gare, .*, "very nice"\. These roads are now sought out by later plans/,
  );
  const [stored] = store.listRoadRatings();
  assert.deepEqual(
    [stored!.id, stored!.rideId, stored!.rating, stored!.reason, stored!.approximate],
    [id, null, 5, "very nice", false],
  );
  assert.ok(stored!.cells.length > 10, "the stretch's cells, for the rated-roads check");
  assert.equal(store.listRoadbooks().total, 0, "no roadbook");
  assert.match(formatRatedRoads(store), /^stretch #1 D 938 \/ Rue de la Gare.*: 5\/5, "very nice"/);
  const avoided = await rateStretch(store, { from: "Lille", to: "Cassel", rating: 0, reason: null });
  assert.match(avoided.text, /These roads are now avoided by later plans/);
  assert.equal(store.deleteRoadRating(avoided.id), true);
  assert.equal(store.listRoadRatings().length, 1);
});

test("rate a stretch: refused when it is a corner, a ride, or an invalid rating; nothing stored", async () => {
  const store = new Store(":memory:");
  await assert.rejects(
    rateStretch(store, { from: "Lille", to: "Cassel", via: ["Mont des Cats", "Lille"], rating: 4, reason: null }),
    /That is [\d.]+ km: a ride rather than a stretch/,
  );
  await assert.rejects(
    rateStretch(store, { from: "Lille", to: "Cassel", rating: 7, reason: null }),
    /from 0 \(never again\) to 5/,
  );
  api.legKm = 0.1;
  try {
    await assert.rejects(
      rateStretch(store, { from: "Lille", to: "Cassel", rating: 5, reason: null }),
      /are only 100 m apart by road: nothing rated\. Give the villages/,
    );
  } finally {
    api.legKm = undefined;
  }
  assert.equal(store.listRoadRatings().length, 0);
});
