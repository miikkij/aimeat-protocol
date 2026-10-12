/**
 * @file test/unit/no-legacy-ai-settings-callers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description No first-party code calls the AI settings routes from before providers:
 *   /v1/openrouter/settings, /v1/openrouter/models and /v1/openrouter/test. Node 4.0.0 removes them
 *   (AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN in src/config-ai-models.ts; from it they answer 410 GONE),
 *   so a screen, a served lib or the desktop app that still calls one stops working on 4.0.0.
 *   The successors are /v1/ai/providers (+ /:id, /:id/key, /:id/test), /v1/ai/models,
 *   /v1/ai/available and /v1/ai/capabilities. GET and POST /v1/ai/settings are not removed and are
 *   not looked for.
 *
 *   On 2026-10-12 the Profile AI page, the calibrator, the inbox's voice transcription, the
 *   app-catalog AI checks, the offers "find by need" button and the desktop app's AI connector
 *   called them. This keeps a new file from bringing a call back.
 *
 *   How a file is read: comment lines are dropped, and a CALL is the path where a request starts:
 *   right after a quote or a backtick (`'/v1/openrouter/settings'`), after an interpolation or a
 *   format placeholder (`${base}/v1/...`, `{}/v1/...`), or inside a full URL
 *   (`"http://localhost:40050/v1/..."`). A sentence that names the route after a method word
 *   (`'DELETE /v1/openrouter/settings (the AI settings page)'`) is not a call. The routes' own file
 *   (src/routes/openrouter.ts) is not read. ALLOWED names a file that calls one with the reason.
 *
 *   A screen may call a removed route FIRST, so a node where the routes still answer (3.x) behaves
 *   exactly as before, and take the provider path when it answers 410 GONE. Its ALLOWED reason is
 *   LEGACY_FIRST, and the file must show it handles the 410 (handlesLegacyGone).
 * @usage cd aimeat && pnpm exec vitest run test/unit/no-legacy-ai-settings-callers.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-13 — LEGACY_FIRST: the AI page, the calibrator, the inbox voice hook, the app
 *     catalogue checks and the offers search call the legacy route first again, through legacyOr()
 *     (public/js/services/ai-connection.js); a file listed with that reason must handle the 410.
 *   v1.0.0 — 2026-10-12 — Initial (the 4.0.0 sweep: the first-party callers of the removed AI settings routes).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = resolve(AIMEAT, '..');

/** Where to look, from the repository root. aimeat/src covers aimeat/src/static. */
const ROOTS = ['aimeat/public', 'aimeat/src', 'aimeat-desktop/src-tauri/src'];

/** The routes' own declarations: not a caller. */
const NOT_CALLERS = new Set(['aimeat/src/routes/openrouter.ts']);

/**
 * The reason of a screen that calls the legacy route first and takes the provider path when it
 * answers 410 GONE, so a node where the routes still answer (3.x) sees exactly the calls it saw
 * before 2026-10-12 (ruled for the 4.0.0 sweep on 2026-10-13). Such a file must show that it handles
 * the 410: it calls legacyOr() from public/js/services/ai-connection.js, or, in a bundle that does
 * not load public/js (the old app catalogue), it tests a response's status against 410 itself.
 */
const LEGACY_FIRST = 'legacy route first, provider path on 410 (3.x unchanged)';

