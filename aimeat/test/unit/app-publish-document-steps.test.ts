/**
 * @file test/unit/app-publish-document-steps.test.ts
 * @description The publish answer's next calls for the design spec name the app's owner. Without it
 *   aimeat_app_manage takes the caller's own owner, so a builder working on another owner's app
 *   (a development grant) would read or write a spec of its own app by the same name, or fail
 *   (instruction re-check over MCP, 2026-11-08).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-publish-document-steps.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { documentSteps } from '../../src/services/app-publish-next-steps.js';

describe('documentSteps', () => {
    it('names the owner in the spec_set call when there is no spec yet', () => {
        const s = documentSteps('alice', 'list.html', { dataMapMissing: false, dataMapRowsWithoutWhy: 0, designSpecVersion: undefined, newVersion: 1 });
        expect(s.design_spec).toContain('{ action: "spec_set", owner: "alice", filename: "list.html", markdown }');
    });

    it('names the owner in the spec read when the spec is behind the app', () => {
        const s = documentSteps('alice', 'list.html', { dataMapMissing: false, dataMapRowsWithoutWhy: 0, designSpecVersion: 1, newVersion: 2 });
        expect(s.design_spec).toContain('{ action: "spec", owner: "alice", filename: "list.html" }');
    });
});
