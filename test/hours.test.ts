import assert from "node:assert/strict";
import { test } from "node:test";
import { isOpenAt } from "../src/hours.ts";

test("opening hours: common tag forms", () => {
  const sunday = "2026-10-11";
  const monday = "2026-10-12";
  assert.equal(isOpenAt("Mo-We 06:30-18:00; Th-Sa 06:30-18:00; Su 06:30-12:00", sunday, "10:19"), "open");
  assert.equal(isOpenAt("Mo-We 06:30-18:00; Th-Sa 06:30-18:00; Su 06:30-12:00", sunday, "12:30"), "closed");
  assert.equal(isOpenAt("Mo-Sa 08:00-12:00,16:00-19:00", sunday, "10:00"), "closed");
  assert.equal(isOpenAt("Mo-Sa 08:00-12:00,16:00-19:00", "2026-10-10", "16:30"), "open");
  assert.equal(isOpenAt("24/7", sunday, "03:00"), "open");
  assert.equal(isOpenAt("Mo off; Tu-Sa 05:30-19:00; Su 05:30-13:00", monday, "09:00"), "closed");
  assert.equal(isOpenAt("Mo,We,Fr-Sa 06:00-17:00; Su 06:00-12:00; PH off", "2026-10-07", "09:00"), "open");
  assert.equal(isOpenAt("Mo,We,Fr-Sa 06:00-17:00; Su 06:00-12:00; PH off", "2026-10-08", "09:00"), "closed");
});

test("opening hours: unreadable tags are unknown, never open", () => {
  assert.equal(isOpenAt("sunrise-sunset", "2026-10-11", "09:00"), "unknown");
  assert.equal(isOpenAt('Mo-Fr 08:00-18:00 "by appointment"', "2026-10-12", "09:00"), "unknown");
  assert.equal(isOpenAt(null, "2026-10-11", "09:00"), "unknown");
  assert.equal(isOpenAt("", "2026-10-11", "09:00"), "unknown");
});

test("opening hours: days without hours are open those days at hours not given, closed the others", () => {
  const tuesday = "2026-10-06";
  const saturday = "2026-10-10";
  assert.equal(isOpenAt("Th-Su", tuesday, "12:42"), "closed", "a lunch place closed on Tuesdays");
  assert.equal(isOpenAt("Th-Su", saturday, "12:42"), "unknown");
  assert.equal(isOpenAt("Mo-Fr; Sa 09:00-12:00", saturday, "10:00"), "open");
  assert.equal(isOpenAt("Mo-Fr; Sa 09:00-12:00", "2026-10-11", "10:00"), "closed");
  assert.equal(isOpenAt("Mo-Fr; Sa 09:00-12:00", tuesday, "10:00"), "unknown");
});
