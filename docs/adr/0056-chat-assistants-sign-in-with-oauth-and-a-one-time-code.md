# 0056. Chat assistants sign in with OAuth and a one-time code, beside the token

- Status: accepted
- Date: 2026-11-01

## Context

The MCP endpoint (`/mcp`) is opened with the rider's token in `Authorization: Bearer` (ADR 0027). Claude Code, Codex and, in
the tests so far, a Claude custom connector accept that. ChatGPT's connector, set up on the web, offers OAuth or nothing: there
is no field for a header, so a rider cannot use their library from ChatGPT, and Claude's fixed header is documented as a beta for
a limited set of organizations. A chat assistant on the phone is how most riders would plan, so the server needs a sign-in these
clients know, without breaking the token that works today and without asking the rider for an account or a password: the
registry holds an email and a token hash, nothing else (ADR 0027, 0029).

## Decision

When the host turns it on (`RIDE_OAUTH=1`, with `RIDE_SERVER_URL` as the public https address), the server is also an OAuth 2.1
authorization server for `/mcp`, and the token keeps working as it does:

- **Discovery and registration.** `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, and
  `POST /oauth/register` (RFC 7591), where a client registers itself. A client may only ask to be sent back to addresses on a
  list: those of Claude, those of ChatGPT, and any the host adds (`RIDE_OAUTH_REDIRECTS`); anything else is refused, so nobody
  can have a code sent elsewhere. Clients are public (no secret); PKCE with S256 is required. Anyone may register, so what a
  client calls itself is neither kept nor shown: the page names it by the address it sends the rider back to ("Claude",
  "ChatGPT"), tells the rider to continue only if they started the connection themselves, and one set of addresses is one
  client however often it registers.
- **Sign-in with a one-time code.** `/oauth/authorize` shows a page that asks for a code, which the rider gets from the app
  (`POST /oauth/link-code`, with their token) or the administrator (`npm run admin -- link`). The code is 8 characters of an
  alphabet without look-alikes, lives ten minutes, works once, and only its hash is kept; the page allows 30 tries a minute in all.
  There is no password and no account page.
- **Tokens.** `/oauth/token` exchanges the authorization code (bound to the client, the address and the PKCE verifier, five
  minutes, once) for an access token (an hour) and a refresh token (90 days, rotated at each use). A code used twice ends the
  tokens it made. All are kept as hashes in the registry.
- **What a connection token opens.** Only `/mcp`, as the rider. Not `/rides`, `/roadbooks`, `/traffic` or the share relay: those stay
  for the rider's token and the phone's. A connection ends when the rider is suspended or removed, with
  `admin connections <rider> --revoke`, when the rider's token is changed (`admin token`) or their phones are stopped
  (`admin devices --revoke`), since a leaked token or a lost phone could have made one, or when its tokens expire.
- **A 401 on `/mcp` points at the discovery page** (`WWW-Authenticate: Bearer resource_metadata=…`) only when this is on; clients
  that send a token ignore it.

## Consequences

ChatGPT and Claude, on the web and on the phone once connected there, can use a rider's library, on a hosted server or a
self-hosted one, with no gateway of ours and with no data passing through anyone else. The rider's token, the phone's token and
every existing client are unchanged; with the setting off there is no new route. A later hosted offer (a sidecar that buys, creates
riders and hands the app a code) only has to call the same registry; the sign-in is not specific to it.

It is a new public surface that decides who may use a library, and the part to read twice: the list of redirect addresses, the
PKCE check, the single use of codes, and the hash-only storage are each covered by a test. The addresses of ChatGPT come from
guides, not from OpenAI's own text, and have not yet been tried on a real connection; the host can add the ones that turn out to
be needed. The page is plain and does not name the rider; the rider's email never leaves the registry. The one risk a code cannot remove is a
rider talked into typing it on a page someone else started (the attacker's assistant then gets the rider's library): the page says
so, but a rider who ignores it is exposed. With 30 tries a minute in all, an attacker cannot guess a code in its ten minutes, but can
use up the tries so a rider has to wait a minute. A rider cannot see or end a
single connection from the app yet, only all of them through the administrator.

## Alternatives considered

A gateway of ours in front of every server (one public connector, a lookup, a proxy): it puts every ride through a machine we run
and duplicates the API, which drifts. A password or an email link on the sign-in page: an account system this project does not
have, and a mail service to run. Sign in with the rider's token pasted on the page: a long secret typed or pasted into a web page
of a connector, and one that opens everything. Accepting a connection token on the phone's endpoints too: more power than a chat
assistant needs, for no use.
