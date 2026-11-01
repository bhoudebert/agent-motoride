// Writes docs/hosted-provisioning.openapi.json from the schemas the server validates with (ADR 0057): `npm run docs:contract`.
import { writeFileSync } from "node:fs";
import { openApiDocument } from "../src/hostedContract.ts";

writeFileSync(
  new URL("../docs/hosted-provisioning.openapi.json", import.meta.url),
  `${JSON.stringify(openApiDocument(), null, 2)}\n`,
);
console.log("Wrote docs/hosted-provisioning.openapi.json");
