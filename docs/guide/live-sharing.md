# Share a ride live

A rider can share where they are, live, with people who follow from a link: in a message, in Discord, anywhere. The
followers install nothing and open the link in a browser. The server that relays the positions **cannot read them**.

::: tip Where this is
The relay and the page followers open run in the server for several riders ([Host it yourself](/self-hosting)). The
MotoRide app shares a ride from its ride screen: set the server once by scanning an invitation
([Run it for several riders](/several-riders)), switch "Share this ride live" on, and send the link.
:::

## What a follower sees

The link opens a map with the rider's last position and trail, the speed, how long ago the last update came, and whether the
ride is live, stopped or ended. If nothing comes for two minutes it says so, in red, instead of showing an old dot as if it
were now. A ride that ends stays on the map for 30 minutes, so followers can see where it finished.

## How it stays private

1. The rider's phone makes a random **channel** and a random **256-bit key**.
2. It encrypts every position with AES-256-GCM before it leaves the phone.
3. The link is `https://<server>/follow/<channel>#<key>`. Everything after the `#` stays in the browser: a browser never
   sends it to a server.
4. The page downloads the encrypted updates and decrypts them with the key from the link, in the browser.

So the server holds a channel name, times, sizes and encrypted bytes, and nothing from which a place can be read, even if
somebody else runs it for you. Anyone who has the **whole link** can follow, and can pass it on: share it like a key. The
rider can stop sharing at any time, which removes the ride at once.

## Limits, so one rider cannot hurt the server

A rider has 3 rides shared at most, an update is at most 2 KiB and one is accepted every 2 seconds, a ride keeps its last
720 updates (six hours at one every 30 seconds) and disappears 12 hours after its last update. The rides live in memory: if
the server restarts they are gone, and the phone creates its ride again.

## For the person running the server

The relay needs no setting. Put `/share/*`, `/follow/*`, `/follow.js` and `/enrol` behind your proxy next to `/mcp` (the Caddy file and
the NixOS module in the repository already do). The page loads the map library from a pinned address with an integrity hash
and the map from OpenFreeMap. The server logs no channel, key, token or position. How it is built:
[ADR 0028](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0028-live-sharing-is-an-encrypted-relay.md).
