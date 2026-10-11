/**
 * @file test/unit/doc-rules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two documentation rules check:docs gained in docs audit phase 5b
 *   (scripts/lib/doc-rules.mjs). A repository path quoted in backticks is checked like a link: the
 *   audit of 2026-10-11 found five dead ones (deleted plans, gitignored internal notes) that the
 *   link check never read. A catalog row that says "checked YYYY-MM-DD" and names a source file
 *   is reported stale when that file changed after the date, so a guide whose code moved is seen.
 * @usage pnpm exec vitest run test/unit/doc-rules.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (docs audit phase 5b, "Pysyvät suojat").
 */
import { describe, expect, it } from 'vitest';
import { backtickPathProblems, catalogRows, staleCatalogRows, inlineCodeSpans } from '../../scripts/lib/doc-rules.mjs';

const tracked = new Set([
    'docs/catalog.md',
    'docs/pitfalls.md',
    'aimeat/src/config.ts',
    'aimeat/scripts/clean-dist.mjs',
    'aimeat/public/sw.js',
    'openapi.yaml',
]);
const ctx = (extra: Partial<Parameters<typeof backtickPathProblems>[0]> = {}) => ({
    path: 'docs/example.md',
    tracked,
    ignored: (p: string) => p === 'aimeat/.env' || p === 'aimeat/src/generated/' || p.startsWith('docs/internal/'),
    ...extra,
});
const refs = (content: string, extra = {}) => backtickPathProblems({ ...ctx(extra), content }).map(p => p.ref);

describe('inline code spans', () => {
    it('reads single-backtick spans outside fenced blocks, with their line', () => {
        const spans = inlineCodeSpans('one `a/b.ts` two\n```\n`c/d.ts`\n```\nthree `e/f.ts`');
        expect(spans.map(s => [s.text, s.line])).toEqual([['a/b.ts', 1], ['e/f.ts', 5]]);
    });
});

describe('a backtick repository path must exist', () => {
    it('refuses a deleted plan, the case the link check missed', () => {
        expect(refs('Companion: `docs/plans/2026-06-12-agent-offers-surface.md`.'))
            .toEqual(['docs/plans/2026-06-12-agent-offers-surface.md']);
    });
    it('refuses a private note a public reader cannot open, tracked or not', () => {
        expect(refs('Design: `docs/internal/2026-06-23-organism-measurability-design.md`'))
            .toEqual(['docs/internal/2026-06-23-organism-measurability-design.md']);
        expect(refs('See `internal/ecosystem-spec-profile-ui.md`'))
            .toEqual(['internal/ecosystem-spec-profile-ui.md']);
    });
    it('refuses a missing source file and names the line', () => {
        const problems = backtickPathProblems({ ...ctx(), content: 'x\nsee `aimeat/src/routes/marketplace.ts`' });
        expect(problems).toEqual([{ ref: 'aimeat/src/routes/marketplace.ts', line: 2, reason: expect.stringMatching(/not in the repository/) }]);
    });
    it('accepts a tracked file, a tracked directory and a line-number suffix', () => {
        expect(refs('`aimeat/src/config.ts` `aimeat/src/config.ts:553` `aimeat/src/` `openapi.yaml` `docs/catalog.md#L3`')).toEqual([]);
    });
    it('reads a package-relative path against aimeat/', () => {
        expect(refs('`scripts/clean-dist.mjs` and `src/config.ts` and `public/sw.js`')).toEqual([]);
        expect(refs('`src/routes/gone.ts`')).toEqual(['src/routes/gone.ts']);
    });
    it('accepts a local file or folder a reader makes, which git ignores', () => {
        expect(refs('copy it to `aimeat/.env`; `src/generated/` is written by a script')).toEqual([]);
    });
    it('accepts a statement about a folder itself, and still checks a file inside it', () => {
        expect(refs('`docs/internal/` is local; `docs/archive/` and `docs/plans/` were removed')).toEqual([]);
        expect(refs('`docs/plans/gone.md`')).toEqual(['docs/plans/gone.md']);
    });
    it('leaves a path written as an example to copy alone', () => {
        expect(refs('create `src/services/my-thing.ts` and `test/e2e-my-feature.ts`')).toEqual([]);
    });
    it('leaves placeholders, globs, routes, URLs and names that are not paths alone', () => {
        expect(refs([
            '`aimeat/src/data/builtin-skills.*`', '`docs/<name>.md`', '`src/{a,b}.ts`', '`aimeat/no-silent-catch`',
            '`/v1/memory`', '`https://aimeat.io/docs/x.md`', '`memory:read`', '`config.ts`', '`scripts/actions/activate.js`',
            '`docs/archive/`', '`a/b c.ts`',
        ].join(' '))).toEqual([]);
    });
    it('reads nothing inside a fenced block', () => {
        expect(refs('```\n`docs/plans/x.md`\n```')).toEqual([]);
    });
});

describe('a catalog row checked before its source changed is stale', () => {
    const catalog = [
        '| File | Status | Purpose and validity | Check against |',
        '|---|---|---|---|',
        '| [docs/a.md](a.md) | maintained | Guide; checked 2026-10-01 | `aimeat/src/a.ts` |',
        '| [docs/b.md](b.md) | maintained | Guide; checked 2026-10-12 | `aimeat/src/b.ts` |',
        '| [docs/c.md](c.md) | maintained | Guide with no date | `aimeat/src/c.ts` |',
        '| [docs/d.md](d.md) | maintained | Guide; checked 2026-10-01 | `aimeat/src` |',
    ].join('\n');
    const lastChange: Record<string, string> = { 'aimeat/src/a.ts': '2026-10-05', 'aimeat/src/b.ts': '2026-10-05', 'aimeat/src/c.ts': '2026-10-05' };
    const isFile = (p: string) => p in lastChange;

    it('reads the date and the source of each row', () => {
        expect(catalogRows(catalog).map(r => [r.path, r.checked, r.source]))
            .toEqual([['docs/a.md', '2026-10-01', 'aimeat/src/a.ts'], ['docs/b.md', '2026-10-12', 'aimeat/src/b.ts'],
                ['docs/c.md', null, 'aimeat/src/c.ts'], ['docs/d.md', '2026-10-01', 'aimeat/src']]);
    });
    it('reports the row whose source file changed after the date, and only that one', () => {
        const stale = staleCatalogRows(catalogRows(catalog), { isFile, lastChange: (p: string) => lastChange[p] ?? null });
        expect(stale).toEqual([{ path: 'docs/a.md', checked: '2026-10-01', source: 'aimeat/src/a.ts', changed: '2026-10-05' }]);
    });
});
