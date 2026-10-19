# 0029. The phone joins with a one-time invitation, not a token in a QR code

- Status: accepted
- Date: 2026-10-19

## Context

A rider's token is 256 random bits: too long to type on a phone, and the first thing the MotoRide app needs to share a ride
or reach the library (ADR 0027, 0028). Sending it in a message or showing it as a QR code works, but then every copy of
the message, the screenshot or the image is the rider's access for good. A PIN that encrypts the QR code does not help much:
six digits are a million possibilities, which anyone holding the image can try offline in minutes.

## Decision

The administrator makes an **invitation**: a random one-time code (192 bits, kept as a hash), valid for 24 hours, shown as a
QR code in the terminal (and as a PNG or SVG file) inside the link `mobilemotoride://server?url=...&code=...`. The phone's
camera or the app opens the link; the app asks before it uses the server, then exchanges the code for a **token of its own**
at `POST /enrol`. The code works once. The token made then is separate from the rider's own token (the one of Claude Code or
Codex), so neither breaks the other, and it ends with the rider or with `admin devices --revoke`. An optional PIN of six
digits is checked **by the server** (three wrong tries burn the invitation), which makes six digits enough: it is a second
factor told another way than the QR code, not encryption.

## Consequences

A leaked QR code is worth nothing after its use or its expiry, so it can be sent by email or chat; with a PIN it is worth
nothing to whoever lacks the PIN either. The server holds invitations (hashes) and the phones' token hashes in the registry.
`/enrol` is the only unauthenticated write: it is limited in number, size and tries, and answers an unknown, used and
expired code alike. A phone's token is not named: revoking removes all of a rider's phones at once. Some camera apps do not
open a link with a custom scheme; an in-app scanner and an https page that opens the app are possible later.
