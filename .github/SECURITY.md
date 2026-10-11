# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AIMEAT, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Report it privately in one of two ways:

- **GitHub private vulnerability reporting:** the **Report a vulnerability** button on the
  repository's Security tab, or directly at
  <https://github.com/miikkij/aimeat-protocol/security/advisories/new>. The report is visible only
  to you and the maintainers.
- **Email:** **jouni.miikki@overscalesolutions.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Fix or mitigation:** depends on severity, typically within 2 weeks for critical issues

## Scope

This policy covers the code and the specification in this repository: the AIMEAT reference node
(`aimeat/`, published to npm as `aimeat`), the CrewAI package (`python/aimeat-crewai/`, published to
PyPI as `aimeat-crewai`), the desktop app (`aimeat-desktop/`), and the protocol specification.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.26.x (latest) | Yes |
| < 3.26  | No        |

The table is the node's version line. Security fixes go into the latest release line only. Update to the newest 3.26.x release before you report, if you can. The CrewAI package and the desktop app have their own version lines; for them, too, only the latest release receives fixes.
