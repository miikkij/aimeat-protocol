/**
 * @file test/unit/scope-vocabulary-mirror.test.ts
 * @description The server's copy of the scope vocabulary (src/utils/scope-vocabulary.ts) holds the
 *   same words as the agent page's scope model (SCOPE_DOMAINS in
 *   public/views/profile/agents/scope-model.js), the list check:scope-parity reads. A word added to one
 *   and not the other fails here.
 * @usage pnpm exec vitest run test/unit/scope-vocabulary-mirror.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SCOPE_DOMAINS } from '../../public/views/profile/agents/scope-model.js';
import { SCOPE_VOCABULARY } from '../../src/utils/scope-vocabulary.js';

describe('the server\'s scope vocabulary mirrors the agent page\'s', () => {
    it('holds exactly the same words', () => {
        const page = SCOPE_DOMAINS.flatMap((d: { key: string; permissions: string[] }) => d.permissions.map((p) => `${d.key}:${p}`)).sort();
        expect([...SCOPE_VOCABULARY].sort()).toEqual(page);
    });
});