/** Files that call a removed route, with the reason. Paths from the repository root. */
const ALLOWED: Record<string, string> = {
    // The older AI panel the notebook card and the workspace generator embed; on 3.x it also keeps
    // its five model roles and its retry setting, which a provider has no place for.
    'aimeat/public/views/profile/openrouter-settings.js': LEGACY_FIRST,
    'aimeat/public/views/profile/ai-tab.js': LEGACY_FIRST,
    'aimeat/public/views/profile/calibrator-tab.js': LEGACY_FIRST,
    'aimeat/public/views/profile/inbox-tab/use-voice.js': LEGACY_FIRST,
    'aimeat/public/views/appcat/ai-calls.js': LEGACY_FIRST,
    'aimeat/public/js/services/offers.js': LEGACY_FIRST,
    'aimeat/src/static/app-catalog/js/detail.js': LEGACY_FIRST,
    // The old catalogue's built page: detail.js above, bundled by scripts/build-app-catalog.ts.
    'aimeat/src/static/app-catalog.html': LEGACY_FIRST,
    // NOT a reason to keep it: a move left undone on 2026-10-12 because `cargo check` cannot link on
    // the machine that made the sweep (no MSVC build tools), and an unchecked Rust edit is not shipped.
    // get_ai_settings becomes GET /v1/ai/providers (the owner's provider openrouter, lmstudio or
    // custom: id, base_url, capabilities.text.model, auth.has_key) and save_ai_endpoint becomes
    // PUT /v1/ai/providers/custom { type: 'openai-compatible', baseUrl, auth: { type: 'none' },
    // capabilities: { text: { enabled: true, pool: false, model } } }. Then this line goes.
    'aimeat-desktop/src-tauri/src/ai_connector.rs':
        'Not moved yet: the desktop app reads and saves its local AI server through /v1/openrouter/settings, so on node 4.0.0 its AI connector fails until it is moved to /v1/ai/providers.',
};

const SKIP_DIRS = new Set(['node_modules', 'target', 'vendor']);

function filesUnder(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const name of entries) {
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) filesUnder(path, out);
        else if (/\.(ts|mts|mjs|js|rs|html)$/.test(name)) out.push(path);
    }
    return out;
}

/**
 * The files git tracks under a root, or every file under it when git cannot answer (a tarball).
 * Tracked only: a build directory left in a checkout (the desktop app's src-tauri/target) is not
 * what ships. A tracked build output is read: app-catalog.html and the SDK's dist are served.
 */
function trackedUnder(root: string): string[] {
    const all = filesUnder(join(REPO, root));
    let tracked: Set<string>;
    try {
        tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', root], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            .split('\0').filter(Boolean));
    } catch { return all; }
    return all.filter(f => tracked.has(relative(REPO, f).replace(/\\/g, '/')));
}

const COMMENT_LINE = /^\s*(\*|\/\/|\/\*|<!--)/;

