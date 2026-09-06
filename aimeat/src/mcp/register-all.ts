/**
 * @file src/mcp/register-all.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every tool group the node's MCP server registers, in one call.
 *
 *   WHY IT IS ITS OWN FILE. This list lived inline in index.ts, and the schema audit
 *   (scripts/audit-mcp-schemas.ts) kept a SECOND copy of it by hand so it could register against a
 *   fake server and read the input shapes back. The two drifted, the way two copies of a list
 *   always do: by 2026-09-03 index.ts called 52 groups and the audit loaded 26. The audit did not
 *   go quiet about it — it printed twenty-seven families as "not server-registered" and ended with
 *   "v2 surfaces HAVE ISSUES" while exiting green, because those were tracked as known. That is the
 *   worse failure: the instrument had a blind spot AND a plausible reason for the noise it made, so
 *   a real parameter drift in any of those families would have printed as one more line in a list
 *   nobody could read.
 *
 *   One list, called by both. The audit cannot fall behind the server any more, because there is
 *   nothing for it to fall behind.
 *
 *   The deps object rather than ten positional arguments: the emitters are passed IN rather than
 *   imported, which keeps this file free of a cycle back to index.ts and lets the audit hand in
 *   no-ops.
 * @structure ServerToolDeps · registerAllServerTools(mcp, deps)
 * @usage
 *   registerAllServerTools(mcp, { storage, config, agentGaii: () => gaii, ... });
 * @version-history
 *   v1.1.0 — 2026-09-06 — registerSecretTools: the owner's secrets vault on the chat path.
 *   v1.0.0 — 2026-09-03 — Extracted from index.ts so the schema audit registers what the server
 *     registers instead of a hand-kept copy that had drifted to half.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { registerCoreTools } from './core.js';
import { registerComplianceTools } from './compliance.js';
import { registerDataMapTools } from './data-map.js';
import { registerBoardsTools } from './boards.js';
import { registerOrganismsTools } from './organisms.js';
import { registerWorkspaceTools } from './workspaces.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerAppdevPitfallTools } from './appdev-pitfalls.js';
import { registerAppdevResearchTools } from './appdev-research.js';
import { registerAppTemplateProposalTools } from './app-template-proposals.js';
import { registerAppdevProofTools } from './appdev-proofs.js';
import { registerSkillsTools } from './skills.js';
import { registerOperatorConfigTools } from './operator-config.js';
import { registerExtensionsTools } from './extensions.js';
import { registerCatalogueTools } from './catalogue.js';
import { registerMemoryExtendedTools } from './memory-extended.js';
import { registerWalletExtendedTools } from './wallet-extended.js';
import { registerConsentTools } from './consent.js';
import { registerCommerceTools } from './commerce.js';
import { registerExchangeTools } from './exchange.js';
import { registerExchangeRunTools } from './exchange-run.js';
import { registerChatInstancesTools } from './chat-instances.js';
import { registerFlagsTools } from './flags.js';
import { registerPromptsTools } from './prompts.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerCortexTools } from './cortex.js';
import { registerSeoTools } from './seo.js';
import { registerAppMarksTools } from './app-marks.js';
import { registerAppLegalTools } from './app-legal.js';
import { registerAppsTools } from './apps.js';
import { registerAppDraftEditTools } from './apps-draft-edit.js';
import { registerAppScreenshotTool } from './apps-screenshot.js';
import { registerAiImageTool } from './ai-image.js';
import { registerSharingGroupTools } from './sharing-groups.js';
import { registerAgentTaskTools } from './agent-tasks.js';
import { registerAgentScheduleTools } from './agent-schedules.js';
import { registerWorkflowTools } from './workflows.js';
import { registerAiJobTools } from './ai-jobs.js';
import { registerAgentCapabilityTools } from './agent-capabilities.js';
import { registerAgentMessageTools } from './agent-messages.js';
import { registerAgentV2MessagingTools } from './agent-v2-messaging.js';
import { registerAgentV2TaskTools } from './agent-v2-tasks.js';
import { registerDmMessageTools } from './dm-messages.js';
import { registerNotifyTools } from './notify.js';
import { registerContactTools } from './contacts.js';
import { registerCompanyTools } from './companies.js';
import { registerPackageTools } from './packages.js';
import { registerPortfolioTools } from './portfolio.js';
import { registerSurfaceLayoutTools } from './surface-layout.js';
import { registerAppUiTools } from './app-ui.js';
import { registerDesignbookTools } from './designbook.js';
import { registerAgentOnboardingTools } from './agent-onboarding.js';
import { registerAgentTelemetryTools } from './agent-telemetry.js';
import { registerAgentManagementTools } from './agent-management.js';
import { registerInvokeTool } from './invoke.js';
import { registerAgentCrewTools } from './agent-crew.js';
import { registerConnectionTools } from './connections.js';
import { registerAccessTools } from './access.js';
import { registerSecretTools } from './secrets.js';

/** What every tool group needs. The two emitters are passed in so this file has no cycle home. */
export interface ServerToolDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The connected agent, read late: a session resolves it after the handshake. */
    agentGaii: () => string;
    /** The owner behind that agent, '' when the road does not know one. */
    owner: () => string;
    /** The scopes this session was granted — the gate that decides which of these actually land. */
    scopes: string[];
    peers: Map<string, PeerInfo>;
    /** The session's live bearer, for the tools that re-present it to the node's own routes. */
    getToken: () => string | undefined;
    emitResourceUpdated: (agentGaii: string, uri: string) => void;
    emitResourceListChanged: (agentGaii: string) => void;
}

