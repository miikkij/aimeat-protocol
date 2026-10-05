/**
 * @file invoke-catalogue-is-gated.test.ts
 * @description `/v1/invoke` is `requireAuth()` and no scope, on purpose: it dispatches over loopback
 *   to the target capability's own route and that route's gate is the one that decides. The model is
 *   right, and it makes the CATALOGUE a security surface — one door, one name, and everything
 *   invokable behind it.
 *
 *   SO THE PROPERTY WORTH PINNING IS ABOUT THE CATALOGUE, not about one call. Every mutating
 *   capability `invoke` can name either carries a scope word or is a named exemption with a written
 *   reason. A capability in neither would be a mutation reachable by any authenticated principal
 *   through a door whose whole defence is "the route decides" — and nobody would have decided.
 *
 *   `check:mcp-tools` already refuses `mutatingWithoutScope`, so this test is the same line drawn a
 *   second time, from the other side: that gate reads the tool tables, this reads what `invoke`
 *   actually offers. They agree today, and if the two ever diverge — a capability dispatchable but
 *   absent from the tables, or the reverse — this is the one that says so.
 *
 * @version-history
 *   2026-10-04 — The exemption bound is 20, for aimeat_task_decline (an agent declines its own task).
 *   2026-10-02 — The exemption bound is 19, for aimeat_agent_runtime_report (its own report needs no word).
 *   2026-10-02 — The exemption bound is 18, for aimeat_agent_tags_set (own tags need no word).
 *   2026-09-27 — The exemption bound is 17, for aimeat_app_manage.
 *   v1.2.0 — 2026-09-24 — The bound falls to 16: the operator's writes left the exemptions for the
 *     operator:admin word (security audit A8-1).
 *   v1.1.0 — 2026-09-08 — The exemption bound grows to 26 for aimeat_admin_cors_set.
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, post-audit item 2).
 */
import { describe, it, expect } from 'vitest';
import { listNodeCapabilities, NON_INVOKABLE } from '../../src/services/node-capabilities.js';
import { TOOL_SCOPES, SCOPE_EXEMPT_TOOLS } from '../../src/tool-catalog/scopes.js';
import { TOOL_ANNOTATIONS } from '../../src/mcp/annotations.js';

/** A capability that changes something. The annotation is the node's own answer to that question. */
function isMutating(id: string): boolean {
    return TOOL_ANNOTATIONS[id]?.readOnlyHint !== true;
}

describe('the invoke catalogue is a gated surface', () => {
    it('every mutating capability invoke can name is scoped or is a named exemption', () => {
        const unaccounted = listNodeCapabilities()
            .map(c => c.id)
            .filter(isMutating)
            .filter(id => !(TOOL_SCOPES as Record<string, string>)[id] && !SCOPE_EXEMPT_TOOLS.has(id));

        // Named rather than counted: a failure here has to say WHICH capability nobody decided about.
        expect(unaccounted).toEqual([]);
    });

    it('every capability it names has an annotation, so "is this a mutation" is never a guess', () => {
        const unannotated = listNodeCapabilities().map(c => c.id).filter(id => !TOOL_ANNOTATIONS[id]);
        // Without this, the test above would quietly stop testing anything: an unannotated tool reads
        // as mutating, so it would be caught — but an annotation added later as readOnly by mistake
        // would remove a real capability from the check with nothing to notice it.
        expect(unannotated).toEqual([]);
    });

    it('invoke cannot name itself', () => {
        // A door that can be pointed at itself is a loop with a caller's credential in it.
        const ids = new Set(listNodeCapabilities().map(c => c.id));
        for (const forbidden of NON_INVOKABLE) expect(ids.has(forbidden)).toBe(false);
    });

    it('the exemptions it relies on are a bounded, written set rather than a default', () => {
        const mutating = listNodeCapabilities().map(c => c.id).filter(isMutating);
        const exempt = mutating.filter(id => !(TOOL_SCOPES as Record<string, string>)[id] && SCOPE_EXEMPT_TOOLS.has(id));
        // This number is the honest shape of the surface: `invoke` reaches these with no scope word,
        // exactly as a direct call does, and each one has a reason recorded beside it. It is written
        // down here so that growing it is a visible act rather than a silent one.
        // 26 since 2026-09-08: aimeat_admin_cors_set, gated in its handler on the operator role like
        // the other admin writes (scopes.ts says why no scope word narrows an operator).
        // 27 since 2026-09-12: aimeat_admin_hook_set, the same decision. It binds a lifecycle moment
        // to an address, which only whoever runs the node may do, and the handler resolves the
        // operator before it writes; there is no narrower word to name it with.
        // 28 since 2026-09-16: aimeat_mcp_registry_set, and the same reasoning a third time. It
        // decides which owners on this node may use one of its own MCP servers and what a call
        // costs them, the handler resolves the operator from the OWNER record before it writes, and
        // a scope word cannot say "the operator in person" — one that could would be grantable to
        // an agent, which is exactly what must not happen to a control over the whole node.
        // 16 since 2026-09-24, and the reasoning of the three entries above was wrong: the role the
        // handlers asked was the ACCOUNT's, so every agent the operator connected held all of it.
        // The operator's writes ride operator:admin now, a word no wildcard carries and the operator
        // ticks per agent (security audit A8-1).
        // 17 since 2026-09-27: aimeat_app_manage. Its actions need different words, some none, so the
        // tool carries none and each action is checked: on the node by its handler
        // (catalog/action-scopes.ts), and through invoke by the REST endpoint the action calls.
        // 18 since 2026-10-02: aimeat_agent_tags_set. An agent's own tags need no word and a
        // sibling's need agent:write; the handler checks which on the node, and through invoke the
        // REST endpoint does (auth/self-or-scope.ts). Ruled by Jouni after a crew runtime's tags call
        // on every start failed every task of the basic agents.
        // 19 since 2026-10-02: aimeat_agent_runtime_report, the same rule for the same reason. The
        // report now says where the crew's model calls go (`llm`), a crew sends it about itself, and
        // the basic agents hold no agent:write; a sibling's report still needs the word, checked by
        // the handler on the node and by the REST endpoint through invoke.
        // 20 since 2026-10-04: aimeat_task_decline, beside aimeat_task_fail and for its reason: an agent
        // ends its OWN task (isOwnTask on the node, canAccessTask on POST …/decline through invoke), and
        // a refusal is not a permission an agent should be able to lack.
        expect(exempt.length).toBeLessThanOrEqual(20);
        expect(mutating.length).toBeGreaterThan(100);
    });
});
