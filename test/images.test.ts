import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_IMAGE_BYTES, readImage } from "../src/images.ts";

const dir = mkdtempSync(join(tmpdir(), "ride-images-"));
const file = (name: string, bytes: Buffer) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

test("images: the format comes from the bytes, not the extension", () => {
  const png = readImage(new URL("../evals/fixtures/sketch-loop.png", import.meta.url).pathname);
  assert.equal(png.mediaType, "image/png");
  assert.equal(png.name, "sketch-loop.png");
  assert.ok(Buffer.from(png.data, "base64").length > 1000);
  const jpeg = readImage(file("photo.png", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])));
  assert.equal(jpeg.mediaType, "image/jpeg", "a JPEG named .png is a JPEG");
  const webp = readImage(
    file("x.webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])),
  );
  assert.equal(webp.mediaType, "image/webp");
  assert.equal(readImage(file("x.gif", Buffer.from("GIF89a...."))).mediaType, "image/gif");
});

test("images: anything else, or too big, is refused before any model call", () => {
  assert.throws(() => readImage(file("notes.jpg", Buffer.from("%PDF-1.7"))), /not a PNG, JPEG, WebP or GIF/);
  assert.throws(() => readImage(file("huge.png", Buffer.alloc(MAX_IMAGE_BYTES + 1))), /limited to 5 MB/);
});
