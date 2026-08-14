/**
 * @file scripts/check-trusted-keys.ts
 * @description The gate for Rule 10 invariant 2: a memory key the server reads and ACTS ON must be
 *   unreachable by a scoped app or agent. The reason is the whole H-2 grant model: an app-grant
 *   token resolves to the owner's GHII, so its writes land in the owner's namespace by design. That
 *   is fine for the owner's data and fatal for the server's own configuration.
 *
 *   Two accepted patterns (security-development-dna.md §2): store it under a synthetic system
 *   identity no owner-scoped principal can address, or put its prefix on the reserved-key denylist.
 *   The August 2026 audit found the denylist at three prefixes against sixty-nine trusted keys, and
 *   two of the unprotected ones were a cross-owner authorization list and a payout address with a
 *   Stripe secret beside it.
 *
 *   WHY THE KEY EXPRESSION IS RESOLVED RATHER THAN MATCHED. Both keys the audit found by hand are
 *   invisible to a scan that only reads inline string literals. `finance.accountants` (H-6) sits in
 *   a module constant and reaches storage through a two-line helper that takes the key as a
 *   parameter; `commerce.psp` (H-23) is inline in five places and behind `PSP_KEY` in a sixth. So
 *   this script resolves the key ARGUMENT: a literal, a module constant (local or imported), a
 *   key-builder function returning a template with a literal prefix, or a helper that took the key as
 *   a parameter, in which case the judgement moves up to the call site where the constant is spelled.
 *   What it still cannot resolve it COUNTS and prints, because the honest measure of a scanner is how
 *   blind it admits to being.
 *
 *   A PREFIX SCAN IS A READ. `listAllMemory({ prefix: 'bensplit.' })` walks EVERY owner's namespace
 *   and the server pays out on what it finds, so a prefix carries the same weight here as a key.
 *
 *   Ratchet, not a wall: seeded with today's reads, so the gate fails only on a NEW unprotected key.
 *   An exemption carries prose saying why the key is not server-trusted configuration. A reason is
 *   the entire point of the file: "the server reads this and it is fine" is a claim, and the two the
 *   audit found were keys where nobody had ever made it. An empty reason therefore fails the gate,
 *   and a reason that begins with UNREVIEWED counts as backlog rather than as a claim.
 * @structure
 *   - stripComments / collectKeyConstants / collectKeyBuilders / scanForwarders: resolution tables
 *   - splitCallArgs + resolveKeyExpression: what key does this read actually ask for
 *   - scanSources(): the pure scan (getMemory, the list calls, and the forwarder call sites)
 *   - validateReasons(): empty reason fails, UNREVIEWED counts as debt
 *   - main(): compare against security/trusted-key-exemptions.json; --strict gates; --seed merges
 * @usage
 *   cd aimeat && pnpm check:trusted-keys:report     # the backlog, without gating
 *   cd aimeat && pnpm check:trusted-keys            # the hook/CI gate (--strict)
 *   cd aimeat && pnpm check:trusted-keys:seed       # merge today's reads into the exemption file
 *   ... --root <dir>                                # scan a fixture tree instead of this one
 * @version-history
 *   v2.0.0 — 2026-08-14 — The gate finds the keys the audit found by hand. Each change has its own
 *     failing case in test/unit/check-trusted-keys.test.ts: the key argument is RESOLVED through
 *     module constants, key builders and key-forwarding helpers (v1 saw inline literals only, so H-6
 *     finance.accountants was invisible to it); prefix scans count as reads, which is how the
 *     revenue-split and entitlement keys became visible; the scan covers the whole server rather than
 *     four directories, since middleware and auth read memory too; and an exemption with an empty
 *     reason now fails, which is the difference between a written claim and a filed key name.
 *     Comments are stripped first, so a docblock example is no longer a finding, and a scan that
 *     matched no files at all is an error rather than a pass. Re-seeded: 36 reads / 12 distinct keys
 *     became 231 reads / 62 distinct keys, of which 153 were invisible to v1, and all 124 entries
 *     carry the UNREVIEWED marker because nobody has yet judged any of them.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, systemic pattern 3).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESERVED_OWNER_KEY_PREFIXES } from '../src/utils/reserved-keys.js';

/**
 * The tree to scan: the working directory, which `pnpm check:trusted-keys` sets to the package, or
 * `--root <dir>`. The flag exists so the whole gate can be run against a miniature fixture tree, and
 * that is how its failing cases are proven without writing a probe into the real src/ while other
 * work is in flight. A run that finds no files at all is an error rather than a pass.
 */
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag > 0 && process.argv[rootFlag + 1] ? resolve(process.argv[rootFlag + 1]) : process.cwd();
const SRC = join(ROOT, 'src');

