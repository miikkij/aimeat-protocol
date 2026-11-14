/**
 * @file no-storage-in-mcp.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule: an MCP tool does not talk to storage itself. Reports any
 *   `storage.<method>(...)` call inside `src/mcp/`.
 *
 *   THE RULE IT ENFORCES (CLAUDE.md, Backend): one capability, one implementation, whatever the
 *   interface. An MCP tool declares its own name, description and parameters, because the protocol
 *   requires that. It does not do the work itself: it calls the same route or the same service
 *   function REST calls, so the scope check, the validation and the provenance happen where they
 *   were written once.
 *
 *   WHAT IGNORING IT COST, measured rather than argued. Reading all 22 MCP files that write against
 *   their REST twins on 2026-08-11 found 82 tools carrying 315 behavioural differences: 125 missing
 *   side effects, 84 missing gates, 40 record-shape differences, 37 missing validations, 18 identity
 *   differences, 11 different defaults. Among them, and each shipped for months:
 *
 *     - any agent with ext:write could uninstall ANOTHER OWNER's extension
 *     - any agent could cron another owner's extension, run as a system caller, unpriced
 *     - aimeat_board_post never loaded the board: no access check, no price, no moderation hook
 *     - a memory write over MCP had no size limit, no key limit and no byte budget
 *     - a knowledge entry skipped every one of those by being written through a different function
 *     - any member's agent could publish over an organism's manifest and its config
 *
 *   None of that is a hard bug to see in one file. All of it is invisible when the same capability
 *   is written twice and a reader has one copy in front of them.
 *
 *   HOW TO SATISFY IT. Put the decision in a service that takes the CALLER — identity, roles,
 *   scopes — and returns a refusal or a result. Both doors call it and each renders the answer its
 *   own way. Worked examples: services/memory-write.ts, services/consent-write.ts,
 *   services/board-post.ts, services/schedule-gate.ts.
 *
 *   THE SEED. 44 files did this on 2026-08-11 and are listed below. The list only shrinks: a new
 *   MCP file that reaches for storage fails the build, and every conversion deletes a line here.
 *   An exempt file is not free inside: `pnpm check:shared-impl` holds each one to a ceiling of
 *   direct-call lines that fails in both directions, and holds this list to its ceilings.
 * @structure
 *   - EXEMPT — the files that predate the rule and still call storage directly
 *   - noStorageInMcp: the rule module
 * @usage
 *   'aimeat/no-storage-in-mcp': 'error'
 * @version-history
 *   v1.3.4 — 2026-11-14 — exchange-run.ts leaves EXEMPT; its manifest read moved to
 *     services/app-tools/manifest-read.ts loadPublicToolManifest, which POST .../webmcp/tools/:tool calls too.
 *   v1.3.3 — 2026-11-14 — Unit 2b part 2, phase B: apps-fork.ts leaves EXEMPT; its source read and the
 *     three fork gates moved to services/app/fork-gate.ts, which POST .../fork calls too.
 *   v1.3.2 — 2026-11-14 — Unit 2b part 2, phase B: consent.ts leaves EXEMPT; its record read and the
 *     owner-or-operator check moved to services/consent/consent-read.ts, which GET /v1/consent/:id calls too.
 *   v1.3.1 — 2026-11-13 — Structure programme unit 2b, batch 3: agent-capabilities.ts, agent-onboarding.ts,
 *     core-boards.ts, organisms-email-invites.ts and organisms-name-invites.ts leave EXEMPT; their reads
 *     moved with the gate around them into service functions the REST routes call too.
 *   v1.3.0 — 2026-11-13 — Structure programme unit 2b: a file leaves EXEMPT when its reads move, with
 *     the gate around them, into a service function the REST route calls too (agent-telemetry.ts,
 *     prompts.ts).
 *   v1.2.1 — 2026-11-13 — src/mcp/sharing-groups.ts leaves EXEMPT: its group reads call
 *     services/sharing-groups/reach.ts, as the REST routes do (structure programme unit 7).
 *   v1.2.0 — 2026-11-13 — Structure programme unit 2: a file leaves EXEMPT when its reads call the
 *     service function its REST route calls.
 *   v1.1.2 — 2026-10-20 — src/mcp/index.ts leaves EXEMPT: its storage reads moved to
 *     services/mcp-agent-admission.ts and services/mcp-build-inputs.ts (MCP SDK v2 migration step 5).
 *   v1.1.1 — 2026-10-20 — src/mcp/core-work.ts inherits core.ts's line (pure extraction).
 *   v1.1.0 — 2026-10-16 — A member receiver (`deps.storage.x()`) counts as a direct call, as the bare
 *     identifier does; appdev-pitfalls.ts left EXEMPT, it calls storage no more; check:shared-impl
 *     now holds each exempt file to a per-file ceiling (QA audit P3-09).
 *   v1.0.1 — 2026-09-29 — core-resources.ts inherits core.ts's line: the resource templates moved out.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: enforcing the architecture the drift ignored).
 */

