import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnswer, readAnswer } from "../src/schema.ts";

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

test("readAnswer: null for prose, so the planner can ask again", () => {
  assert.equal(readAnswer("The loop is 85 km."), null);
  assert.deepEqual(readAnswer(JSON.stringify(answer)), answer);
});

test("parseAnswer: ride object with date for rideDate and fields left out", () => {
  const raw = JSON.stringify({
    message: "Loop",
    ride: { routeId: "r2", date: "2026-10-18", departure: "08:00", name: "Loop" },
  });
  assert.deepEqual(parseAnswer(raw).ride, { routeId: "r2", rideDate: "2026-10-18", departure: "08:00", name: "Loop" });
  const bare = JSON.stringify({ message: "Loop", ride: { routeId: "r2" } });
  assert.deepEqual(parseAnswer(bare).ride, { routeId: "r2", rideDate: null, departure: null, name: "r2" });
});