/**
 * Directories under src/ that are not the server acting on data: the storage providers ARE the
 * memory implementation (every read in them is the mechanism, not a decision), and generated,
 * static and data are outputs and fixtures. Everything else is in scope, including middleware and
 * auth, because "does the server change what it does because of this value" is not a question only
 * four directories can answer.
 */
const SKIP_DIRS = ['storage', 'generated', 'static', 'data', 'types', 'schemas'];

const EXEMPTIONS = join(ROOT, 'security', 'trusted-key-exemptions.json');

/** Identities no owner-scoped principal can address, so a key under one is already out of reach. */
const SYSTEM_IDENTITIES = ['__network_policy__', 'SITE_OWNER_GAII', '__genesis__', 'system@', '__system__'];

/** Marker that turns an exemption into countable debt instead of a claim someone stands behind. */
const UNREVIEWED = 'UNREVIEWED';

/**
 * Shortest thing that can carry a reason. "ok", "user data" and "fine" are not reasons; they are the
 * same silence the file exists to prevent, typed out. The number is arbitrary and its job is only to
 * make the shortest possible dodge cost more than writing the sentence.
 */
const MIN_REASON = 25;

export interface Finding {
    file: string;
    line: number;
    key: string;
    identity: string;
    /** How the key argument was read: an inline literal, a named constant, or a key builder. */
    via: 'literal' | 'constant' | 'builder';
}

export interface Scanned { file: string; source: string }
export interface ScanResult {
    findings: Finding[];
    /** Reads whose key is built from values only the running server knows. Not judged, but counted. */
    unresolved: number;
    /** Reads the denylist already covers, and reads under a synthetic system identity. */
    reserved: number;
    systemIdentity: number;
}

interface ExemptionFile { note: string; exempt: Record<string, string> }

function walk(dir: string, out: string[] = [], depth = 0): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        if (depth === 0 && SKIP_DIRS.includes(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out, depth + 1);
        else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** True when the key sits under a prefix the reserved-key guard already refuses for app tokens. */
function isReserved(key: string): boolean {
    return RESERVED_OWNER_KEY_PREFIXES.some(p => key.startsWith(p));
}

/**
 * Blanks comments while keeping every byte's position, so line numbers stay honest and a docblock
 * showing `storage.getMemory(sellerGhii, appToolsKey(appId))` as an example stops being a finding.
 */
export function stripComments(source: string): string {
    const blank = (m: string) => m.replace(/[^\n]/g, ' ');
    return source
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));
}

/** A key-shaped string: no whitespace, no path separators, short enough to be an address. */
function isKeyish(value: string): boolean {
    return value.length > 0 && value.length <= 120 && /^[A-Za-z0-9_.:@#$%|~-]+$/.test(value);
}

/**
 * `const ACCOUNTANTS_KEY = 'finance.accountants'` and its `export` form, which is how the H-6 key
 * was written and why the first version of this gate never saw it.
 */
export function collectKeyConstants(source: string, exportedOnly = false): Map<string, string> {
    const out = new Map<string, string>();
    const re = exportedOnly
        ? /(?:^|[;{}\n])\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`\n]*?)(?:\$\{|\2)/g
        : /(?:^|[;{}\n])\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`\n]*?)(?:\$\{|\2)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
        const [, name, , value] = m;
        if (isKeyish(value)) out.set(name, value);
    }
    return out;
}

