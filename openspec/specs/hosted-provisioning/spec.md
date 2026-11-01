# Hosted provisioning Specification

How a program other than an administrator at a terminal creates, limits and removes riders on a server (ADR 0057): a private
sidecar that sells a hosted server calls this API; nothing here is used by a self-hosted server that does not turn it on.

## Purpose

Let a service that handles purchases run riders on this server without a human, safely, and let the app know what a rider may use.

## Requirements

### Requirement: Off unless asked for

The provisioning API SHALL exist only when `RIDE_ADMIN_API` is on and `RIDE_ADMIN_TOKEN` (or the file named by `RIDE_ADMIN_TOKEN_FILE`, which takes precedence) holds a secret of at least 32 characters. It SHALL be served on a port of its own (`RIDE_ADMIN_PORT`, default 8789) on `RIDE_ADMIN_HOST` (default 127.0.0.1; 0.0.0.0 inside a container, on a network that only the calling program shares), never on the port riders use, and the proxies of the deployment examples SHALL NOT pass it. With it off, the server SHALL open no new port and add no route. With it on and a secret that is missing or too short, the server SHALL refuse to start the API and say why.

#### Scenario: A self-hosted server

- **WHEN** `RIDE_ADMIN_API` is not set
- **THEN** no admin port is opened and `/admin/v1` does not exist on any port

#### Scenario: A weak secret

- **WHEN** `RIDE_ADMIN_API` is on and `RIDE_ADMIN_TOKEN` is 12 characters long
- **THEN** the API does not start and the log says the secret is too short

### Requirement: Authentication

Every call SHALL carry `Authorization: Bearer <RIDE_ADMIN_TOKEN>`; the secret SHALL be compared in constant time, and a missing or wrong one SHALL be answered 401 with no detail and nothing done. A rider's token, a phone's token and a chat connection's token SHALL NOT open any `/admin/v1` call. Each call SHALL be logged as one line of method, action, a short hash of the rider's reference and the status, and never a token, a code or the reference itself.

#### Scenario: A rider's token

- **WHEN** a call carries a rider's own token
- **THEN** it is answered 401

### Requirement: Riders by reference

