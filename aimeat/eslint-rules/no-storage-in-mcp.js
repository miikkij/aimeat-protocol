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
 *   `pnpm check:shared-impl` reports the same number, and the two are meant to fall together.
 * @structure
 *   - EXEMPT — the 44 that predate the rule
 *   - noStorageInMcp: the rule module
 * @usage
 *   'aimeat/no-storage-in-mcp': 'error'
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: enforcing the architecture the drift ignored).
 */

/**
 * Files that talked to storage before this rule existed. Delete a line when its tools move onto a
 * shared service; never add one.
 *
 * Three of these are not tool surfaces and stay: oauth.ts is the OAuth server, index.ts is the
 * session and transport layer, and prompts-managed.ts serves stored prompt text. They implement the
 * protocol rather than a capability.
 *
 * A file that is a PURE EXTRACTION out of one already on this list inherits its line rather than
 * counting as a new offender — the code did not change and the backlog did not grow. Say which file
 * it came out of, so the pair can be cleared together.
 */
const EXEMPT = new Set([
  'src/mcp/agent-capabilities.ts',
  'src/mcp/agent-management.ts',
  'src/mcp/agent-messages.ts',
  'src/mcp/agent-onboarding.ts',
  'src/mcp/agent-schedules.ts',
  'src/mcp/agent-tasks.ts',
  'src/mcp/agent-telemetry.ts',
  'src/mcp/app-template-proposals.ts',
  'src/mcp/appdev-pitfalls.ts',
  'src/mcp/appdev-proofs.ts',
  'src/mcp/apps.ts',
  'src/mcp/apps-fork.ts',              // pure extraction out of apps.ts (max-file-lines), same backlog
  'src/mcp/boards.ts',
  'src/mcp/capabilities.ts',
  'src/mcp/catalogue.ts',
  'src/mcp/chat-instances.ts',
  'src/mcp/commerce.ts',
  'src/mcp/companies.ts',
  'src/mcp/consent.ts',
  'src/mcp/core-admin.ts',
  'src/mcp/core-storage.ts',
  'src/mcp/core.ts',
  'src/mcp/cortex.ts',
  'src/mcp/dm-messages.ts',
  'src/mcp/exchange-run.ts',
  'src/mcp/exchange.ts',
  'src/mcp/extensions.ts',
  'src/mcp/feedback.ts',
  'src/mcp/flags.ts',
  'src/mcp/index.ts',
  'src/mcp/knowledge.ts',
  'src/mcp/memory-extended.ts',
  'src/mcp/oauth.ts',
  'src/mcp/operator-config.ts',
  'src/mcp/organisms-email-invites.ts',
  'src/mcp/organisms-name-invites.ts',
  'src/mcp/organisms.ts',
  'src/mcp/portfolio.ts',
  'src/mcp/prompts-managed.ts',
  'src/mcp/prompts.ts',
  'src/mcp/sharing-groups.ts',
  'src/mcp/skills.ts',
  'src/mcp/wallet-extended.ts',
  'src/mcp/workspace-members.ts',
  'src/mcp/workspace-create.ts',        // pure extraction out of workspaces.ts (max-file-lines), same backlog
  'src/mcp/workspaces.ts',
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
        const isStorage = obj?.type === 'Identifier' && obj.name === 'storage';
        if (!isStorage) return;
        context.report({ node, messageId: 'direct' });
      },
    };
  },
};
