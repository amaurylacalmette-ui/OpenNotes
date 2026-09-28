# Security policy

## Supported versions

OpenNotes is a client-side application — no servers, no accounts, no
telemetry. The "attack surface" is your browser storage, which the app never
transmits anywhere.

| Version | Supported |
|---------|-----------|
| latest release | ✅ |
| older releases | ❌ — please update |

## Reporting a vulnerability

If you find a security issue (e.g. a way to exfiltrate notebook data, XSS via
notebook titles, a malicious dependency), please open a
[security advisory](https://github.com/security/advisories) on this repository
rather than a public issue. We will respond within 7 days.

## Data handling statement

- Notebook data lives exclusively in your browser's IndexedDB
- Exports (PNG/PDF) are generated locally and downloaded directly
- The service worker caches only static app assets — never note contents
