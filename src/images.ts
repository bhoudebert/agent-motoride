// Images the rider attaches to a request: a photo of a paper map, a
// screenshot of a route, a handwritten list of towns. The planner reads them;
// the code only checks they are images it may send.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

export interface RideImage {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64 of the file. */
  data: string;
}

/** The API accepts images up to 5 MB each. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The format from the file's first bytes, whatever its extension says. */
function sniff(bytes: Buffer): RideImage["mediaType"] | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  return null;
}

export function readImage(path: string): RideImage {
  const size = statSync(path).size;
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`${basename(path)} is ${(size / 1024 / 1024).toFixed(1)} MB; images are limited to 5 MB.`);
  }
  const bytes = readFileSync(path);
  const mediaType = sniff(bytes);
  if (!mediaType) throw new Error(`${basename(path)} is not a PNG, JPEG, WebP or GIF image.`);
  return { name: basename(path), mediaType, data: bytes.toString("base64") };
}
