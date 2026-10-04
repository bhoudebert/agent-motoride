# Security

## Secrets

`.env` holds API keys and is git-ignored. Never commit it. The MCP server
passes the Anthropic key only to scouts; MCP clients never see it.

## What the app reaches

Public data services over HTTPS (OpenStreetMap, Valhalla, Open-Meteo, Photon,
Nominatim, TomTom when a key is set), the Anthropic API in API mode and for
scouts, and nothing else. `/share` serves a page on the local network only,
without authentication: use it on a trusted Wi-Fi.

## Reporting

Open a private security advisory on the repository, or contact the maintainer
directly. Please do not open a public issue for a vulnerability.
