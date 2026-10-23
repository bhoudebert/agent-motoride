import assert from "node:assert/strict";
import { test } from "node:test";
import { PUBLIC_VALHALLA, valhallaUrl } from "../src/http.ts";

const withEnv = (value: string | undefined, run: () => void) => {
  const before = process.env.VALHALLA_URL;
  if (value === undefined) delete process.env.VALHALLA_URL;
  else process.env.VALHALLA_URL = value;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env.VALHALLA_URL;
    else process.env.VALHALLA_URL = before;
  }
};

test("without VALHALLA_URL the public server is used", () => {
  withEnv(undefined, () => assert.equal(valhallaUrl(), PUBLIC_VALHALLA));
  withEnv("  ", () => assert.equal(valhallaUrl(), PUBLIC_VALHALLA));
});

test("VALHALLA_URL replaces it, read each time, without a trailing slash", () => {
  withEnv("http://valhalla:8002", () => assert.equal(valhallaUrl(), "http://valhalla:8002"));
  withEnv("https://routes.example.org/valhalla/", () =>
    assert.equal(valhallaUrl(), "https://routes.example.org/valhalla"),
  );
});

test("an address that is not http(s) is a mistake said at once", () => {
  withEnv("valhalla:8002", () => assert.throws(() => valhallaUrl(), /VALHALLA_URL/));
  withEnv("ftp://x/", () => assert.throws(() => valhallaUrl(), /must be http or https/));
  withEnv("not a url", () => assert.throws(() => valhallaUrl(), /is not a URL/));
});