/**
 * Key builders: `const holdKey = (id: string) => \`commerce.hold.${id}\`` and the `function` form.
 * Only the literal prefix is taken, which is all a prefix denylist needs anyway.
 */
export function collectKeyBuilders(source: string, exportedOnly = false): Map<string, string> {
    const out = new Map<string, string>();
    const lead = exportedOnly ? 'export\\s+' : '(?:export\\s+)?';
    const arrow = new RegExp(`${lead}const\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]*)?=\\s*\\(?[^)=\\n]*\\)?\\s*(?::\\s*string\\s*)?=>\\s*\`([^\`$\\n]*)\\$\\{`, 'g');
    const fn = new RegExp(`${lead}function\\s+([A-Za-z_$][\\w$]*)\\s*\\([^)]*\\)[^{\\n]*\\{\\s*return\\s+\`([^\`$\\n]*)\\$\\{`, 'g');
    for (const re of [arrow, fn]) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(source))) {
            const [, name, prefix] = m;
            if (isKeyish(prefix)) out.set(name, prefix);
        }
    }
    return out;
}

/**
 * The top-level arguments of a call whose `(` sits at `open`. Depth-aware, so `appToolsKey(appId)`
 * arrives as one argument rather than two halves, and quoted commas do not split anything.
 */
export function splitCallArgs(source: string, open: number, max = 600): string[] {
    const args: string[] = [];
    let depth = 0;
    let quote = '';
    let current = '';
    for (let i = open + 1; i < source.length && i < open + max; i++) {
        const ch = source[i];
        if (quote) {
            current += ch;
            if (ch === quote && source[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue; }
        if ('([{'.includes(ch)) { depth++; current += ch; continue; }
        if (')]}'.includes(ch)) {
            if (ch === ')' && depth === 0) { args.push(current.trim()); return args; }
            depth--; current += ch; continue;
        }
        if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
        current += ch;
    }
    if (current.trim()) args.push(current.trim());
    return args;
}

/**
 * A function that hands somebody else's key to storage: `readList(storage, ownerGhii, key)` around
 * `storage.getMemory(ownerGhii, key)`. THIS is the shape the August audit's H-6 finding hid in, and
 * a scanner that stops at the storage call sees only a parameter name. Resolution therefore moves up
 * one frame, to the call site, where the constant is spelled.
 */
export interface Forwarder {
    /** Argument position holding the key, and the one holding the identity (-1 when it is not a parameter). */
    keyIndex: number;
    identityIndex: number;
}

type Resolved = { key: string; via: Finding['via'] } | null;

/** Everything a file can consult to answer "what key is this": its own names first, then exports. */
export interface Tables {
    consts: Map<string, string>;
    builders: Map<string, string>;
    forwarders: Map<string, Forwarder>;
    sharedConsts: Map<string, string | null>;
    sharedBuilders: Map<string, string | null>;
    sharedForwarders: Map<string, Forwarder | null>;
}

/**
 * What key does this argument ask for? A literal answers directly; an identifier is looked up in the
 * file's own constants first and the exported constants of the whole server second; a call is looked
 * up among the key builders. `a ?? b` resolves through its first resolvable side, which is the shape
 * `getMemory(x, holdKey(id)) ?? getMemory(x, holdInKey(id))` produces.
 */
export function resolveKeyExpression(expr: string, t: Tables): Resolved {
    const trimmed = expr.trim();
    if (!trimmed) return null;

    const literal = /^(['"])([^'"]*)\1$/.exec(trimmed);
    if (literal && isKeyish(literal[2])) return { key: literal[2], via: 'literal' };

    const template = /^`([^`$]*)(?:\$\{|`)/.exec(trimmed);
    if (template && isKeyish(template[1])) return { key: template[1], via: 'literal' };

    const ident = /^([A-Za-z_$][\w$]*)$/.exec(trimmed);
    if (ident) {
        const local = t.consts.get(ident[1]);
        if (local) return { key: local, via: 'constant' };
        // null means the name is exported from two files with different values: guessing which one
        // this file imported would be worse than admitting the read is unresolved.
        const shared = t.sharedConsts.get(ident[1]);
        if (shared) return { key: shared, via: 'constant' };
        return null;
    }

    const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(trimmed);
    if (call) {
        const local = t.builders.get(call[1]);
        if (local) return { key: local, via: 'builder' };
        const shared = t.sharedBuilders.get(call[1]);
        if (shared) return { key: shared, via: 'builder' };
        return null;
    }

    for (const side of trimmed.split('??')) {
        if (side.trim() === trimmed) break;
        const r = resolveKeyExpression(side, t);
        if (r) return r;
    }
    return null;
}

/** Parameter names of a `(a, b: string, c = 1)` list, positionally. Destructuring yields ''. */
function paramNames(list: string): string[] {
    return splitCallArgs(`(${list})`, 0, list.length + 2)
        .map(p => /^([A-Za-z_$][\w$]*)/.exec(p.replace(/^\s*(?:readonly|public|private|protected)\s+/, ''))?.[1] ?? '');
}

/** The body of a block that opens at `open`, by brace matching. Strings are already comment-free. */
function blockBody(source: string, open: number, max = 4000): string {
    let depth = 0;
    for (let i = open; i < source.length && i < open + max; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') { depth--; if (!depth) return source.slice(open, i); }
    }
    return source.slice(open, Math.min(source.length, open + max));
}

/**
 * Functions whose own parameter is the key they read. Both the `function` and the arrow form; a
 * class method is left out on purpose, because a method reaches its collaborators through `this` and
 * the call site rarely spells the key either.
 */
export function scanForwarders(source: string, exportedOnly = false): {
    byName: Map<string, Forwarder>;
    /** Offsets of the storage calls a forwarder owns, judged at its call sites instead of here. */
    innerReads: Set<number>;
} {
    const byName = new Map<string, Forwarder>();
    const innerReads = new Set<number>();
    const lead = exportedOnly ? 'export\\s+' : '(?:export\\s+)?';
    const heads = [
        new RegExp(`${lead}(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)[^{;]*\\{`, 'g'),
        new RegExp(`${lead}const\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]*)?=\\s*(?:async\\s*)?\\(([^)]*)\\)[^={]*=>\\s*\\{`, 'g'),
    ];
    for (const re of heads) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(source))) {
            const [, name, params] = m;
            const names = paramNames(params);
            if (!names.length) continue;
            const bodyStart = source.indexOf('{', m.index + m[0].length - 1);
            if (bodyStart < 0) continue;
            const body = blockBody(source, bodyStart);
            const read = /\b(?:getMemory|getPublicMemory)\s*\(/g;
            let r: RegExpExecArray | null;
            while ((r = read.exec(body))) {
                const args = splitCallArgs(body, r.index + r[0].length - 1);
                if (args.length < 2) continue;
                const keyIndex = names.indexOf(args[1].trim());
                if (keyIndex < 0) continue;
                if (!byName.has(name)) byName.set(name, { keyIndex, identityIndex: names.indexOf(args[0].trim()) });
                innerReads.add(bodyStart + r.index);
            }
        }
    }
    return { byName, innerReads };
}

export function collectKeyForwarders(source: string, exportedOnly = false): Map<string, Forwarder> {
    return scanForwarders(source, exportedOnly).byName;
}

/** Merges a name into a shared table, marking it null when two files disagree about its value. */
function share<T>(table: Map<string, T | null>, from: Map<string, T>, same: (a: T, b: T) => boolean): void {
    for (const [name, value] of from) {
        if (!table.has(name)) { table.set(name, value); continue; }
        const seen = table.get(name);
        if (seen === null || seen === undefined || !same(seen, value)) table.set(name, null);
    }
}

/**
 * The scan proper, over sources rather than paths, so its failing cases can be proven against a
 * fixture instead of the real tree.
 */
export function scanSources(inputs: Scanned[]): ScanResult {
    const prepared = inputs.map(i => {
        const source = stripComments(i.source);
        const fwd = scanForwarders(source);
        return {
            file: i.file,
            source,
            consts: collectKeyConstants(source),
            builders: collectKeyBuilders(source),
            forwarders: fwd.byName,
            innerReads: fwd.innerReads,
        };
    });

    // Only EXPORTED names cross a file boundary, so only those go in the shared tables. A file-local
    // constant with a popular name (KEY, PREFIX) would otherwise answer for a read in a file that
    // never imported it.
    const sharedConsts = new Map<string, string | null>();
    const sharedBuilders = new Map<string, string | null>();
    const sharedForwarders = new Map<string, Forwarder | null>();
    const sameString = (a: string, b: string) => a === b;
    for (const p of prepared) {
        share(sharedConsts, collectKeyConstants(p.source, true), sameString);
        share(sharedBuilders, collectKeyBuilders(p.source, true), sameString);
        share(sharedForwarders, collectKeyForwarders(p.source, true),
            (a, b) => a.keyIndex === b.keyIndex && a.identityIndex === b.identityIndex);
    }

    const findings: Finding[] = [];
    let unresolved = 0;
    let reserved = 0;
    let systemIdentity = 0;

    for (const p of prepared) {
        const t: Tables = {
            consts: p.consts, builders: p.builders, forwarders: p.forwarders,
            sharedConsts, sharedBuilders, sharedForwarders,
        };
        const at = (index: number) => p.source.slice(0, index).split('\n').length;

        /** One judged read: reserved and system-identity reads leave nothing behind but silence. */
        const record = (index: number, identity: string, keyExpr: string): void => {
            const resolved = resolveKeyExpression(keyExpr, t);
            if (!resolved) { unresolved++; return; }
            if (isReserved(resolved.key)) { reserved++; return; }
            if (isSystemIdentity(identity, t)) { systemIdentity++; return; }
            findings.push({
                file: p.file, line: at(index), key: resolved.key,
                identity: identity.trim().slice(0, 40), via: resolved.via,
            });
        };

        const direct = /\b(?:getMemory|getPublicMemory)\s*\(/g;
        let m: RegExpExecArray | null;
        while ((m = direct.exec(p.source))) {
            const args = splitCallArgs(p.source, m.index + m[0].length - 1);
            // A forwarder's own storage call is judged at ITS call sites, where the key is spelled.
            if (p.innerReads.has(m.index)) continue;
            if (args.length < 2) { unresolved++; continue; }
            record(m.index, args[0], args[1]);
        }

        // A prefix scan is a read of every key under that prefix, and `listAllMemory` scans EVERY
        // owner's namespace: `listAllMemory({ prefix: 'bensplit.' })` pays out on what it finds
        // there. Whatever the server then acts on has to be as unwritable as a single key would be.
        const perOwner = /\b(?:listMemory|listMemoryMeta|listMemoryForOwners|listMemoryMetaForOwners)\s*\(/g;
        while ((m = perOwner.exec(p.source))) {
            const args = splitCallArgs(p.source, m.index + m[0].length - 1);
            const prefix = args.length > 1 ? prefixOption(args[1]) : null;
            if (!prefix) continue;
            record(m.index, args[0], prefix);
        }
        const allOwners = /\blistAllMemory\s*\(/g;
        while ((m = allOwners.exec(p.source))) {
            const prefix = prefixOption(splitCallArgs(p.source, m.index + m[0].length - 1)[0] ?? '');
            if (prefix) record(m.index, '', prefix);
        }
        const byPrefix = /\blistMemoryKeysByPrefix\s*\(/g;
        while ((m = byPrefix.exec(p.source))) {
            const args = splitCallArgs(p.source, m.index + m[0].length - 1);
            if (args.length) record(m.index, '', args[0]);
        }

        // Calls to a key-forwarding helper: the frame where the constant is actually named.
        for (const [name, fwd] of [...p.forwarders, ...sharedForwarders]) {
            if (!fwd) continue;
            if (p.forwarders.has(name) && p.forwarders.get(name) !== fwd) continue;
            const re = new RegExp(`(?<![.\\w$])${name}\\s*\\(`, 'g');
            let c: RegExpExecArray | null;
            while ((c = re.exec(p.source))) {
                const args = splitCallArgs(p.source, c.index + c[0].length - 1);
                if (args.length <= fwd.keyIndex) continue;
                if (isDefinitionSite(p.source, c.index)) continue;
                record(c.index, fwd.identityIndex >= 0 ? (args[fwd.identityIndex] ?? '') : '', args[fwd.keyIndex]);
            }
        }
    }
    return { findings, unresolved, reserved, systemIdentity };
}

/**
 * An identity no owner-scoped principal can address. The `__name__` convention is read as the rule
 * rather than a fixed list: `__network_policy__`, `__genesis__` and `__federation_book__` all follow
 * it, and the next one should be recognised on the day it is written rather than the day someone
 * remembers to add it here.
 */
function isSystemIdentity(expr: string, t: Tables): boolean {
    const raw = expr.trim();
    const synthetic = (s: string) => /^__[A-Za-z0-9_]+__$/.test(s) || SYSTEM_IDENTITIES.some(k => s.includes(k));
    if (synthetic(raw.replace(/^['"`]|['"`]$/g, ''))) return true;
    // The identity can be behind a name too: `securityOwner(nodeId)` builds `security-system@<node>`,
    // and reading the resolved value is the only way to see that.
    const resolved = resolveKeyExpression(raw, t);
    return !!resolved && synthetic(resolved.key);
}

/** The `{ prefix: 'x.' }` of a list call. Absent means "everything", which no denylist can help. */
function prefixOption(objectExpr: string): string | null {
    const m = /\bprefix\s*:\s*([^,}]+)/.exec(objectExpr);
    return m ? m[1].trim() : null;
}

/** The `function foo(` of the definition itself is not a call to foo. */
function isDefinitionSite(source: string, index: number): boolean {
    return /(?:function|const|let|var)\s+$/.test(source.slice(Math.max(0, index - 30), index));
}

export function collectReads(files: string[]): Finding[] {
    return scanSources(files.map(f => ({
        file: relative(ROOT, f).replace(/\\/g, '/'),
        source: readFileSync(f, 'utf-8'),
    }))).findings;
}

const softKey = (f: Finding) => `${f.file}:${f.key}`;

/**
 * An exemption says the server does not act on this key. Empty prose says nothing at all, and that
 * silence is what left `finance.accountants` and `commerce.psp` off the denylist for two months.
 */
export function validateReasons(exempt: Record<string, string>): { reasonless: string[]; unreviewed: string[] } {
    const reasonless: string[] = [];
    const unreviewed: string[] = [];
    for (const [key, reason] of Object.entries(exempt)) {
        const text = (reason ?? '').trim();
        if (text.length < MIN_REASON) reasonless.push(key);
        else if (text.startsWith(UNREVIEWED)) unreviewed.push(key);
    }
    return { reasonless, unreviewed };
}

function loadExemptions(): ExemptionFile {
    if (!existsSync(EXEMPTIONS)) return { note: '', exempt: {} };
    return JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
}

const SEED_NOTE = `${UNREVIEWED}: seeded from the state on the day the gate learned to resolve this key. `
    + 'Nobody has yet said whether the server ACTS on this value (a URL it fetches, a credential, a '
    + 'policy, a budget, an authorization list) or merely hands it back as the user\'s own data. If it '
    + 'acts on it, reserve the prefix in src/utils/reserved-keys.ts or move it under a system identity.';

/** Seeding MERGES: a reason someone wrote is never overwritten by a placeholder. */
function seed(findings: Finding[]): void {
    const previous = loadExemptions().exempt;
    const exempt: Record<string, string> = {};
    for (const f of findings.map(softKey).sort()) exempt[f] = previous[f] ?? SEED_NOTE;
    const kept = Object.keys(exempt).filter(k => previous[k]).length;
    writeFileSync(EXEMPTIONS, JSON.stringify({
        note: 'Memory keys the server reads that are neither reserved nor under a system identity. A ratchet: '
            + 'the list may shrink and never grow silently. Every entry carries prose saying why the server does '
            + 'not act on this value; an empty reason fails the gate, and one that starts with UNREVIEWED counts '
            + 'as backlog rather than as a claim anyone has made.',
        exempt,
    } as ExemptionFile, null, 2) + '\n');
    console.log(`Seeded ${findings.length} reads as ${Object.keys(exempt).length} entries in `
        + `${relative(ROOT, EXEMPTIONS)} (${kept} existing reasons kept word for word)`);
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const files = walk(SRC);
    if (!files.length) {
        console.error(`✖ scanned no files under ${SRC}. Run this from the aimeat package directory.`);
        process.exit(1);
    }

    const { findings, unresolved, reserved, systemIdentity } = scanSources(files.map(f => ({
        file: relative(ROOT, f).replace(/\\/g, '/'),
        source: readFileSync(f, 'utf-8'),
    })));

    if (process.argv.includes('--seed')) { seed(findings); return; }

    const { exempt } = loadExemptions();
    const known = new Set(Object.keys(exempt));
    const fresh = findings.filter(f => !known.has(softKey(f)));
    const stale = [...known].filter(k => !findings.some(f => softKey(f) === k));
    const { reasonless, unreviewed } = validateReasons(exempt);
    const distinct = new Set(findings.map(f => f.key));
    const viaConstant = findings.filter(f => f.via !== 'literal').length;

    console.log('');
    console.log('  Server-trusted memory keys — Rule 10 invariant 2');
    console.log('  ' + '─'.repeat(62));
    console.log(`  reads outside the guard   ${String(findings.length).padStart(4)}   (${distinct.size} distinct keys)`);
    console.log(`  found via a constant      ${String(viaConstant).padStart(4)}   (invisible to a literal-only scan)`);
    console.log(`  covered by the denylist   ${String(reserved).padStart(4)}   ${RESERVED_OWNER_KEY_PREFIXES.join(' ')}`);
    console.log(`  under a system identity   ${String(systemIdentity).padStart(4)}   (out of reach of an owner-scoped token)`);
    console.log(`  key not resolvable        ${String(unresolved).padStart(4)}   (built from runtime values, not judged)`);
    console.log(`  exempt, reason written    ${String(known.size - unreviewed.length - reasonless.length).padStart(4)}`);
    console.log(`  exempt, UNREVIEWED        ${String(unreviewed.length).padStart(4)}   (backlog, may only shrink)`);
    console.log(`  NEW, not exempt           ${String(fresh.length).padStart(4)}`);
    console.log('');

    if (fresh.length) {
        console.log('  If the server ACTS on this value, an app the owner granted memory:write can poison it.');
        console.log('  Reserve the prefix (utils/reserved-keys.ts), move it under a system identity, or record');
        console.log('  in security/trusted-key-exemptions.json why it is user data rather than configuration.');
        console.log('');
        for (const f of fresh) console.log(`    ${f.file}:${f.line}  ${f.key}   (read via ${f.via})`);
        console.log('');
    }

    if (reasonless.length) {
        console.log('  These exemptions name a key and give no reason. A key name is a filing, not a claim:');
        console.log(`  write the sentence saying why the server does not act on it (at least ${MIN_REASON} characters),`);
        console.log(`  or prefix it with ${UNREVIEWED} so it counts as backlog rather than as an answer.`);
        console.log('');
        for (const k of reasonless) console.log(`    ${k}`);
        console.log('');
    }

    if (stale.length) {
        console.log(`  ${stale.length} exemption(s) match no read any more — delete them, that is the ratchet turning:`);
        for (const k of stale) console.log(`    ${k}`);
        console.log('');
    }

    if (strict && (fresh.length || reasonless.length)) {
        const parts = [
            fresh.length ? `${fresh.length} new unguarded server-read key(s)` : '',
            reasonless.length ? `${reasonless.length} exemption(s) without a reason` : '',
        ].filter(Boolean);
        console.error(`✖ ${parts.join(', ')}.`);
        process.exit(1);
    }
    console.log(fresh.length || reasonless.length
        ? '  (report only — pass --strict to gate)'
        : '  ✓ no new unguarded server-read keys, and every exemption carries a reason');
}

// Run only when invoked as the script. The unit test imports scanSources() to prove the failing
// cases against a fixture, and an import that gated the whole build as a side effect would be a
// surprise nobody expects from a function call.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
