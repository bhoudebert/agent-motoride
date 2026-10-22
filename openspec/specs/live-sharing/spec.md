# Live Sharing Specification

## Purpose

Let a rider share where they are, live, with people who follow from a link, without the server ever knowing where anyone rides (ADR 0028).

## Requirements

### Requirement: Encrypted on the rider's phone

A live ride SHALL be a channel with a random identifier of 128 bits and a random key of 256 bits, both made by the rider's phone. Every position update SHALL be encrypted on the phone with AES-256-GCM, a fresh random 96-bit nonce each time, with the channel identifier as associated data, and the server SHALL only ever receive and keep the nonce and the ciphertext. The key SHALL travel only in the fragment of the link followers open (`https://<server>/follow/<channel>#<key>`), which a browser never sends to a server. The server SHALL keep no key, no position in the clear and no list of channels a rider could be found by.

#### Scenario: What the server holds

- **WHEN** a rider shares a ride for an hour
- **THEN** the server holds a channel identifier, times, sizes and ciphertexts, and nothing from which a place can be read

### Requirement: The rider's side of the relay

The relay SHALL need the rider's token (spec multi-user-server) to create a channel, to publish to it and to end it, and SHALL need nothing to read it: whoever has the channel identifier can fetch the ciphertexts, and only whoever has the key can read them. `PUT /share/<channel>` SHALL create the channel (or confirm it for the same rider; another rider's token on an existing channel SHALL be refused with 409); `POST /share/<channel>` with `{iv, ct}` SHALL store one update and answer its sequence number; `DELETE /share/<channel>?mode=end` SHALL mark the ride ended (kept 30 minutes so followers see where it ended) and `?mode=stop` SHALL remove it at once. A rider SHALL have at most 3 channels open, the server 1000; an update SHALL be at most 2 KiB and a channel SHALL take at most one update every 2 seconds; a channel SHALL keep its last 720 updates and be removed 12 hours after its last update; a channel that does not exist SHALL be answered 404 so the phone can create it again after a restart.

#### Scenario: Another rider's token

- **WHEN** a second rider tries to publish to a channel the first created
- **THEN** the relay refuses it and changes nothing

### Requirement: The follower's side of the relay

`GET /share/<channel>?after=<n>` SHALL return, without any token, the state of the channel (`live` or `ended`), when it was last updated and the updates newer than `n`, each with its sequence number, time, nonce and ciphertext. `GET /follow/<channel>` SHALL serve the page followers open, whatever the channel, so that it reveals nothing about whether one exists. The page SHALL read the key from the link's fragment, fetch and decrypt the updates in the browser, and show the rider's position and trail on a map, the speed, how long ago the last update came, whether the ride is live or ended, and a clear message when nothing has come for two minutes or the link is wrong. When the last update carries the state `alert` (the rider's phone thinks they crashed, MotoRide spec crash-detection) it SHALL say **Possible crash** in red above everything else, whatever the age of that update, with advice to try to reach the rider and to call the emergency services with the position shown; the next update that is not an alert (the rider says they are fine) takes it back. It SHALL make no request that carries the key.

#### Scenario: A follower opens the link

- **WHEN** a follower opens the link in a browser
- **THEN** the map shows the rider's last position and trail, updating while the ride is live

#### Scenario: A possible crash

- **WHEN** the last update a follower's page has decrypted carries the state `alert`
- **THEN** the page says "Possible crash" in red with the position and advice to try to reach the rider and call the emergency services, until an update that is not an alert arrives

### Requirement: Nothing else is exposed

The relay SHALL accept only JSON, SHALL answer a body that is too big with 413 and SHALL not log channel identifiers, keys, tokens or ciphertexts. The follower page SHALL be served with a content security policy that allows only this server and the map's own sources, and no referrer.

#### Scenario: A link in a message

- **WHEN** a follower's browser follows a link from the page
- **THEN** the key is not sent to the other site