/**
 * Files that talked to storage before this rule existed. Delete a line when its tools move onto a
 * shared service; never add one.
 *
 * One of these is not a tool surface and stays: oauth.ts is the OAuth server, which implements the
 * protocol rather than a capability. index.ts, the transport layer, was another until its reads moved
 * to services on 2026-10-20, and prompts-managed.ts, which serves stored prompt text, a third until its
 * reads moved to services/prompts/prompt-read.ts on 2026-11-13.
 *
 * A file that is a PURE EXTRACTION out of one already on this list inherits its line rather than
 * counting as a new offender — the code did not change and the backlog did not grow. Say which file
 * it came out of, so the pair can be cleared together.
 */
const EXEMPT = new Set([
  'src/mcp/agent-messages.ts',
  'src/mcp/agent-schedules.ts',
  'src/mcp/agent-tasks.ts',
  'src/mcp/apps.ts',
  'src/mcp/boards.ts',
  'src/mcp/capabilities.ts',
  'src/mcp/chat-instances.ts',
  'src/mcp/commerce.ts',
  'src/mcp/core-admin.ts',
  'src/mcp/core-resources.ts',         // extraction out of core.ts (max-file-lines): the same four storage reads
  'src/mcp/core.ts',
  'src/mcp/extensions.ts',
  'src/mcp/knowledge.ts',
  'src/mcp/memory-extended.ts',
  'src/mcp/oauth.ts',
  'src/mcp/operator-config.ts',
  'src/mcp/skills.ts',
  'src/mcp/wallet-extended.ts',
]);

export const noStorageInMcp = {
  meta: {
    type: 'problem',
    docs: {
      description: 'An MCP tool calls the service or route REST calls, rather than storage directly',
    },
    schema: [],
    messages: {
      direct:
        'An MCP tool must not call storage directly. Put the decision in a service that takes the '
        + 'CALLER (identity, roles, scopes) and returns a refusal or a result, then call it from both '
        + 'doors — services/memory-write.ts, services/consent-write.ts and services/board-post.ts are '
        + 'worked examples. Writing the capability twice is what produced 315 measured differences '
        + 'between this surface and REST, including agents deleting another owner\'s extension and '
        + 'memory writes with no size limit. See docs/internal/secauditaug2026/08-mcp-rest-drift-map.md.',
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    if (!filename.includes('/src/mcp/')) return {};
    const rel = filename.slice(filename.indexOf('src/mcp/'));
    if (EXEMPT.has(rel)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== 'MemberExpression') return;
        const obj = callee.object;
        // The bare `storage`, or a member receiver: `deps.storage.getX()`, `this.storage.getX()`.
        const isStorage = (obj?.type === 'Identifier' && obj.name === 'storage')
          || (obj?.type === 'MemberExpression' && !obj.computed && obj.property?.type === 'Identifier' && obj.property.name === 'storage');
        if (!isStorage) return;
        context.report({ node, messageId: 'direct' });
      },
    };
  },
};
