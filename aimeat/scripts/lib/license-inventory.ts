/**
 * @file scripts/lib/license-inventory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one reader of "what third-party code does this node actually carry", shared by
 *   the three tools that need the same answer: check:licenses (the gate), gen:notices (the file a
 *   commercial user reads) and sbom (the file their scanner reads).
 *
 *   TWO POPULATIONS, and missing the second one is what made this necessary. The npm tree is the
 *   part every tool already sees: `pnpm licenses list` walks it in under a second. The other half
 *   is public/lib/, twenty-odd browser libraries fetched from a CDN and committed by hand, which no
 *   npm tool has ever looked at — and it is the half that held the licence problems: a GPL ffmpeg
 *   build inside an MIT package, an LGPL p5 with no licence text beside it, and six minified files
 *   carrying no copyright line at all. public/lib/licenses.json is the manifest for that half.
 *
 *   WHAT COUNTS AS DISTRIBUTED. Production dependencies travel in the npm tarball; dev
 *   dependencies do not. Everything under public/lib/ is served to a browser, which is
 *   distribution as surely as a tarball is. That is the population these tools describe.
 * @structure
 *   - npmComponents()       — the production dependency tree, with each package's own licence text
 *   - vendoredComponents()  — public/lib/licenses.json, with each component's licence text resolved
 *   - servedFiles()         — every file under public/lib/ that a browser can fetch
 *   - claims(component, f)  — does this component's `files` list cover that path
 *   - PERMISSIVE / SPDX_OF_NOTE — the allowlist, and the ids that carry an obligation
 * @usage  imported by check-licenses.ts, gen-third-party-notices.ts and gen-sbom.ts
 * @version-history
 *   v1.0.1 — 2026-08-31 — Licence and notice texts are read with LF line endings whatever the
 *     package shipped. One CRLF licence (`@so-ric/colorspace`) was the third and last reason the
 *     notices gate answered differently on Linux and on Windows for the same commit.
 *   v1.0.0 — 2026-08-31 — Initial: npm tree + vendored manifest behind one reader.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AIMEAT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = resolve(AIMEAT_ROOT, '..');
export const LIB_DIR = join(AIMEAT_ROOT, 'public', 'lib');

/**
 * Licences that need no decision: they ask for the notice to travel with the code and nothing
 * else. Anything outside this list reaches a person, either as a gate failure or as an entry in
 * check-licenses.ts's exception table with a reason and a date.
 */
export const PERMISSIVE = [
  'MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
  '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'OFL-1.1',
];

/** What each non-permissive id costs the operator, in one line, for the notices file. */
export const SPDX_OF_NOTE: Record<string, string> = {
  'MPL-2.0': 'File-level copyleft: a MODIFIED file of this component must stay MPL. Using it unchanged asks only for the notice and a pointer to the source.',
  'LGPL-2.1-only': 'Weak copyleft: your own code stays yours, but the library must remain replaceable and its complete source must be available. Modifying the library itself puts the changes under the LGPL.',
  'LGPL-2.1-or-later': 'Weak copyleft: your own code stays yours, but the library must remain replaceable and its complete source must be available.',
  'GPL-2.0-or-later': 'Strong copyleft: distributing this binary means distributing it under the GPL, with its source. AIMEAT does not distribute it — the operator installs it.',
  'CC-BY-4.0': 'Attribution required. Build-time data only; it does not travel in what this node serves.',
};

