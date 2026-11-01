# With or without a server

The MotoRide app does not need a server. A server is something you add: your own ([Host it yourself](/self-hosting)) or one
someone runs for you ([Run it for several riders](/several-riders)). This page says what the app does in each case, as of
app release 1.5.0. Without a server nothing shows an error and nothing is greyed out: what needs a server is simply not
offered.

## What works with no server

| You want to                      | How it works without a server                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Get a roadbook                   | Import a roadbook file (`.motoride.json`) or a GPX from the phone, or open an import link; the link can point at any http(s) address. Importing the file again refreshes the roadbook.                     |
| Navigate                         | Instructions, corner warnings, voice, off route and rejoin, wrong way, skip a point. Skip, the approach to the start and the rejoin ask the public Valhalla; offline they draw a straight line and say so. |
| See limits and cameras           | They come from the roadbook file. For an imported GPX the phone completes them from public Valhalla and Overpass; offline the GPX is kept without limits and offers "complete" later.                      |
| Read the gauges                  | Heading, altitude, slope, lean and braking G come from the phone's own sensors.                                                                                                                            |
| Record a ride                    | Kept on the phone: review, replay, share with the share sheet, delete (with a warning when the ride exists nowhere else).                                                                                  |
| Weather ahead                    | Straight from MET Norway; needs network.                                                                                                                                                                   |
| Fuel stops, find along the route | Straight from public Overpass servers; needs network. "Where to?" uses Nominatim and public Valhalla.                                                                                                      |
| Crash detection                  | All on the phone. With no live share the alert offers "Message `<contact>`" and "Call 112" for you to tap: the app tells no one by itself.                                                                 |
| Settings, offline map, language  | Stored on the phone.                                                                                                                                                                                       |

Services that are not yours (Valhalla, Overpass, MET Norway, Nominatim, OpenFreeMap) see the requests the phone makes to
them, with the places in them. Your own server is the way to keep that to a machine you trust.

## What a server adds

| Feature                      | Without a server                                       | With a registered server                                                                                                                  |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Roadbooks made on the server | Not listed; import files by hand                       | Listed as "On your server", downloaded, updated when outdated ("preparing" while the server makes the file)                               |
| Refresh of a roadbook        | Import the file again                                  | The server rebuilds the file with its map, then the phone updates                                                                         |
| Rides kept off the phone     | Only the phone has them                                | Upload at the end of a ride or from My Rides; the list shows "Only on this phone", "On your server, sent `<date>`", "Only on your server" |
| Learning from a ride         | None                                                   | A recorded ride you upload can lead to lower speed limits that you confirm in your assistant ([Limits](/limits))                          |
| Live sharing                 | The choice is not shown                                | "Share this ride live" before Start; the crash alert then reaches the people following                                                    |
| Traffic ahead                | No chip, no request                                    | The chip appears when the server reports that traffic is on (open government data in France by default)                                   |
| Server screen                | Says what a server adds and links to the hosting guide | Shows what this server brings, a Test button, joining with an invitation, link or QR                                                      |

Deleting a ride from the phone never deletes it from the server, and "Remove from your server" never touches the phone's copy.

## What it looks like

Screens of the Android app with made-up rides and a made-up server.

![The Server screen: what this server brings, the address and a masked token, Test and Remove](/app/server.png)

_The Server screen. It lists what the registered server brings, here live sharing and traffic. With no server it says what a server adds and that the app works fully without one._

![My rides with three rides: on your server and sent, only on this phone, only on your server](/app/my-rides.png)

_My rides with a server: the three marks, "On your server, sent …", "Only on this phone" and "Only on your server", and the upload, download and remove-from-server icons. Without a server only the rides on the phone are listed, with no marks and no upload icon._

![The roadbook list with roadbooks on your server: map out of date, under refresh, not made yet, and one downloaded](/app/roadbooks.png)

_The roadbook list with a server: a roadbook whose map is out of date, one under refresh, one not made yet and one downloaded to the phone. Without a server only the downloaded roadbooks are listed._

![The ride screen in demo mode: next instruction, direction chevrons, speed limit and the corner ahead](/app/ride.png)

_The ride screen (here in demo mode, so the speed shown is not real): navigation, limits and corner warnings need no server._

![The menu: Roadbooks, Go to a place, My rides, Safety, Server, Import a roadbook, Voice, Language, Theme](/app/menu.png)

_The menu, with Server between Safety and Import a roadbook._

## What is not there yet

- **Settings are not synced.** Each phone keeps its own; accounts and sync are on the [roadmap](https://github.com/bhoudebert/agent-motoride/blob/main/ROADMAP.md).
- **The app is not in the stores.** The iOS app is on TestFlight, the Android app a file on the release page.
- **Traffic is France only** for now, and elsewhere a point shows no traffic.
- **Lean and G on an iPhone** are not yet checked against real rides.

The planning itself (talking to your assistant to plan, rate and review rides) is a server or desktop feature in every
case: the phone app rides what was planned.
