# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AIMEAT, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Report it privately in one of two ways:

- **GitHub private vulnerability reporting:** the **Report a vulnerability** button on the
  repository's Security tab, or directly at
  <https://github.com/miikkij/aimeat-protocol/security/advisories/new>. The report is visible only
  to you and the maintainers.
- **Email:** **jouni.miikki@overscalesolutions.com** at Overscale Solutions Oy, which maintains the
  project.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

We aim to acknowledge a report within 48 hours, give an assessment within a week and ship a fix
within two weeks.

## Scope

This policy covers the code and the specification in this repository: the AIMEAT reference node
(`aimeat/`, published to npm as `aimeat`), the CrewAI package (`python/aimeat-crewai/`, published to
PyPI as `aimeat-crewai`), the desktop app (`aimeat-desktop/`), and the protocol specification.

aimeat.io is the project's demo node. A vulnerability you find on that hosted service may be
reported under this policy too.

## Supported Versions

| Version | Supported |
|---------|-----------|
| The newest release | Yes |
| Any older release  | No  |

The node's newest release is the `aimeat` package on npm (`npm view aimeat version`). Security fixes ship in a new release, and only the newest release receives them. Update to it before you report, if you can. The CrewAI package and the desktop app have their own version lines; for them, too, only the latest release receives fixes.
