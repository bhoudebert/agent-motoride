import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateForm, reviewDecisions, reviewForm } from "../src/elicit.ts";
import type { RideReview } from "../src/feedback.ts";

const placement = (proposedRating: number | null) => ({
  road: "D 938",
  from: "Cassel",
  to: "Steenvoorde",
  window: "10:32-10:42",
  km: 9,
  cells: [],
  approximate: false,
  proposedRating,
});
const note = (id: number, text: string) => ({
  id,
  rideId: 1,
  dayId: null,
  createdAt: "",
  text,
  rating: null,
  minutesBack: 10,
  status: "pending" as const,
  placement: null,
});
const review: RideReview = {
  ride: { id: 1, name: "Monts" },
  track: null,
  detours: [],
  notes: [
    { note: note(1, "awesome"), placement: placement(5), problem: null },
    { note: note(2, "hmm"), placement: placement(null), problem: null },
    { note: note(3, "late"), placement: null, problem: "outside the riding time" },
  ],
};

test("elicit: one rating and one dismiss box per placed note, proposals filled in", () => {
  const form = reviewForm(review)!;
  assert.deepEqual(Object.keys(form.requestedSchema.properties), ["rating_1", "dismiss_1", "rating_2", "dismiss_2"]);
  assert.equal(form.requestedSchema.properties.rating_1!.type, "integer");
  assert.equal((form.requestedSchema.properties.rating_1 as { default?: number }).default, 5);
  assert.equal("default" in form.requestedSchema.properties.rating_2!, false, "no proposal, no default");
  assert.equal(reviewForm({ ...review, notes: [review.notes[2]!] }), null, "nothing placed, nothing to ask");
});

test("elicit: answers become decisions; a note left blank is not rated", () => {
  assert.deepEqual(reviewDecisions(review, { rating_1: 4, dismiss_2: true }), [
    { noteId: 1, rating: 4 },
    { noteId: 2, dismiss: true },
  ]);
  assert.deepEqual(reviewDecisions(review, { rating_1: 4.5 }), []);
  assert.match(duplicateForm("97% the same roads as #7.").message, /Save it anyway/);
});
