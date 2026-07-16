# Dependency Management

## MANDATORY RULES

### Before Adding Any Package

1. **Check if it's actually needed.** Can Node.js built-ins or existing dependencies handle this?
2. **Check the license.** Acceptable: MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause. Requires user approval: GPL, AGPL, LGPL, MPL, or any copyleft license.
3. **Evaluate the package:**
   - Active maintenance (commits in last 6 months)
   - Reasonable download count / community adoption
   - Small dependency tree (avoid packages that pull in 50+ transitive deps)
   - No known security vulnerabilities (`pnpm audit`)
   - TypeScript types available (built-in or `@types/*`)
4. **Prefer small, focused libraries** over large frameworks. One package per job.
5. **Document why** the package is needed in the commit message.

### After Adding/Updating Packages

```bash
cd aimeat

# Run security audit
pnpm audit

# If issues found, try to fix
pnpm audit --fix

# If auto-fix doesn't work, investigate and present options to user
```

**If `pnpm audit` reports high/critical vulnerabilities:**
1. Check if the vulnerability is in a direct or transitive dependency
2. Check if a patched version exists
3. Research if the vulnerability actually affects our usage
4. Present options to the user with risk assessment

---

## Current Dependencies

### Production Dependencies

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| `@clack/prompts` | ^1.0.1 | CLI wizard UI | MIT |
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP protocol support | MIT |
| `@noble/ed25519` | ^3.0.0 | Ed25519 key generation/signing | MIT |
| `@noble/hashes` | ^2.0.1 | Cryptographic hash functions | MIT |
| `ajv` | ^8.18.0 | JSON Schema validation | MIT |
| `ajv-formats` | ^3.0.1 | AJV format plugins | MIT |
| `better-sqlite3` | ^12.6.2 | SQLite database driver | MIT |
| `compression` | ^1.8.1 | HTTP compression middleware | MIT |
| `consul` | ^2.0.1 | Consul config management client | MIT |
| `croner` | ^10.0.1 | Cron job scheduler | MIT |
| `express` | ^5.2.1 | HTTP framework | MIT |
| `ini` | ^6.0.0 | INI file parser | ISC |
| `isolated-vm` | ^6.0.2 | V8 isolate sandboxing for extensions | MIT |
| `jose` | ^6.1.3 | JWT/JWS/JWE (EdDSA support) | MIT |
| `nodemailer` | ^8.0.1 | Email sending (SMTP) | MIT |
| `otpauth` | ^9.5.0 | TOTP/HOTP 2FA | MIT |
| `prom-client` | ^15.1.3 | Prometheus metrics | Apache-2.0 |
| `qrcode` | ^1.5.4 | QR code generation | MIT |
| `uuid` | ^13.0.0 | UUID generation | MIT |
| `vanilla-cookieconsent` | ^3.1.0 | Cookie consent banner | MIT |
| `web-push` | ^3.6.7 | Web push notifications | MIT |
| `winston` | ^3.19.0 | Structured logging | MIT |
| `ws` | ^8.19.0 | WebSocket server | MIT |
| `yaml` | ^2.8.2 | YAML parser | ISC |
| `zod` | ^4.3.6 | Runtime type validation | MIT |

### Dev Dependencies

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| `@eslint/js` | ^10.0.1 | ESLint built-in rules | MIT |
| `@playwright/test` | ^1.58.2 | Browser E2E testing | Apache-2.0 |
| `eslint` | ^10.0.2 | Code linting | MIT |
| `openapi-typescript` | ^7.8.0 | Generate types from OpenAPI spec | MIT |
| `tsx` | ^4.21.0 | TypeScript execution (tests, scripts) | MIT |
| `typescript` | ^5.9.3 | TypeScript compiler | Apache-2.0 |
| `typescript-eslint` | ^8.56.1 | TypeScript ESLint integration | MIT |
| `vitest` | ^4.0.18 | Unit test framework | MIT |

---

## Security Overrides

The `package.json` contains `pnpm.overrides` to patch known vulnerabilities in transitive dependencies:

```json
"overrides": {
  "hono": ">=4.12.4",
  "@hono/node-server": ">=1.19.10",
  "express-rate-limit": ">=8.3.0",
  "minimatch@>=5.0.0 <5.1.8": "5.1.8",
  "js-yaml@>=4.0.0 <4.1.1": "4.1.1"
}
```

When adding new overrides:
1. Document which vulnerability (CVE) it fixes
2. Test that the override doesn't break functionality
3. Plan to remove once the direct dependency updates

---

## Package Management Commands

```bash
# Add a new dependency
pnpm add <package>

# Add a dev dependency
pnpm add -D <package>

# Update all dependencies
pnpm update

# Check for outdated packages
pnpm outdated

# Security audit
pnpm audit

# Fix audit issues
pnpm audit --fix

# Check why a package is installed
pnpm why <package>
```

---

## Decision Checklist

When evaluating whether to add a package, go through this checklist:

- [ ] Is there a Node.js built-in that does this? (`node:crypto`, `node:fs`, `node:url`, etc.)
- [ ] Do existing dependencies already cover this? (e.g., `ajv` for validation, `zod` for schemas)
- [ ] Is the license acceptable? (MIT/Apache-2.0/ISC/BSD)
- [ ] Is it actively maintained? (check GitHub activity)
- [ ] Is the bundle size reasonable? (check bundlephobia.com)
- [ ] Does `pnpm audit` pass after installation?
- [ ] Are TypeScript types available?
- [ ] Have I documented why this package is needed?
