/**
 * @file scripts/check-blocked-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a served file whose address a common content blocker blocks.
 *
 *   WHY. On 2026-11-09 the admin page and the Contexts page showed "Failed to load page" in every
 *   browser with a content blocker. EasyPrivacy has the rule `/fingerprint.js^`, a new component was
 *   called /components/Fingerprint.js, and a blocked static import fails every module that imports
 *   it. The server answered 200, the importmap was in sync, and every test passed, because every
 *   test runs a browser without extensions. Nothing in the repository knew the lists existed.
 *
 *   WHAT IT DOES. Downloads EasyList, EasyPrivacy and uBlock Origin's Privacy list (the lists uBlock
 *   Origin and Adblock Plus turn on by default), keeps them for seven days in
 *   node_modules/.cache/aimeat-blocker-lists/, and asks of every tracked file the node serves
 *   whether one of their network rules blocks it as a first-party request on aimeat.io
 *   (scripts/lib/blocker-rules.ts says which rules count). A match is refused with the rule that
 *   matched; rename the file. A match that is right to keep goes into ALLOWED with its reason.
 *
 *   THE ADDRESSES. public/<path> is served at /<path>. The library bundles in
 *   src/static/sdk-libs/dist/ are served at /lib/<name> and /v1/libs/<name>, and the app catalogue's
 *   files under src/static/app-catalog/ at /app-catalog/<path>; both are checked under those
 *   addresses.
 *
 *   OFFLINE. With no network and a cached copy, the cached copy is used whatever its age. With no
 *   network and no copy, the check says so and passes: a gate that fails on a network blip gets
 *   switched off, and CI, which always has the network, still runs it on every push.
 * @structure LISTS · ALLOWED · servedFiles() · loadList() · main()
 * @usage
 *   cd aimeat && pnpm check:blocked-names
 *   cd aimeat && pnpm check:blocked-names --url /components/Fingerprint.js   # ask about one address
 *   cd aimeat && pnpm check:blocked-names --refresh                          # fetch the lists now
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockingRule, parseRules, resourceType, type Rule } from './lib/blocker-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'node_modules', '.cache', 'aimeat-blocker-lists');
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const HOST = 'aimeat.io';

const LISTS: Array<{ name: string; url: string }> = [
    { name: 'easylist', url: 'https://easylist.to/easylist/easylist.txt' },
    { name: 'easyprivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
    { name: 'ublock-privacy', url: 'https://ublockorigin.github.io/uAssets/filters/privacy.txt' },
];

/** A served address a rule matches, kept on purpose. Key: the address; value: why it may stay. */
const ALLOWED: Record<string, string> = {};

/** Every tracked file the node serves, with the addresses a browser asks for it at. */
function servedFiles(): Array<{ file: string; urls: string[] }> {
    const tracked = execFileSync('git', ['ls-files', 'public', 'src/static/sdk-libs/dist', 'src/static/app-catalog'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean);
    return tracked.map((file) => {
        if (file.startsWith('public/')) return { file, urls: [`/${file.slice('public/'.length)}`] };
        if (file.startsWith('src/static/sdk-libs/dist/')) {
            const name = file.slice('src/static/sdk-libs/dist/'.length);
            return { file, urls: [`/lib/${name}`, `/v1/libs/${name}`] };
        }
        return { file, urls: [`/app-catalog/${file.slice('src/static/app-catalog/'.length)}`] };
    });
}

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.text();
}

/** One list's text: the cached copy when fresh, else downloaded; a stale copy when offline. */
async function loadList(name: string, url: string, refresh: boolean): Promise<string | null> {
    const path = join(CACHE, `${name}.txt`);
    const cached = existsSync(path);
    if (cached && !refresh && Date.now() - statSync(path).mtimeMs < MAX_AGE_MS) return readFileSync(path, 'utf8');
    try {
        const text = await fetchText(url);
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(path, text);
        return text;
    } catch (e) {
        if (cached) {
            console.log(`  ! ${name}: could not refresh (${(e as Error).message}); using the cached copy`);
            return readFileSync(path, 'utf8');
        }
        console.log(`  ! ${name}: could not download (${(e as Error).message}) and no cached copy`);
        return null;
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const refresh = args.includes('--refresh');
    const urlArg = args.indexOf('--url') >= 0 ? args[args.indexOf('--url') + 1] : null;

    const rules: Array<{ list: string; rules: Rule[] }> = [];
    for (const l of LISTS) {
        const text = await loadList(l.name, l.url, refresh);
        if (text) rules.push({ list: l.name, rules: parseRules(text) });
    }
    if (!rules.length) {
        console.log('⚠ check:blocked-names SKIPPED: no filter list could be read (no network, no cached copy). CI runs it.');
        return;
    }

    const targets = urlArg ? [{ file: '(--url)', urls: [urlArg] }] : servedFiles();
    const hits: string[] = [];
    let allowed = 0;
    for (const t of targets) {
        for (const path of t.urls) {
            const url = `https://${HOST}${path}?v=0123456789`;
            const type = resourceType(path);
            for (const r of rules) {
                const rule = blockingRule(url, type, r.rules, HOST);
                if (!rule) continue;
                if (ALLOWED[path]) { allowed++; break; }
                hits.push(`  ✗ ${path}  (${t.file})\n      blocked by ${r.list}: ${rule.text}`);
                break;
            }
        }
    }

    const count = rules.reduce((n, r) => n + r.rules.length, 0);
    const files = targets.length;
    if (hits.length) {
        console.log(`✗ ${hits.length} served address(es) a content blocker blocks (${count} rules from ${rules.map((r) => r.list).join(', ')}):`);
        console.log(hits.join('\n'));
        console.log('\n  A blocked script fails every module that imports it, so its whole page does not load in a');
        console.log('  browser with a content blocker. Rename the file so the rule no longer matches.');
        process.exit(1);
    }
    console.log(`✓ no served address is blocked: ${files} file(s) against ${count} rules from ${rules.map((r) => r.list).join(', ')}${allowed ? `, ${allowed} allowed with a reason` : ''}`);
}

await main();
