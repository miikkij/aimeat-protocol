/**
 * @file no-owner-key-sign-in.test.ts
 * @description No test, script or Python test signs an OWNER in with the account key: a POST to
 *   /v1/auth/token whose body is `{ owner, timestamp, signature }`, the signature made over
 *   `owner + node id + timestamp`. Node 4.0.0 removes that sign-in (OWNER_KEY_LOGIN_REMOVED_IN in
 *   src/config-security.ts), so a file that still uses it stops at its first request on 4.0.0.
 *   An owner signs in with the password instead: test/helpers/owner-login.ts (registerOwner,
 *   ownerSignIn, ownerToken) for a suite, POST /v1/ghii/login anywhere else.
 *
 *   On 2026-10-12 about four hundred suites, `pnpm sandbox` and the auth SDK used it, and moving
 *   them was the last thing between the code and a 4.0.0 release. This keeps a new file from
 *   bringing it back. The AGENT sign-in on the same route (`{ gaii, timestamp, signature }`) is not
 *   removed and is not looked for.
 *
 *   How a file is read: only a file that names `auth/token` outside a comment line is looked at, and
 *   in it an object that puts `owner` beside `timestamp` (`{ owner: x, timestamp: t, ...}`,
 *   `{ owner, timestamp, signature }`, `{"owner": x, "timestamp": t}`), or a signature message built
 *   as `name + NODE_ID + timestamp`, or a key chosen as `"gaii" if agent else "owner"`, is the
 *   owner-key sign-in. ALLOWED names the files whose subject is that sign-in itself.
 * @usage cd aimeat && pnpm exec vitest run test/unit/no-owner-key-sign-in.test.ts
 * @version-history
 *   v1.0.1 — 2026-10-13 — test/e2e-agent-ties.ts leaves ALLOWED: its owner signs in with the password now.
 *   v1.0.0 — 2026-10-12 — Initial (wish-e2e-testit-ja-sandbox-kirjautuvat-omistaja-avaimella-joka-po).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = resolve(AIMEAT, '..');

/** Where to look, from the repository root. */
const ROOTS = ['aimeat/test', 'aimeat/scripts', 'python/aimeat-crewai/tests'];

/** Files whose subject is the owner-key sign-in itself, with the reason. Paths from the repository root. */
const ALLOWED: Record<string, string> = {
    'aimeat/test/unit/removals-4-0-0.test.ts':
        'Proves the owner-key sign-in is refused from 4.0.0 whatever the setting says, and still accepted with the Deprecation headers before it.',
    'aimeat/test/e2e-account-security-gate.ts':
        'One assertion proves the key from before a password change no longer signs in: 401 while the owner-key sign-in is on, 410 OWNER_KEY_LOGIN_OFF once it is gone. Its owners sign in with the password.',
    'aimeat/test/e2e-owner-deactivation.ts':
        'One test proves a deactivated account gets no session through the owner-key sign-in: 403 ACCOUNT_DISABLED while it is on, 410 OWNER_KEY_LOGIN_OFF once it is gone. Its owners sign in with the password.',
    'aimeat/test/unit/no-owner-key-sign-in.test.ts':
        'This guard: its own patterns and examples name the sign-in it looks for.',
};

const SKIP_DIRS = new Set(['node_modules', 'fixtures', '.pytest_cache', '__pycache__']);

function filesUnder(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const name of entries) {
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) filesUnder(path, out);
        else if (/\.(ts|mts|mjs|js|py)$/.test(name)) out.push(path);
    }
    return out;
}

