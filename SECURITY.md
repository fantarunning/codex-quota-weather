# Security

## Data boundary

Codex Quota Weather runs locally and binds its data service to
`127.0.0.1`. It reads Codex session metadata from `~/.codex/sessions` and, when
available, reads the existing access token from `~/.codex/auth.json` only to
request the official ChatGPT usage endpoint.

The token is never written to this project, returned by the local HTTP API, or
included in logs. Do not publish your `~/.codex` directory or user
configuration.

## Reporting a vulnerability

Please use
[GitHub private vulnerability reporting](https://github.com/fantarunning/codex-quota-weather/security/advisories/new)
instead of a public issue when the report contains a security impact.