`PUT /admin/v1/riders/<ref>` SHALL create the rider known by `<ref>` (8 to 128 of letters, digits, `.`, `_`, `:`, `-`, chosen by the caller and opaque here) and answer 201, or answer 200 with the rider when it exists; repeating a call SHALL change nothing more. No email SHALL be needed or kept: the rider SHALL have a placeholder address that cannot receive mail and no token of their own. A body with `entitlements` SHALL set them. `GET /admin/v1/riders/<ref>` SHALL answer the reference, the identifier, the status (`active` or `suspended`), the entitlements, the size of the library in bytes, when the rider was created and last seen (any authenticated request counts: the rider's token, a phone's, or a chat connection's; recorded at most once a minute), how many phones are enrolled now and when the first of them was (`devices`, `enrolledAt`; a rider may have several phones, each invitation redeemed makes one), or 404.

#### Scenario: A webhook delivered twice

- **WHEN** the same `PUT` arrives twice
- **THEN** one rider exists, the first answer is 201 and the second 200

### Requirement: Invitation for the phone

`POST /admin/v1/riders/<ref>/invitation` SHALL make a one-time invitation for the rider's phone as `admin invite` does, valid for 15 minutes or the `minutes` asked for (1 to 60), and answer the code, the link `mobilemotoride://server?url=<RIDE_SERVER_URL>&code=<code>` and the expiry. A suspended rider SHALL be answered 409. The phone SHALL exchange the code at `/enrol`; the code SHALL work once.

#### Scenario: A purchase completes

- **WHEN** the caller creates a rider and asks for an invitation
- **THEN** the phone enrols with the code and receives a token of its own, and the same code no longer works

### Requirement: Entitlements

`PUT /admin/v1/riders/<ref>/entitlements` SHALL replace what the rider may use, with any of `traffic` (`off`, `open` or `tomtom`), `trafficPerDay` (0 to 100000), `libraryMb` (1 to 100000) and `requestsPerMinute` (10 to 6000); anything else, or a value out of range, SHALL be answered 400 and change nothing. A rider with none set SHALL have what the host configured. A change SHALL apply to the rider's next request, including in an open session. The server SHALL enforce them: `traffic: off` SHALL answer the phone's `/traffic` with 403 `traffic_not_included` and the `getTraffic` tool as unavailable; `traffic: open` SHALL serve the phone's traffic from open data only and the tool as unavailable; `traffic: tomtom` SHALL use the host's TomTom, counting a point of the phone's traffic and a call of the tool as one request each against `trafficPerDay` for the UTC day and answering 429 `daily_limit` beyond it; `libraryMb` SHALL refuse an upload of a recorded ride or a roadbook that would pass it (413 `library_full`); `requestsPerMinute` SHALL replace the default of 300 for the rider.

#### Scenario: Traffic not in the plan

- **WHEN** a rider with `traffic: off` is asked for traffic by the phone and by their assistant
- **THEN** the phone gets 403 `traffic_not_included` and the tool answers that traffic is not included, and TomTom is not called

#### Scenario: A day's allowance used up

- **WHEN** a rider with `traffic: tomtom` and `trafficPerDay: 20` has used 20 requests today
- **THEN** the next request is answered 429 `daily_limit` and TomTom is not called, and the allowance is full again at 00:00 UTC

### Requirement: Lost phone

`DELETE /admin/v1/riders/<ref>/devices` SHALL end every phone token of the rider, every chat connection and every unused invitation, as `admin devices --revoke` does, and answer how many phone tokens were ended; the rider and the library SHALL stay, and a new invitation enrols a phone again.

#### Scenario: A phone is lost

- **WHEN** the caller revokes the devices of a rider who has two phones, then asks for an invitation
- **THEN** both phones are answered 401, `devices` is 0, and a phone that redeems the new code works

### Requirement: Suspend, resume, delete

`POST /admin/v1/riders/<ref>/suspend` and `/resume` SHALL shut the rider out or let them back, keeping everything; `suspend` MAY carry a `reason` (a short lowercase word the app can translate, `lapsed` when none is given) and an `until` date, which `GET /me` gives back while the rider is suspended. `DELETE /admin/v1/riders/<ref>` SHALL delete the rider, their tokens, invitations, connections and library for good, and answer 200 (404 when there is none); a deleted rider SHALL be shut out at once, in an open session too. The reference SHALL be free to be used again.

#### Scenario: Account deletion

- **WHEN** the caller deletes a rider whose phone is connected
- **THEN** the phone's next request is answered 401 and the library is gone from the disk

### Requirement: What the rider may use

`GET /me`, with a rider's, a phone's or a connection's token, SHALL answer whether the rider is hosted, a stable opaque `riderRef` (`rr-` and the first 16 hex characters of the rider's random identifier: the same for every phone of the rider, too short to name the library on disk, so the app can tell one library from another), the traffic mode (`off`, `open`, `tomtom`, or `host` when none is set) with the allowance per day and the requests used today, the library limit and size in bytes, and the requests a minute, so that the app shows or hides a feature and says why. A request without a valid token SHALL be answered 401, but a suspended rider's phone SHALL be answered 200 with `suspended` (the reason and `until`, or null) so that the app says the server is paused and not that the token is bad, while every other call of that rider stays refused.

#### Scenario: A paused server

- **WHEN** a rider whose subscription lapsed and who was suspended with the reason `lapsed` asks `GET /me` from their phone
- **THEN** the answer is 200 with `suspended` set, and their roadbooks and rides are still refused with 401

#### Scenario: The app asks

- **WHEN** a hosted rider with `traffic: open` asks `GET /me`
- **THEN** the answer says `open`, and the library size and limit

### Requirement: The contract is written and kept in step

The calls and their answers SHALL be described in `docs/hosted-provisioning.openapi.json`, generated from the schemas the server validates with; a test SHALL fail when the file differs from what the code generates, and the tests of the API SHALL check every answer against the same schemas, so the program that calls the API can test against this description.

#### Scenario: A field is added

- **WHEN** a field is added to an answer without regenerating the description
- **THEN** the tests fail
