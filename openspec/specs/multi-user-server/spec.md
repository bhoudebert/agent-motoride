# Multi-user Server Specification

## Purpose

Let one agentRide instance serve several riders, each with a library of their own, reached by the MCP tools over HTTPS from Claude Code or Codex, while a rider who runs it alone sees no change (ADR 0027).

## Requirements

### Requirement: Alone, nothing changes

Without any server setting, agentRide SHALL work as before: one library in `data/agentmotoride.db`, the terminal commands and the stdio MCP server unchanged. The multi-user parts SHALL be off until a registry exists and the HTTP server is started.

#### Scenario: A rider who never sets it up

- **WHEN** agentRide runs without `RIDE_TENANT`, a registry or the HTTP server
- **THEN** it reads and writes `data/agentmotoride.db` exactly as before

### Requirement: Tenants and their tokens

The system SHALL keep a registry of tenants in its own SQLite file (`data/registry.db`, or `RIDE_REGISTRY`): for each a random identifier of 16 characters that is not derived from the email, the email address (lower case, unique), a status (active or suspended), the creation date and the time it was last seen. A tenant SHALL be given a token of 256 random bits shown once, when it is created or changed, and only a hash of it SHALL be kept. A token SHALL identify its tenant only while the tenant is active; an unknown token, a token of a suspended tenant and a token of a removed tenant SHALL identify nobody. Giving a new token SHALL end the old one at once.

#### Scenario: A lost token

- **WHEN** the administrator makes a new token for a tenant
- **THEN** the old token no longer identifies anybody and the new one does

### Requirement: One library per tenant

Each tenant SHALL have its own SQLite library at `data/tenants/<id>/agentmotoride.db`, created on first use and migrated by the versioned migrations of ADR 0022 when it is opened, so that an update changes no tenant until that tenant is next used and a backup is taken first. A tenant's data SHALL NOT be reachable with another tenant's token. An identifier that is not 8 to 40 letters, digits, hyphens or underscores SHALL be refused before it makes a path.

#### Scenario: Two riders

- **WHEN** two tenants save a roadbook each
- **THEN** each library holds only its own, and each is a separate file

### Requirement: Administration

A command `npm run admin` (and `nix run .#admin`) SHALL add a tenant by email and print its token and how to connect, list tenants (identifier, email, status, size of the library, last seen), remove a tenant (the library is kept aside, and deleted only with `--purge` and `--yes`), suspend and resume a tenant, give a new token, and back up the registry and every library to a dated folder using a consistent copy. Adding an email that is already registered, or removing a tenant that does not exist, SHALL fail with a message.

#### Scenario: Remove

- **WHEN** the administrator removes a tenant
- **THEN** its token stops working at once and its library is moved to `data/removed/` unless `--purge --yes` deletes it

### Requirement: The tools over HTTP

`npm run serve` SHALL serve the MCP tools over HTTP (the Streamable HTTP transport) at `/mcp`, with a health check at `/health`, on `RIDE_SERVER_HOST` and `RIDE_SERVER_PORT` (default 127.0.0.1:8788; TLS belongs to the proxy in front). Every request to `/mcp` SHALL carry `Authorization: Bearer <token>`; a missing, unknown, suspended or removed token SHALL be answered 401 with `WWW-Authenticate: Bearer` and reach nothing. Each MCP session SHALL be one rider's, over their library, holding that rider's routes, preferences and start point as the stdio server does; a session SHALL be reachable only with its rider's token, and any other token SHALL be answered as if the session did not exist. A rider suspended or removed SHALL be shut out of an open session at once. A rider SHALL have at most 5 open sessions and the server 200; a session idle for 30 minutes SHALL be closed; a rider SHALL be limited to 300 requests a minute (429 with `Retry-After`); a request body over 1 MiB SHALL be refused (413).

#### Scenario: Two riders, one server

- **WHEN** two riders connect with their own tokens and list their roadbooks
- **THEN** each gets only their own, and neither can open the other's session

### Requirement: Files stay in the rider's folder

On the server, every path a tool reads or writes SHALL be inside the rider's own folder (`data/tenants/<id>/`): exports go to its `exports/` by default, a relative path is taken from there, and an absolute path elsewhere, a path with `..` or a path with `~` SHALL be refused with a message saying files stay inside the rider's folder. This SHALL cover the GPX, Markdown and map exports, the track given to a review and the route file given to an import. The place-name state that depends on a rider's start point SHALL be that rider's own while their request is served.

#### Scenario: A path that leaves the folder

- **WHEN** a rider asks `exportGpx` to write `../../escape.gpx` or `/tmp/x.gpx`
- **THEN** the call fails with "files stay inside your own folder" and nothing is written

### Requirement: Choose a library from the terminal

The terminal commands and the stdio MCP server SHALL use a tenant's library when `RIDE_TENANT=<id>` is set, so that the administrator can look into a library, and SHALL fail with a clear message for an unknown identifier.

#### Scenario: Look into a library

- **WHEN** `RIDE_TENANT=<id> npm run rides -- roadbooks` runs
- **THEN** it lists that tenant's roadbooks
