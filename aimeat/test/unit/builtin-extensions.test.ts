/**
 * Every extension the node SHIPS goes through the same builder an uploaded one does, so a mistake
 * in a manifest written here is a refusal at boot rather than a record nothing validated. That is
 * the seeder's own claim (services/builtin-extension-seeder.ts) and it is worth asserting, because
 * these manifests are TypeScript template strings: a comma inside a flow mapping, a stray backtick
 * or a mis-indented block turns into valid YAML that means something else, with no error anywhere.
 *
 * The check is cheap and it runs on the list rather than on a name, so an extension added to
 * BUILTIN_EXTENSIONS later is covered without anyone remembering to come back here.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_EXTENSIONS } from '../../src/data/builtin-extensions/index.js';
import { buildExtensionRecordFromManifest } from '../../src/routes/extensions/manifest.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
    extensionMaxCodeSizeKb: 512,
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 30_000,
    extensionMaxApiCalls: 30,
} as unknown as AimeatConfig;

describe('the extensions this node ships', () => {
    it('ships at least the two we know about', () => {
        const names = BUILTIN_EXTENSIONS.map((e) => e.name);
        expect(names).toContain('living-hooks');
        expect(names).toContain('vocab-finto');
    });

    for (const ext of BUILTIN_EXTENSIONS) {
        describe(ext.name, () => {
            const built = buildExtensionRecordFromManifest(
                ext.manifest, ext.scripts, config, 'operator', new Date().toISOString(), true,
            );

            it('builds through the same door an uploaded manifest uses', () => {
                // The failure shape carries the reason; surface it rather than a bare `false`.
                expect(built.ok ? 'ok' : `${built.code}: ${built.message}`).toBe('ok');
            });

            it('declares the version the seeder compares against', () => {
                expect(built.ok && built.record.version).toBe(ext.version);
                expect(built.ok && built.record.name).toBe(ext.name);
            });

            it('carries a body for every action, so none of them installs empty', () => {
                if (!built.ok) return;
                const actions = built.record.actions ?? [];
                expect(actions.length).toBeGreaterThan(0);
                for (const a of actions) {
                    // The builder resolves each action's `script:` filename to its bytes. An action
                    // naming a file that was not shipped arrives here as an empty body rather than
                    // as an error, and then fails at the first call instead of at install.
                    expect(a.scriptContent, `${a.id} has no script body`).toBeTruthy();
                    expect(a.scriptContent.length, `${a.id} body is suspiciously short`).toBeGreaterThan(40);
                }
            });

            it('ships no script that no action names', () => {
                if (!built.ok) return;
                // Dead weight shipped into every install of this node, and a hint that an action was
                // renamed while its file was left behind.
                const bodies = (built.record.actions ?? []).map((a) => a.scriptContent).join('\n');
                for (const [file, source] of Object.entries(ext.scripts)) {
                    const tail = source.trim().slice(-60);
                    expect(bodies.includes(tail), `${file} is shipped but no action uses it`).toBe(true);
                }
            });
        });
    }
});

describe('vocab-finto', () => {
    const ext = BUILTIN_EXTENSIONS.find((e) => e.name === 'vocab-finto')!;
    const all = Object.values(ext.scripts).join('\n');

    it('has the three actions the vocabulary flow needs', () => {
        const built = buildExtensionRecordFromManifest(
            ext.manifest, ext.scripts, config, 'operator', new Date().toISOString(), true,
        );
        expect(built.ok).toBe(true);
        const ids = built.ok ? (built.record.actions ?? []).map((a) => a.id) : [];
        expect(ids.sort()).toEqual(['concept', 'scheme', 'search']);
    });

    it('builds every URL from one fixed host and takes none from the caller', () => {
        // The whole security posture of this extension in one assertion: there is no allowlist to
        // configure because a caller supplies a query and a concept URI, never an address.
        expect(all).toContain("var FINTO = 'https://api.finto.fi/rest/v1'");
        // ctx.fetch is only ever handed FINTO + a path built here.
        for (const m of all.matchAll(/ctx\.fetch\(([^,)]+)/g)) {
            expect(m[1].trim()).toBe('FINTO + path');
        }
    });

    it('bounds its cache instead of writing a key per lookup', () => {
        // An ext namespace has the same budget as any principal, and a key per lookup crosses the
        // 1000-key ceiling in a week. Two keys, each trimmed on write.
        expect(all).toContain('MAX_CONCEPTS = 400');
        expect(all).toContain('MAX_SEARCHES = 200');
        expect(all).toContain('fintoTrim');
        // Everything it stores is under the single key `cache`.
        const keys = [...all.matchAll(/ctx\.memory\.(?:get|set)\('([^']+)'/g)].map((m) => m[1]);
        expect([...new Set(keys)]).toEqual(['cache']);
    });

    it('keeps what people looked up private, although the vocabulary is public', () => {
        expect(all).toContain("visibility: 'private'");
    });

    it('carries the CC BY attribution the licence requires into what it hands back', () => {
        expect(all).toContain('dcterms:rights');
        expect(all).toContain('CC BY 4.0');
        expect(all).toContain('skos:exactMatch');
    });
});
