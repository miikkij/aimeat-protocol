# Dependency Management

## MANDATORY RULES

### Before Adding Any Package

1. **Check if it's actually needed.** Can Node.js built-ins or existing dependencies handle this?
2. **Check the license.** Permissive and no decision needed: MIT, MIT-0, ISC, Apache-2.0,
   BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0. Anything else — GPL, AGPL,
   LGPL, MPL, SSPL, BUSL, a source-available licence — needs the developer's approval and an entry
   in `EXCEPTIONS` in `aimeat/scripts/check-licenses.ts` saying what the obligation costs an
   operator. `pnpm check:licenses` refuses the commit otherwise.
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

# Licences, and the notices that have to follow them
pnpm check:licenses
pnpm gen:notices
```

**If `pnpm audit` reports high/critical vulnerabilities:**
1. Check if the vulnerability is in a direct or transitive dependency
2. Check if a patched version exists
3. Research if the vulnerability actually affects our usage
4. Present options to the user with risk assessment

---

## Licensing

AIMEAT is MIT and people run it commercially, so the question that has to keep being answerable is
"can a company ship this without a lawyer stopping them". Three tools answer it, and none of them is
a list anybody maintains by hand.

| Command | What it does |
|---|---|
| `pnpm check:licenses` | Refuses a licence outside the allowlist, a served file with no licence entry, a copyleft component with no source offer, and a GPL asset that is tracked or unmarked. Pre-commit hook, CI and `prepublishOnly`. |
| `pnpm gen:notices` | Regenerates `THIRD-PARTY-NOTICES.md` — every component, its copyright holder and its licence text in full. `pnpm check:notices` proves it is current. |
| `pnpm sbom` | Writes `sbom.cdx.json`, a CycloneDX 1.6 bill of materials. This is what a company's security review asks for. Generated on demand, not committed. |

**This section used to be a table of every dependency and its licence, and that is why it is not
one now.** By August 2026 it listed `isolated-vm` (replaced by `quickjs-emscripten`), `uuid ^13`
(shipping `^14`) and `typescript ^5.9` (shipping `^6`), because 412 production packages cannot be
tracked by a human. A stale table is worse than none: it reads as an assurance. The gate fails on
the commit that introduces the problem, and the notices file is regenerated from the tree that is
actually installed.

### The two populations

Every licence tool in the ecosystem walks the npm tree and stops. That describes about two thirds of
what this node distributes:

- **The npm tree**, 412 production packages, read by `pnpm licenses list`. Dev dependencies are
  excluded on purpose: the toolchain does not ship, so it carries no obligation for anyone.
- **`aimeat/public/lib/`**, twenty-odd browser libraries fetched from a CDN and committed by hand.
  No npm tool has ever looked at them, and serving a file to a browser is distribution in the same
  sense a tarball is. [`licenses.json`](../../aimeat/public/lib/licenses.json) is their manifest and
  `LICENSES/` holds the texts. Six of them (p5, Phaser, PixiJS, Drawflow, Tailwind, daisyUI) are
  minified builds with no copyright line anywhere in the file, so copying the file satisfies
  nothing on its own.

Adding a file under `public/lib/` without an entry in `licenses.json` fails the gate.

### The three approved exceptions

Each is a decision with a date, not a suppression. The full reasoning is in `EXCEPTIONS` in
`aimeat/scripts/check-licenses.ts` and in the notices file.

| Component | Licence | Why it is acceptable |
|---|---|---|
| `web-push` | MPL-2.0 | File-level copyleft, used unmodified. The obligation is the notice and a pointer to the source. Modifying a web-push file would put that file under the MPL. |
| p5.js | LGPL-2.1-only | Served unmodified as its own file at a stable URL. Nothing links it statically, so an app that calls it keeps its own licence. Text, notice and the exact source tarball are all in `licenses.json`. Approved 2026-07-16. |
| `@ffmpeg/core` | GPL-2.0-or-later | AIMEAT does not distribute it. Marked `"distribute": false`, untracked, skipped by the build's copy step, and installed on the operator's own machine by `pnpm vendor:libs`. Approved 2026-07-31. |

### What the desktop build adds

`aimeat-desktop` distributes two things the web node does not, and neither is a declared
dependency: the Node runtime, staged as a Tauri sidecar from the build machine's own installation,
whose 146 kB `LICENSE` carries the notices for OpenSSL, V8, ICU and the rest; and
`WebView2Loader.dll`, a Microsoft redistributable under Microsoft's terms rather than the MIT of the
crate it came from. `scripts/stage-licenses.mjs` stages both, plus AIMEAT's own licence and the
generated notices, into the installer. It fails the build rather than shipping without them.

---

## Vulnerabilities, and keeping things current

Two scanners, because one of them cannot see a third of what this node ships.

| Command | Reads | Covers |
|---|---|---|
| `pnpm audit` | GitHub's npm advisory database | the npm tree |
| `pnpm scan:vulns` | OSV.dev, which aggregates about twenty sources | the npm tree **and** the browser libraries under `public/lib/` |

`pnpm scan:vulns -- --dev` adds the build toolchain, which does not ship but runs on the machine
that cuts a release. `-- --json` is the CI shape.

**The gap is not theoretical.** On 2026-08-31, `pnpm audit` reported zero vulnerabilities across
730 packages while the served libraries carried six: a HIGH-severity arbitrary JavaScript execution
in PDF.js 6.1.200 (opening a malicious PDF), and five in Mermaid 11.15.0 — prototype pollution twice,
CSS injection reaching outside the diagram, and two denial-of-service paths. Nothing had ever
scanned them, because they are committed files with no manifest above them and every dependency
tool in the ecosystem reads manifests. `licenses.json` gives each one a real package URL, which is
what a vulnerability feed matches on, so the licence work is what made the scan possible.

### The routine

- **Weekly, automatic.** `.github/dependabot.yml` opens grouped update PRs: production and toolchain
  apart, minor and patch grouped, a major on its own because it is a decision rather than a bump.
  `.github/workflows/vulnerability-scan.yml` runs both scanners on Mondays and fails on a finding.
- **A security advisory does not wait for Monday.** GitHub opens those as soon as they land.
- **By hand, when you want to look:** `pnpm outdated` for the list, `pnpm update` for everything the
  ranges already allow, `pnpm add <pkg>@latest` for a deliberate major.
- **After any of them:** `pnpm check:licenses && pnpm gen:notices`, then the guard tier on both
  backends. A dependency bump is a change to what users run.

### Updating a browser library under public/lib/

Dependabot cannot do this one; it is four steps and they must all happen together.

1. Fetch the new build to the same path. The major-pinned filename is the compatibility contract:
   a minor or patch update lands **in place**, a major ships as a new file or directory beside the
   old one, which is never changed.
2. Update the version in `public/lib/VENDORED.md`, in `public/lib/licenses.json` (version **and**
   `purl`, or the scan keeps checking the old version) and in
   `src/data/library-packs/vendored.ts`.
3. Append a `changelog` entry to that pack. It is written **for an AI**: what changed and what it
   means for apps already published.
4. Verify in a real browser that the library still does its job, then `pnpm gen:notices`.

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

# Licences: the gate, the notices, the bill of materials
pnpm check:licenses
pnpm gen:notices
pnpm sbom
```

---

## Decision Checklist

When evaluating whether to add a package, go through this checklist:

- [ ] Is there a Node.js built-in that does this? (`node:crypto`, `node:fs`, `node:url`, etc.)
- [ ] Do existing dependencies already cover this? (e.g., `ajv` for validation, `zod` for schemas)
- [ ] Is the license permissive? If not, has the developer approved it, and is the obligation written down?
- [ ] Is it actively maintained? (check GitHub activity)
- [ ] Is the bundle size reasonable? (check bundlephobia.com)
- [ ] Does `pnpm audit` pass after installation?
- [ ] Are TypeScript types available?
- [ ] Have I documented why this package is needed?
- [ ] Does `pnpm check:licenses` still pass, and did I run `pnpm gen:notices`?