export interface Component {
  /** Stable identity used as the SBOM key and the notices anchor. */
  id: string;
  name: string;
  version: string;
  spdx: string;
  copyright: string;
  homepage: string;
  /** Where the bytes came from — a registry tarball, a CDN URL, or a build script. */
  source: string;
  /** The licence text as it actually ships, or null when the package shipped none. */
  licenseText: string | null;
  /** An Apache-2.0 style NOTICE whose contents must travel with the work. */
  noticeText: string | null;
  /** Complete-source offer, for the copyleft components that require one. */
  sourceOffer?: string;
  /** True when this project changed the upstream bytes rather than copying them. */
  modified: boolean;
  /** Free text worth reading before making a decision about this component. */
  note?: string;
  /** npm tree or public/lib/. */
  origin: 'npm' | 'vendored';
  /** Vendored only: the served paths this component claims, relative to public/lib/. */
  files?: string[];
  /** Vendored only: true when vendor-libs.mjs installs it rather than AIMEAT shipping it. */
  fetched?: boolean;
  /**
   * The component id that replaces this one, when this file is kept only so that already-published
   * apps that name it keep working. It is deliberately behind and must not be read as neglect.
   */
  supersededBy?: string;
  /**
   * Package URL. Stated rather than derived for the served libraries: most came off a CDN URL that
   * a regex could parse and a few (the re-bundled three.js) did not, and a scanner matching an
   * SBOM against a vulnerability feed matches on exactly this string. A wrong one is worse than a
   * generic one, so it is a field somebody wrote and check:licenses can read.
   */
  purl?: string;
}

interface PnpmLicenseEntry {
  name: string;
  versions?: string[];
  paths?: string[];
  license?: string;
  author?: string;
  homepage?: string;
}

/**
 * A licence or notice text as its author shipped it, with exactly one thing normalised: the line
 * endings. Registry tarballs carry whatever the author's editor wrote, and `@so-ric/colorspace`
 * ships its MIT text with CRLF. THIRD-PARTY-NOTICES.md is stored LF, because `.gitattributes`
 * normalises it on `git add` — so a CR that survives into the generated text can never appear in
 * the committed file, and `check:notices` then fails forever on CI while passing on the machine
 * that last ran the generator. The reproduction of that is one `npm install` away at any time.
 */
function readText(file: string): string {
  return readFileSync(file, 'utf-8').replace(/\r\n?/g, '\n').trim();
}

/**
 * LICENSE / LICENCE / COPYING, whichever spelling the package chose, at the package root.
 *
 * The sort is not cosmetic. `readdirSync` returns entries in filesystem order, which is alphabetical
 * on NTFS and hash order on ext4, so a package shipping both `LICENSE` and `LICENSE.md` gave one
 * text on Windows and possibly the other on Linux — a second way for the same commit to generate
 * two different notices files on two machines.
 */
function readLicenseFileIn(dir: string, pattern: RegExp): string | null {
  if (!dir || !existsSync(dir)) return null;
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return null;
  }
  const hit = names.find(n => pattern.test(n));
  if (hit === undefined) return null;
  const file = join(dir, hit);
  try {
    if (!statSync(file).isFile()) return null;
    return readText(file);
  } catch {
    return null;
  }
}

/**
 * The production dependency tree as pnpm sees it. `--prod` matters: dev dependencies are the
 * toolchain and do not travel in the tarball, so listing them in a notices file would tell a
 * commercial reader they carry obligations they do not have.
 *
 * `{ dev: true }` includes them anyway, for the one question where they do count: a vulnerability
 * in a build tool runs on the machine that builds a release, which is a supply-chain problem even
 * though nothing ships.
 */
