/**
 * @file cli/connect/home-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who besides its owner can read the connector home. The home holds the serve
 *   daemon's secret (serve.json), the agent tokens and the agent keys, so one home is one trust
 *   domain: every program that can read it can act as every agent in it, whichever owner the agent
 *   belongs to. The daemon calls checkConnectorHome() once at start and prints the warning it
 *   returns. Nothing here changes a permission; the warning names the command that does.
 *
 *   Windows: the home's access list, saved with icacls and read by SID. Account NAMES are
 *   translated (a Finnish Windows calls Authenticated Users "Todennetut käyttäjät"), the SIDs and
 *   their SDDL aliases are not. A grant counts when it lets Everyone, Authenticated Users or Users
 *   read the folder itself or the files in it. icacls is called by its full System32 path, because
 *   Windows looks for a bare program name in the current folder first.
 *
 *   Unix: the group and other read bits on serve.json, the tokens and the keys. The folder's own
 *   read bit does not count: it lets another account list the names in the folder, not read the
 *   files, and every usual install has it, so a warning for it would be one people learn to ignore.
 *
 *   A check that cannot read the permissions returns null, and the daemon starts as usual.
 * @structure ConnectorHomeWarning · checkConnectorHome() · readersInDacl() · windowsFinding() ·
 *   unixFinding() · secretFiles()
 * @usage
 *   const warning = checkConnectorHome(getConfigDir());
 *   if (warning) console.error(warning.message);
 * @version-history
 *   v1.1.0 -- 2026-09-26 -- On Unix only the modes of serve.json, the tokens and the keys count;
 *     the folder's own read bit shows other accounts the names in it, not the contents.
 *   v1.0.0 -- 2026-09-26 -- Created: the serve daemon warns at start when other accounts on the
 *     computer can read its connector home (secaudit 2026-09, N7).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';

export interface ConnectorHomeWarning {
  /** One paragraph: the folder, who can read it, what it holds, and the command that makes it private. */
  message: string;
  /** Who besides the owner can read the folder, in words. */
  readers: string[];
  /** The command that makes the folder private: the program, then its arguments. */
  fix: string[];
}

/** The groups whose read access reaches every account on the computer, by SID and SDDL alias. */
const WIDE_GROUPS: ReadonlyArray<{ sid: string; alias: string; name: string }> = [
  { sid: 'S-1-1-0', alias: 'WD', name: 'Everyone' },
  { sid: 'S-1-5-11', alias: 'AU', name: 'Authenticated Users' },
  { sid: 'S-1-5-32-545', alias: 'BU', name: 'Users' },
];

/**
 * SDDL access-right letters and the bits they stand for (sddl.h). A file right is written with the
 * letter of the directory-service right that has the same bit: read data (list, on a folder) is
 * `CC`, traverse is `WP`.
 */
const RIGHT_BITS: Readonly<Record<string, number>> = {
  GA: 0x10000000, GR: 0x80000000, GW: 0x40000000, GX: 0x20000000,
  RC: 0x20000, SD: 0x10000, WD: 0x40000, WO: 0x80000,
  CC: 0x1, DC: 0x2, LC: 0x4, SW: 0x8, RP: 0x10, WP: 0x20, DT: 0x40, LO: 0x80, CR: 0x100,
  FA: 0x1f01ff, FR: 0x120089, FW: 0x120116, FX: 0x1200a0,
  KA: 0xf003f, KR: 0x20019, KW: 0x20006, KX: 0x20019,
};

/** Read data (list, on a folder), generic read and generic all: the bits that let an account read. */
const READ_BITS = 0x1 | 0x80000000 | 0x10000000;

/** Two-letter tokens, as SDDL writes flags and rights. */
function pairs(s: string): string[] {
  return s.match(/../g) ?? [];
}

function rightsMask(rights: string): number {
  if (/^0x[0-9a-f]+$/i.test(rights)) return parseInt(rights.slice(2), 16);
  return pairs(rights).reduce((mask, code) => mask | (RIGHT_BITS[code.toUpperCase()] ?? 0), 0);
}

/**
 * Which of Everyone, Authenticated Users and Users an access list lets read the folder or the files
 * in it, as SIDs in that order. `sddl` is the line icacls /save writes: `D:<flags>(ace)(ace)…`.
 * A list with no access control at all (`D:NO_ACCESS_CONTROL`) is open to Everyone.
 */