const COMMENT_LINE = /^\s*(\*|\/\/|#|\/\*)/;
const OWNER_BODY = [
    /["']?\bowner["']?\s*:\s*[^,}\n]{1,80},\s*["']?timestamp["']?\s*[:,}]/,   // { owner: x, timestamp: t }
    /\{\s*owner\s*,\s*timestamp\b/,                                           // { owner, timestamp, signature }
    /["']gaii["']\s+if\s+\w+\s+else\s+["']owner["']/,                         // key = "gaii" if is_agent else "owner"
    /\?\s*\{\s*gaii[^}]*\}\s*:\s*\{\s*owner\b/,                               // isAgent ? { gaii, ... } : { owner, ... }
];

/**
 * `name + NODE_ID + ts`, the owner-key message. The same shape with an agent's identity on the left
 * (`gaii + NODE_ID + ts`) is the agent's MCP authorize signature, which is not removed.
 */
const OWNER_MESSAGE = /([\w.]+)\s*\+\s*(?:NODE_ID|nodeId|node_id|NODE)\s*\+\s*(?:ts|timestamp|now|t)\b/g;

/** The lines of a file that are code, joined back, so a pattern never matches inside a comment. */
function codeOf(src: string): string {
    return src.split('\n').filter(line => !COMMENT_LINE.test(line)).join('\n');
}

/** Whether a file's code signs an owner in with the account key. */
export function signsOwnerInWithKey(src: string): boolean {
    const code = codeOf(src);
    if (!code.includes('auth/token')) return false;
    if (OWNER_BODY.some(re => re.test(code))) return true;
    return [...code.matchAll(OWNER_MESSAGE)].some(m => !/gaii|agent/i.test(m[1]));
}

describe('no file signs an owner in with the account key (removed in node 4.0.0)', () => {
    it('the patterns find the owner-key sign-in in each of its shapes, and not the agent sign-in', () => {
        const ownerShapes = [
            `await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });`,
            `const r = await post('/v1/auth/token', { owner, timestamp, signature });`,
            `const sig = await sign(priv, name + NODE_ID + ts);\nawait api('/v1/auth/token', { method: 'POST', body });`,
            `key = "gaii" if is_agent else "owner"\nrequests.post(f"{base}/v1/auth/token", json={key: ident})`,
            `const payload = isAgent ? { gaii: id, timestamp, signature } : { owner: id, timestamp, signature };\nawait json('/v1/auth/token', payload);`,
            `requests.post(f"{base}/v1/auth/token", json={"owner": name, "timestamp": ts, "signature": sig})`,
        ];
        for (const shape of ownerShapes) expect(signsOwnerInWithKey(shape), shape).toBe(true);
        const agentShapes = [
            `await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(key, gaii + ts) }) });`,
            `// an owner used to sign in here: { owner: name, timestamp: ts } to /v1/auth/token\nawait ownerToken(BASE, name);`,
            `await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password }) });`,
            `const sig = await signMsg(priv, gaii + NODE_ID + ts); // the agent's MCP authorize\nawait json('/v1/auth/token', { body: JSON.stringify({ gaii, timestamp: ts, signature }) });`,
        ];
        for (const shape of agentShapes) expect(signsOwnerInWithKey(shape), shape).toBe(false);
    });

    it('no test, script or Python test outside ALLOWED uses it', () => {
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const file of filesUnder(join(REPO, root))) {
                const rel = relative(REPO, file).replace(/\\/g, '/');
                if (rel in ALLOWED) continue;
                if (signsOwnerInWithKey(readFileSync(file, 'utf8'))) offenders.push(rel);
            }
        }
        expect(offenders, 'These files sign an owner in with the account key (POST /v1/auth/token with an owner signature), which node 4.0.0 removes. '
            + 'Sign the owner in with the password instead: registerOwner / ownerSignIn / ownerToken from aimeat/test/helpers/owner-login.ts, '
            + 'or POST /v1/ghii/login. A file whose subject is that sign-in itself goes into ALLOWED with the reason.').toEqual([]);
    });

    it('every ALLOWED file still exists and still uses it, so the list cannot outlive its reasons', () => {
        for (const rel of Object.keys(ALLOWED)) {
            if (rel.endsWith('no-owner-key-sign-in.test.ts')) continue;
            const src = readFileSync(join(REPO, rel), 'utf8');
            expect(signsOwnerInWithKey(src), rel).toBe(true);
        }
    });
});