/** The path where a request starts: after a quote, an interpolation or placeholder, or a scheme and host. */
const LEGACY_CALL = /(?:['"`]|\}|https?:\/\/[^\s'"`]*?)\/v1\/openrouter\/(?:settings|models|test)\b/;

/** The lines of a file that are code, joined back, so a pattern never matches inside a comment. */
function codeOf(src: string): string {
    return src.split('\n').filter(line => !COMMENT_LINE.test(line)).join('\n');
}

/** Whether a file's code calls one of the removed AI settings routes. */
export function callsLegacyAiSettings(src: string): boolean {
    return LEGACY_CALL.test(codeOf(src));
}

/** A call of the shared switch, or a response status compared with 410 (`r.status === 410`). */
const HANDLES_GONE = /\blegacyOr\s*\(|\.status\s*===\s*410\b/;

/** Whether a file's code handles the 410 GONE of a removed route: the shared switch, or its own status test. */
export function handlesLegacyGone(src: string): boolean {
    return HANDLES_GONE.test(codeOf(src));
}

describe('no first-party code calls the AI settings routes node 4.0.0 removes', () => {
    it('the pattern finds a call in each of its shapes, and not a sentence or a comment', () => {
        const calls = [
            `const r = await apiGet('/v1/openrouter/settings');`,
            `await apiPut("/v1/openrouter/settings", body);`,
            'const m = await apiGet(`/v1/openrouter/models?modality=transcription`);',
            `const r = await apiPost('/v1/openrouter/test');`,
            `fetch(url + '/v1/openrouter/settings', { headers });`,
            'fetch(`${base}/v1/openrouter/models`);',
            `let url = format!("http://localhost:{}/v1/openrouter/settings", port);`,
            `requests.get("http://localhost:40050/v1/openrouter/settings")`,
        ];
        for (const shape of calls) expect(callsLegacyAiSettings(shape), shape).toBe(true);
        const notCalls = [
            `? 'DELETE /v1/openrouter/settings (the AI settings page)'`,
            `// GET /v1/openrouter/settings answered the old shape\nawait apiGet('/v1/ai/providers');`,
            ` * owner-only /v1/openrouter/settings. Falls back to that settings probe on older nodes.`,
            `/// PUT /v1/openrouter/settings (Bearer token) { provider: "custom", baseUrl, model }.`,
            `const r = await apiGet('/v1/ai/settings');`,
            `await apiPost('/v1/openrouter/complete', { prompt });`,
            `logger.warn('DELETE /v1/openrouter/settings: continuing after a suppressed failure');`,
        ];
        for (const shape of notCalls) expect(callsLegacyAiSettings(shape), shape).toBe(false);
    });

    it('no file outside ALLOWED calls one', () => {
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const file of trackedUnder(root)) {
                const rel = relative(REPO, file).replace(/\\/g, '/');
                if (rel in ALLOWED || NOT_CALLERS.has(rel)) continue;
                if (callsLegacyAiSettings(readFileSync(file, 'utf8'))) offenders.push(rel);
            }
        }
        expect(offenders, 'These files call /v1/openrouter/settings, /models or /test, which node 4.0.0 answers with 410 GONE. '
            + 'Use the successors: /v1/ai/providers (+ /:id, /:id/key, /:id/test) for the connection and its key '
            + '(public/js/services/ai-connection.js does it for a screen), /v1/ai/models for a model list, '
            + '/v1/ai/available for "is AI on", /v1/ai/capabilities for one capability, and /v1/ai/settings for the budget. '
            + 'A file that must call one goes into ALLOWED with the reason.').toEqual([]);
    // Reads a few thousand files; beside other suites on a busy machine that passes the 5 s default.
    }, 60_000);

    it('every ALLOWED file still exists and still calls one, so the list cannot outlive its reasons', () => {
        for (const rel of Object.keys(ALLOWED)) {
            const src = readFileSync(join(REPO, rel), 'utf8');
            expect(callsLegacyAiSettings(src), rel).toBe(true);
        }
    });

    it('the 410 test finds the shared switch and a status test, and not a plain call or a comment', () => {
        const handles = [
            `await legacyOr(async () => apiGet('/v1/openrouter/settings'), loadConnection);`,
            `.then(function(r) { if (r.status === 410) return fetch(url + '/v1/ai/available'); })`,
        ];
        for (const shape of handles) expect(handlesLegacyGone(shape), shape).toBe(true);
        const plain = [
            `const r = await apiGet('/v1/openrouter/settings');`,
            `// legacyOr(...) would switch on a 410\nconst r = await apiGet('/v1/openrouter/settings');`,
            ` * r.status === 410 is what node 4.0.0 answers`,
            `if (err?.status === 4100) retry();`,
        ];
        for (const shape of plain) expect(handlesLegacyGone(shape), shape).toBe(false);
    });

    it(`every file ALLOWED as "${LEGACY_FIRST}" handles the 410, so a plain legacy call cannot come in under that reason`, () => {
        const unhandled = Object.entries(ALLOWED)
            .filter(([rel, reason]) => reason === LEGACY_FIRST && !handlesLegacyGone(readFileSync(join(REPO, rel), 'utf8')))
            .map(([rel]) => rel);
        expect(unhandled, 'These files call a removed route without the 410 switch: call it through legacyOr() '
            + 'from public/js/services/ai-connection.js, so node 4.0.0 takes the provider path.').toEqual([]);
    });
});
