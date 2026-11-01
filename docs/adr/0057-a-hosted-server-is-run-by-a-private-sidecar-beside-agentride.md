# 0057. A hosted server is run by a private sidecar beside agentRide

- Status: proposed
- Date: 2026-11-01

## Context

Few riders will host a server (ADR 0027, `self-hosting`), and the MotoRide app, the chat connectors (ADR 0056) and the library
all need one. Offering a server to rent, bought from the app, needs what this repository has none of and should not have:
purchases and their receipts from Apple and Google, subscription state, accounts, terms, and the creation and deletion of riders
on the strength of a payment. That code handles money and secrets, is specific to one operator, and must not be public.

The server already has what a hosted service runs on: one library per rider in one instance (ADR 0027), invitations the phone
redeems for a token of its own (ADR 0029), sign-in for ChatGPT and Claude with a one-time code (ADR 0056), and rate limits and
suspension. What it lacks is a way for another program, not an administrator at a terminal, to create, change and delete riders,
and per-rider limits and features (traffic above all, which costs money per request).

## Decision

- **A separate private program, the sidecar, is the control plane.** It lives in its own private repository, with the same way of
  working as this one (specs, decision records, tests, CI). It verifies purchases, keeps the state of each subscription, and
  calls agentRide to create, change, suspend and delete riders. It is not in the data path: the phone, ChatGPT and Claude talk
  to agentRide directly, with the tokens agentRide made, so nothing is proxied and no API is duplicated.
- **agentRide gets a provisioning API**, off unless `RIDE_ADMIN_API=1` with a secret `RIDE_ADMIN_TOKEN`, served on its own
  port (`RIDE_ADMIN_PORT`, loopback by default) that no public proxy passes. It is JSON under `/admin/v1`, every call answers the
  same way when repeated (the sidecar will retry), and it is the only thing the sidecar may call:

  | Call                                             | Does                                                                                                                                                                                                  |
  | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `PUT /admin/v1/riders/<ref>`                     | Creates the rider known by `ref` (an opaque, unique reference the sidecar chooses, such as the subscription's original transaction) or returns it; sets its entitlements. No email is needed or kept. |
  | `POST /admin/v1/riders/<ref>/invitation`         | A one-time invitation for the phone, as `admin invite` makes: the link and the code, valid a few minutes.                                                                                             |
  | `PUT /admin/v1/riders/<ref>/entitlements`        | Replaces what the rider may use (below).                                                                                                                                                              |
  | `POST /admin/v1/riders/<ref>/suspend`, `/resume` | Shuts the rider out, or lets them back; nothing is lost.                                                                                                                                              |
  | `DELETE /admin/v1/riders/<ref>`                  | Deletes the rider and their library for good (the account deletion the stores require).                                                                                                               |
  | `GET /admin/v1/riders/<ref>`                     | Status, entitlements, size of the library, last seen.                                                                                                                                                 |

- **Entitlements are generic.** The sidecar decides what a plan is; agentRide only enforces: `traffic` (`off`, `open` data, or
  `tomtom` with the host's key), `trafficPerDay`, `libraryMb`, and `requestsPerMinute`. A rider with none set has what a self-hosted
  rider has today. The traffic switch gates both ways to it, the phone's `/traffic` and the `getTraffic` tool.
- **The app learns what it may use from `GET /me`**, with its own token: the entitlements and what is left of the day's traffic,
  so it can show or hide a feature and say why (`/health` stays about the server as a whole).
- **Identity is a purchase, not an account.** The app makes a random account token once and gives it to the store with the
  purchase (Apple's `appAccountToken`, Google's obfuscated account id); the sidecar maps a subscription to a rider through it, so
  restoring purchases on a new phone finds the same rider and there is no email, password or sign-up screen. Moving between
  Apple and Google is not covered.
- **The sign-up is one flow in the app**: choose a plan, pay with the store's own sheet, wait a few seconds while the sidecar
  creates the rider, and the app is enrolled by the invitation the sidecar returns, with nothing scanned or typed. The same screen
  then offers to connect ChatGPT or Claude with a one-time code (`POST /oauth/link-code`).
- **The three programs agree through contracts that are tested on both sides.** The provisioning API and `GET /me` are written
  in `openspec/` and in a machine-readable description kept in this repository; the sidecar's tests run against the published
  image of agentRide at the version it names, and this repository's tests fail when the description and the server differ. The
  sidecar's own HTTP API, which only the app calls, is owned and described by the sidecar, and the app's tests use that description.
- **Everything is off by default.** A self-hosted server without `RIDE_ADMIN_API` has no new route, no new port and no change.

## Consequences

The hosted offer can be built and replaced without touching what self-hosters run, and the part that is not open source holds
only what must not be: payment logic and operator secrets. The provisioning API is a new, powerful surface (it creates and
deletes libraries), so it stays on a private network, behind a long secret compared in constant time, with each call logged
(by reference and action, never a token); a leaked admin token is the worst case and is why it is not on the internet. One
instance holds every hosted rider, so a noisy rider is a risk, which the per-rider limits answer, and so is the instance itself:
backups and restore of every library matter more than before.

The sidecar must be reachable by the stores' notifications and by the app, so it is a public service of its own, with its own
availability: while it is down, nobody can buy or restore, but riders already enrolled keep working, since they never pass through
it. A rider whose subscription lapses is suspended, not deleted, for a grace period the sidecar decides.

## Alternatives considered

A proxy that makes the sidecar the front of agentRide, with each user registered twice: it duplicates the API, which drifts, and
puts every ride through a second program. One server per customer, created on payment: far heavier to run and update, for no gain
over libraries that are already isolated. An entitlement service of a third party between the stores and the sidecar: less
code to write, but another party that sees every purchase; the sidecar keeps the choice open behind one interface, and the
decision is its own (see its records). Putting the billing code in this repository behind a switch: it would be read by everyone,
and the rule "no secret in the open code" would rest on discipline alone.
