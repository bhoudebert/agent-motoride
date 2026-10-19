# 0028. Live sharing is an encrypted relay

- Status: accepted
- Date: 2026-10-19

## Context

A rider wants people to follow where they are, live, from a link in Discord, WhatsApp or a message, without anyone installing
anything. Someone has to pass the positions between the phone and the followers' browsers. Public relays have daily limits a
ride would exceed, and a hosted relay that reads positions would hold the most sensitive data the project touches.

## Decision

The multi-user server (ADR 0027) relays encrypted updates. The rider's phone makes a random channel identifier and a random
256-bit key, encrypts each position with AES-256-GCM, and posts the ciphertext with the rider's token. The follower's link
carries the channel in its path and the key in its fragment, which a browser never sends; the follower page fetches the
ciphertexts without any token, decrypts them in the browser with WebCrypto and draws them with MapLibre on OpenFreeMap
tiles. The server keeps the last 720 updates of a channel in memory, drops a channel 12 hours after its last update or on
the rider's say, and has no way to read a position. Knowing a channel identifier lets someone fetch ciphertext, which is
useless without the key; the key is as secret as the link. The phone shares the link with the system's share sheet, so it
goes to any app.

## Consequences

A hosted server sees who publishes and when, how much and how often, never where. A leaked link is a leaked ride until the
rider stops it, and a follower can pass the link on: sharing is by link, as with every service of the kind. Channels are
in memory, so a restart empties them (the phone creates the channel again and the follower's page keeps its trail). The
follower page loads MapLibre from a pinned CDN address with an integrity hash; self-hosting the file would remove that
dependency. Rate and size limits protect the server, not the rider's privacy.

## Alternatives considered

A relay that reads positions: simpler pages and server-side features (geofences, alerts), at the price of holding where
people are. The public ntfy.sh relay: limited to about 250 messages a day. Telegram live location: only for followers on
Telegram. Peer to peer: needs a signalling server anyway.