export function readersInDacl(sddl: string): string[] {
  const start = sddl.indexOf('D:');
  if (start < 0) return [];
  let i = start + 2;
  const flags = /^[A-Z_]*/.exec(sddl.slice(i))?.[0] ?? '';
  if (flags.includes('NO_ACCESS_CONTROL')) return [WIDE_GROUPS[0].sid];
  i += flags.length;

  const found = new Set<string>();
  while (sddl[i] === '(') {
    // One ACE. A conditional ACE nests parentheses, so this finds the matching close.
    let depth = 0;
    let end = i;
    for (; end < sddl.length; end++) {
      if (sddl[end] === '(') depth++;
      else if (sddl[end] === ')' && --depth === 0) break;
    }
    const [type, aceFlags = '', rights = '', , , account = ''] = sddl.slice(i + 1, end).split(';');
    i = end + 1;

    if (type !== 'A') continue;   // only a plain allow entry grants anything for certain
    const group = WIDE_GROUPS.find(g => g.alias === account.toUpperCase() || g.sid === account.toUpperCase());
    if (!group) continue;
    const inheritFlags = pairs(aceFlags);
    // An inherit-only entry does not apply to the folder itself; with OI it still reaches its files.
    const reaches = !inheritFlags.includes('IO') || inheritFlags.includes('OI');
    if (reaches && (rightsMask(rights) & READ_BITS) !== 0) found.add(group.sid);
  }
  return WIDE_GROUPS.filter(g => found.has(g.sid)).map(g => g.sid);
}

interface Finding { readers: string[]; fix: string[]; shown: string }

function windowsFinding(home: string): Finding | null {
  const icacls = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe');
  // icacls writes the access list only to a file: UTF-16LE, the folder's name on one line and its
  // SDDL on the next.
  const saved = join(tmpdir(), `aimeat-home-acl-${process.pid}-${randomBytes(4).toString('hex')}`);
  let sddl: string;
  try {
    execFileSync(icacls, [home, '/save', saved, '/Q'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
    sddl = readFileSync(saved).toString('utf16le').split(/\r?\n/).find(line => line.startsWith('D:')) ?? '';
  } finally {
    rmSync(saved, { force: true });
  }
  const sids = readersInDacl(sddl);
  if (sids.length === 0) return null;

  const user = userInfo().username;
  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
  // Stop inheriting, give the account that runs the daemon full control, drop the three groups.
  const args = ['/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`, '/remove:g', ...WIDE_GROUPS.map(g => `*${g.sid}`)];
  const quoted = (arg: string): string => (/^[\w\-/:.\\]+$/.test(arg) ? arg : `"${arg}"`);
  return {
    readers: sids.map(sid => WIDE_GROUPS.find(g => g.sid === sid)!).map(g => `${g.name} (${g.sid})`),
    fix: [icacls, home, ...args],
    shown: ['icacls', `"${home}"`, ...args.map(quoted)].join(' '),
  };
}

/** serve.json, the agent tokens and the agent keys that are in the home now. */
function secretFiles(home: string): string[] {
  const files = [join(home, 'serve.json')].filter(existsSync);
  for (const [dir, suffix] of [['tokens', '.token'], ['keys', '.key']] as const) {
    const path = join(home, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path)) if (name.endsWith(suffix)) files.push(join(path, name));
  }
  return files;
}

function unixFinding(home: string): Finding | null {
  // The files only: the folder's own read bit lets another account list the names, not read the files.
  let bits = 0;
  for (const file of secretFiles(home)) bits |= statSync(file).mode & 0o044;
  const readers: string[] = [];
  if (bits & 0o040) readers.push('the other members of its group');
  if (bits & 0o004) readers.push('every other account');
  if (readers.length === 0) return null;
  return {
    readers,
    fix: ['chmod', '-R', 'go-rwx', home],
    shown: `chmod -R go-rwx '${home.replace(/'/g, `'\\''`)}'`,
  };
}

/** "a", "a and b", "a, b and c". */
function inWords(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The warning the serve daemon prints at start when other accounts on this computer can read the
 * daemon secret or the agent keys in the connector home: on Windows the home's access list says
 * so, on Unix the modes of those files. Null when only the owner can, and when the permissions
 * cannot be read.
 */
export function checkConnectorHome(home: string): ConnectorHomeWarning | null {
  let finding: Finding | null;
  try {
    finding = process.platform === 'win32' ? windowsFinding(home) : unixFinding(home);
  } catch (err) {
    // No icacls, a file system without access lists, a folder that is gone: no warning, and the
    // daemon starts as usual.
    logger.debug('connector home: its permissions could not be read, so no warning is given', { home, error: String(err) });
    return null;
  }
  if (!finding) return null;
  const message = `[serve] Other accounts on this computer can read the connector folder ${home}: ${inWords(finding.readers)}. `
    + 'It holds the daemon secret and the agent keys, and anyone who can read them can act as every agent in it. '
    + `To make the folder private, run: ${finding.shown}`;
  return { message, readers: finding.readers, fix: finding.fix };
}
