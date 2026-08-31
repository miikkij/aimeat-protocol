/**
 * @file check-lib-freshness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How old is each browser library this node serves, and how far behind upstream.
 *
 *   THE BLIND SPOT THIS FILLS. `pnpm outdated` answers this for the npm tree in one second. For the
 *   two dozen libraries under public/lib/ it answers nothing at all, because they have no manifest
 *   above them — they are files in a directory, vendored from a CDN by hand. So the question "are
 *   any of our libraries old" had no answer for the half of them that runs in every visitor's
 *   browser. `licenses.json` gives each one a package URL, and that is enough to ask the registry
 *   when our version was published, what the newest one is, and whether anybody still releases it.
 *
 *   TWO DIFFERENT KINDS OF OLD, and only one of them is a problem. **Behind** means a newer version
 *   exists; that is a choice, and the major-pin policy in public/lib/VENDORED.md deliberately keeps
 *   some of them behind so published apps never break. **Stale upstream** means nobody has released
 *   anything for a long time, which says something about the library rather than about us. A
 *   library can be either, both, or neither, so they are reported apart.
 * @structure registryInfo() → one npm metadata call per library; classify() → behind-ness and age;
 *   main() → a table, then the lines that need a person
 * @usage
 *   pnpm check:libs           # the table
 *   pnpm check:libs -- --json # for the security report
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: age and behind-ness for every served browser library.
 */
import { vendoredComponents, type Component } from './lib/license-inventory.js';

const DAY = 24 * 60 * 60 * 1000;
/** No upstream release in this long is worth a look, not an alarm. */
const STALE_DAYS = 540;

interface Registry { time: Record<string, string>; latest: string }

/**
 * npm names the package in the path, and a scoped name has to survive that intact.
 *
 * This used to be `encodeURIComponent(name).replace('%40', '@')` — encode everything, then undo the
 * one bit the registry will not accept. CodeQL called it what it is (js/incomplete-sanitization,
 * alert 1594): a non-global `.replace` puts back only the FIRST `%40`, so the round trip is not a
 * round trip. Checking the name against what an npm name may contain is both stricter and simpler
 * than encoding and partially decoding it, and these names come from our own licenses.json rather
 * than from anywhere a stranger can reach.
 */
const NPM_NAME = /^@?[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/i;

async function registryInfo(name: string): Promise<Registry | null> {
  if (!NPM_NAME.test(name)) return null;
  const res = await fetch(`https://registry.npmjs.org/${name}`);
  if (!res.ok) return null;
  const body = await res.json() as { time?: Record<string, string>; 'dist-tags'?: { latest?: string } };
  const latest = body['dist-tags']?.latest;
  if (!body.time || !latest) return null;
  return { time: body.time, latest };
}

function daysSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - Date.parse(iso)) / DAY);
}

/** major.minor.patch, tolerant of a version that is not strictly semver. */
function parts(version: string): number[] {
  return version.split('.').map(p => parseInt(p, 10)).map(n => (Number.isNaN(n) ? 0 : n));
}

/**
 * How far behind, in the sense that matters: can this land in place, or is it a decision.
 *
 * BELOW 1.0 THE MINOR IS THE MAJOR. Semver says a 0.x release may break anything, and the ecosystem
 * uses it that way: three.js 0.128 → 0.185 is fifty-seven releases of removals and renames, not a
 * routine bump. Calling that "minor" would put the oldest library here in the safe column.
 */