export function npmComponents(options: { dev?: boolean } = {}): Component[] {
  let raw: string;
  try {
    raw = execSync(`pnpm licenses list ${options.dev === true ? '' : '--prod '}--json`, {
      cwd: AIMEAT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    throw new Error(
      'pnpm licenses list failed. It reads node_modules, so run pnpm install first.\n'
      + `  ${(err as Error).message}`,
    );
  }

  const byLicense = JSON.parse(raw) as Record<string, PnpmLicenseEntry[]>;
  const out: Component[] = [];
  for (const [spdx, entries] of Object.entries(byLicense)) {
    for (const entry of entries) {
      // ONE COMPONENT PER VERSION. pnpm groups a package's versions into one row, and joining them
      // into "2.6.9, 4.4.3" produced a component whose `version` was not a version and whose purl
      // named only the first — so a scanner checked one of the two and said nothing about the
      // other. Found 2026-08-31 by running osv-scanner against the SBOM this file feeds.
      const versions = (entry.versions ?? []).length > 0 ? (entry.versions as string[]) : ['unknown'];
      versions.forEach((version, at) => {
        const dir = (entry.paths ?? [])[at] ?? (entry.paths ?? [])[0] ?? '';
        out.push({
          id: `${entry.name}@${version}`,
          name: entry.name,
          version,
          spdx,
          copyright: entry.author ? `© ${entry.author}` : '',
          homepage: entry.homepage ?? '',
          source: `npm: ${entry.name}@${version}`,
          licenseText: readLicenseFileIn(dir, /^(licen[cs]e|copying)(\.|$)/i),
          noticeText: readLicenseFileIn(dir, /^notice(\.|$)/i),
          modified: false,
          origin: 'npm',
        });
      });
    }
  }
  // NOT localeCompare. It sorts by the host's collation, so `@types/node` and `@noble/hashes` can
  // land in a different order on Linux than on Windows — which is exactly how `pnpm check:notices`
  // came to be red in CI and green on the developer's machine for the same commit, with the gate
  // unable to say what differed. Code-unit order is the same everywhere.
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

interface VendoredEntry {
  id: string;
  name: string;
  version: string;
  spdx: string;
  copyright: string;
  homepage?: string;
  source?: string;
  sourceOffer?: string;
  licenseFile?: string;
  noticeFile?: string;
  files?: string[];
  fetched?: boolean;
  modified?: boolean;
  note?: string;
  purl?: string;
  supersededBy?: string;
}

/** Read a path that licenses.json gave, relative to public/lib/. */
function readRelative(rel: string | undefined): string | null {
  if (rel === undefined) return null;
  const file = resolve(LIB_DIR, rel);
  if (!existsSync(file)) return null;
  return readText(file);
}

/** public/lib/licenses.json — the manifest for everything this node serves to a browser. */
export function vendoredComponents(): Component[] {
  const file = join(LIB_DIR, 'licenses.json');
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { components?: VendoredEntry[] };
  const entries = parsed.components ?? [];
  return entries.map(e => ({
    id: e.id,
    name: e.name,
    version: e.version,
    spdx: e.spdx,
    copyright: e.copyright,
    homepage: e.homepage ?? '',
    source: e.source ?? '',
    sourceOffer: e.sourceOffer,
    licenseText: readRelative(e.licenseFile),
    noticeText: readRelative(e.noticeFile),
    modified: e.modified === true,
    note: e.note,
    origin: 'vendored' as const,
    files: e.files ?? [],
    fetched: e.fetched === true,
    purl: e.purl,
    supersededBy: e.supersededBy,
  }));
}

/** Paths that are documentation ABOUT the licensing rather than served third-party code. */
const NOT_A_SERVED_ASSET = [
  'VENDORED.md',
  'licenses.json',
  'vendored-assets.json',
];

/**
 * Every file a browser can fetch from /lib/, as posix paths relative to public/lib/. LICENSES/ is
 * excluded: those files exist to satisfy the obligations, they do not create new ones.
 */
export function servedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'LICENSES') continue;
        walk(full);
        continue;
      }
      const rel = relative(LIB_DIR, full).split(sep).join(posix.sep);
      if (NOT_A_SERVED_ASSET.includes(rel)) continue;
      out.push(rel);
    }
  };
  walk(LIB_DIR);
  out.sort();
  return out;
}

/**
 * Does this component claim that served path? A pattern is either an exact name or a `dir/**`
 * prefix — deliberately not a glob library, because a licence manifest that needs one has grown a
 * shape nobody can check by reading it.
 */
export function claims(component: Component, file: string): boolean {
  for (const pattern of component.files ?? []) {
    if (pattern.endsWith('/**')) {
      if (file.startsWith(pattern.slice(0, -2))) return true;
      continue;
    }
    if (pattern === file) return true;
  }
  return false;
}
