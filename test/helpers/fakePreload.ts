// Loaded with node --import before a child process (the MCP server in tests):
// every external service answers from the fakes, nothing leaves the machine.
import { installFakeServices } from "./fakeServices.ts";

installFakeServices();