function behindBy(ours: string, latest: string): 'current' | 'patch' | 'minor' | 'major' | 'unknown' {
  if (ours === latest) return 'current';
  const a = parts(ours), b = parts(latest);
  if (a.length < 2 || b.length < 2) return 'unknown';
  if (a[0] !== b[0]) return 'major';
  if (a[0] === 0 && a[1] !== b[1]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'unknown';
}

export interface LibRow {
  id: string;
  name: string;
  ours: string;
  latest: string;
  behind: string;
  /** Days since OUR version was published — how old the bytes we serve are. */
  ourAgeDays: number | null;
  /** Days since ANY release — whether upstream is still alive. */
  upstreamAgeDays: number | null;
  /** The component that replaces this one, when this file is frozen on purpose. */
  supersededBy?: string;
  note: string;
}

/** `pkg:npm/%40scope/name@1.2.3` → the registry name and the version we serve. */
function fromPurl(purl: string): { name: string; version: string } | null {
  const m = /^pkg:npm\/(.+)@([^@]+)$/.exec(purl);
  return m === null ? null : { name: decodeURIComponent(m[1]), version: m[2] };
}

export async function libFreshness(components: Component[]): Promise<LibRow[]> {
  const now = Date.now();
  const rows: LibRow[] = [];
  for (const c of components) {
    const parsed = c.purl === undefined ? null : fromPurl(c.purl);
    if (parsed === null) continue;
    const info = await registryInfo(parsed.name);
    if (info === null) {
      rows.push({
        id: c.id, name: parsed.name, ours: parsed.version, latest: '?', behind: 'unknown',
        ourAgeDays: null, upstreamAgeDays: null, note: 'registry did not answer',
      });
      continue;
    }
    rows.push({
      id: c.id,
      name: parsed.name,
      ours: parsed.version,
      latest: info.latest,
      // A file kept only so already-published apps keep working is behind ON PURPOSE. Printing it
      // as 'major' forever would train everyone to ignore the column that matters.
      behind: c.supersededBy ? 'frozen' : behindBy(parsed.version, info.latest),
      supersededBy: c.supersededBy,
      ourAgeDays: daysSince(info.time[parsed.version], now),
      upstreamAgeDays: daysSince(info.time[info.latest], now),
      note: c.fetched === true ? 'installed by the operator, not shipped by AIMEAT' : '',
    });
  }
  return rows;
}

function years(days: number | null): string {
  if (days === null) return '?';
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const served = vendoredComponents().filter(c => c.id !== 'aimeat');
  const rows = await libFreshness(served);

  if (asJson) {
    console.log(JSON.stringify({ libraries: rows }, null, 2));
    return;
  }

  const order = { major: 0, minor: 1, patch: 2, unknown: 3, current: 4, frozen: 5 } as Record<string, number>;
  rows.sort((a, b) => (order[a.behind] ?? 9) - (order[b.behind] ?? 9) || (b.ourAgeDays ?? 0) - (a.ourAgeDays ?? 0));

  console.log('\nBrowser libraries served from /lib/ — nothing else looks at these\n');
  console.log('  library                  we serve       latest         behind   our version   upstream');
  console.log('  ' + '-'.repeat(88));
  for (const r of rows) {
    console.log(
      '  ' + r.name.padEnd(24) + ' '
      + r.ours.padEnd(14) + ' '
      + r.latest.padEnd(14) + ' '
      + r.behind.padEnd(8) + ' '
      + years(r.ourAgeDays).padEnd(13) + ' '
      + (r.behind === 'frozen' ? 'kept for published apps -> ' + r.supersededBy
        : r.upstreamAgeDays !== null && r.upstreamAgeDays > STALE_DAYS
          ? `last release ${years(r.upstreamAgeDays)} ago`
          : `active (${years(r.upstreamAgeDays)} ago)`),
    );
  }

  const majors = rows.filter(r => r.behind === 'major');
  const small = rows.filter(r => r.behind === 'minor' || r.behind === 'patch');
  const current = rows.filter(r => r.behind === 'current');
  const stale = rows.filter(r => (r.upstreamAgeDays ?? 0) > STALE_DAYS);
  const frozen = rows.filter(r => r.behind === 'frozen');
  const ancient = rows.filter(r => (r.ourAgeDays ?? 0) > 365 * 2 && r.behind !== 'frozen');

  console.log('\n  ' + '-'.repeat(88));
  console.log(`  ${current.length} current · ${small.length} a minor or patch behind · ${majors.length} a major behind · ${frozen.length} frozen for published apps`);
  console.log(`  ${ancient.length} serving bytes more than two years old · ${stale.length} with no upstream release in ${Math.round(STALE_DAYS / 30)} months`);
  console.log('\n  A major behind is a DECISION, not a defect: the major-pinned filename is the');
  console.log('  compatibility contract for every published app (public/lib/VENDORED.md). A minor or');
  console.log('  patch behind lands in place and is the cheap one to take.\n');
}

/**
 * Only when run as a command. security-report.ts imports libFreshness() from here, and a bare
 * `main()` at module scope would run the whole table print as a side effect of that import.
 */
if (process.argv[1]?.includes('check-lib-freshness')) {
  main().catch(err => {
    console.error(`check-lib-freshness: ${(err as Error).message}`);
    process.exit(2);
  });
}
