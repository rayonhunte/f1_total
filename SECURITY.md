# Security Policy

## Supported Versions

Security fixes are applied to the `main` branch.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory:

- Go to the repository
- Select `Security` -> `Advisories` -> `Report a vulnerability`

Do not post sensitive vulnerability details in public issues.

## Secret Handling

- Do not commit `.env` or service account keys.
- Firebase web config values are public client identifiers and not treated as secrets.
- Use Firebase Rules and Cloud Functions auth checks for access control.