/**
 * Register every tool group on `mcp`.
 *
 * The caller decides what is actually offered: index.ts patches `mcp.tool`/`mcp.registerTool` with
 * the scope-and-surface gate BEFORE calling this, so a group registering a tool the agent may not
 * have is filtered at the door rather than here. That is why the order below carries no meaning
 * beyond readability, and why a new group is one line.
 */
export function registerAllServerTools(mcp: McpServer, deps: ServerToolDeps): void {
    const { storage, config, agentGaii, owner, scopes, peers, getToken } = deps;
    const { emitResourceUpdated, emitResourceListChanged } = deps;

    registerCoreTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes, peers);
    registerBoardsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerOrganismsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerWorkspaceTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerConnectionTools(mcp, storage, config, agentGaii, scopes);
    registerKnowledgeTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerAppdevPitfallTools(mcp, storage, config, agentGaii, emitResourceUpdated, scopes);
    registerAppdevResearchTools(mcp, storage, config, agentGaii);
    registerAppTemplateProposalTools(mcp, storage, config, agentGaii);
    registerAppdevProofTools(mcp, storage, config, agentGaii, scopes);
    registerSkillsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerOperatorConfigTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerComplianceTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerDataMapTools(mcp, storage, config, agentGaii, () => scopes);
    registerExtensionsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerCatalogueTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerMemoryExtendedTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerWalletExtendedTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerConsentTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerAccessTools(mcp, storage, config, agentGaii);
    registerSecretTools(mcp, storage, config, agentGaii);
    registerCommerceTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerExchangeTools(mcp, storage, config, agentGaii);
    registerExchangeRunTools(mcp, storage, config, agentGaii, getToken);
    registerChatInstancesTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerFlagsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerPromptsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerCapabilitiesTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, getToken);
    // The second primitive, beside aimeat_discover: run what you found. Needs the session's
    // raw bearer, because the call is dispatched as the caller through the node's own routes.
    registerInvokeTool(mcp, config, getToken, agentGaii);
    registerCortexTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAppsTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAppDraftEditTools(mcp, storage, config, agentGaii);
    registerAppScreenshotTool(mcp, storage, config, agentGaii);
    registerSeoTools(mcp, storage, config, agentGaii);
    registerAppMarksTools(mcp, storage, config, agentGaii);
    registerAppLegalTools(mcp, storage, config, agentGaii);
    registerAiImageTool(mcp, storage, config, agentGaii);
    registerSharingGroupTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerAgentTaskTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAgentScheduleTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
    registerWorkflowTools(mcp, storage, config, agentGaii);
    registerAiJobTools(mcp, storage, config, agentGaii);
    registerAgentCapabilityTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAgentMessageTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    // The v2 turn, beside the dashboard thread above it and the federated DM below. A session
    // here authenticates against an agent record, so the ops see roles: ['agent'].
    registerAgentV2MessagingTools(mcp, storage, config, agentGaii, owner);
    // The v2 task handle, beside the dashboard work item registered above. Both stay.
    registerAgentV2TaskTools(mcp, storage, config, agentGaii, owner);
    registerDmMessageTools(mcp, storage, config, agentGaii, peers);
    registerNotifyTools(mcp, storage, config, agentGaii);
    registerContactTools(mcp, storage, config, agentGaii);
    registerCompanyTools(mcp, storage, config, agentGaii);
    // peers: pulling a package from another node reads that node's address and key from the peer
    // record, never from the caller's arguments.
    registerPackageTools(mcp, storage, config, agentGaii, peers);
    registerPortfolioTools(mcp, storage, config, agentGaii);
    registerSurfaceLayoutTools(mcp, storage, config, agentGaii);
    registerAppUiTools(mcp, storage, config, agentGaii);
    registerDesignbookTools(mcp, storage, config, agentGaii);
    registerAgentTelemetryTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAgentOnboardingTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAgentManagementTools(mcp, storage, config, agentGaii, emitResourceUpdated, emitResourceListChanged);
    registerAgentCrewTools(mcp, storage, config, agentGaii, scopes);
}
