import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnswer } from "../src/schema.ts";

const ride = { routeId: "r2", rideDate: "2026-10-17", departure: "09:00", name: "Artois loop" };
const answer = { message: "Artois loop, 146 km", ride };

test("parseAnswer: bare JSON, as the API returns it", () => {
  assert.deepEqual(parseAnswer(JSON.stringify(answer)), answer);
});

test("parseAnswer: JSON in a code fence, as models without structured output write it", () => {
  const raw = "```json\n" + JSON.stringify(answer, null, 1) + "\n```";
  assert.deepEqual(parseAnswer(raw), answer);
});

test("parseAnswer: JSON after a line of prose", () => {
  assert.deepEqual(parseAnswer("Here is the ride:\n" + JSON.stringify(answer)), answer);
});

test("parseAnswer: ride given as one string is split into route id, date and name", () => {
  const raw = JSON.stringify({ message: "Loop", ride: "r2_2026-10-17_Winding_Artois_Loop" });
  assert.deepEqual(parseAnswer(raw), {
    message: "Loop",
    ride: { routeId: "r2", rideDate: "2026-10-17", departure: null, name: "Winding Artois Loop" },
  });
});

test("parseAnswer: a plain answer keeps ride null", () => {
  assert.deepEqual(parseAnswer(JSON.stringify({ message: "Yes", ride: null })), { message: "Yes", ride: null });
});

test("parseAnswer: prose or a wrong shape is shown as the message, with no ride", () => {
  assert.deepEqual(parseAnswer("No loop fits."), { message: "No loop fits.", ride: null });
  const wrong = JSON.stringify({ text: "no message field" });
  assert.deepEqual(parseAnswer(wrong), { message: wrong, ride: null });
});
