# Run it for several riders

Used alone, agentMotoride is one library on your machine and nothing here applies to you. If you want to serve a few
riders (family, a club, friends) from one machine, one instance can hold a library for each of them. They reach it from
Claude Code or Codex through the tools, with a token of their own. Nobody's plan runs on your model or your key: the
rider's own model does the planning.

::: warning In progress
The administration is in place (below). The part that lets Claude Code and Codex connect over the network is the next
step, so the connection lines printed by `add` do not work yet.
:::

## What you set up

- A **registry** of riders, a small SQLite file (`data/registry.db`): for each an identifier (random, not made from the
  email), the email, a status and the hash of a token. The token itself is shown once, when it is made.
- One **library per rider**, a SQLite file at `data/tenants/<id>/agentmotoride.db`, created on first use. Nothing a
  rider saves, rates or notes can be seen with another rider's token.
- An update changes no library until its rider is next served: each library is migrated, after a backup, the first time
  it is opened ([ADR 0022](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0022-versioned-schema-migrations.md)).

## The commands

```bash
npm run admin -- add alice@example.org       # prints the token once, and how to connect
npm run admin -- list                        # identifier, email, status, size of the library, last seen
npm run admin -- suspend alice@example.org   # the token stops working; nothing is lost
npm run admin -- resume alice@example.org
npm run admin -- token alice@example.org     # a new token; the old one stops working at once
npm run admin -- remove alice@example.org    # the library is kept aside in data/removed/
npm run admin -- remove alice@example.org --purge --yes   # and this deletes it for good
npm run admin -- backup                      # a consistent copy of everything into data/backups/<date>/
nix run .#admin -- list                      # the same, with Nix
```

Set `RIDE_SERVER_URL` (for example `https://rides.example.org`) so `add` prints the right connection text, and
`RIDE_DATA_DIR` to keep the data on a mounted volume.

## Looking into a rider's library

```bash
RIDE_TENANT=<id> npm run rides -- roadbooks
```

`RIDE_TENANT` makes the terminal commands and the stdio server use that rider's library. Without it, and without a
registry, everything works as it always did with `data/agentmotoride.db`.

## What to know

- Emails are the riders' only personal data here, apart from their libraries. A library is not encrypted: protect the
  machine and the backups like any other place that holds people's data.
- Tokens are 256 random bits and are never stored. A lost token is replaced with `token`, not recovered.
- Why one instance with a file per rider, and not a container or a Postgres schema each:
  [ADR 0027](https://github.com/bhoudebert/agent-motoride/blob/main/docs/adr/0027-one-instance-one-sqlite-file-per-user.md).
