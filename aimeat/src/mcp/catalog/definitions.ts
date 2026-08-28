/**
 * @file definitions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared metadata catalog for AIMEAT tools. The catalog is transport-neutral:
 *   public MCP, local connector MCP, and shell CLI fallback can read the same names,
 *   descriptions, input metadata, and visibility flags while keeping their execution
 *   adapters separate.
 * @structure
 *   - AimeatToolDefinition -- transport-neutral tool contract metadata
 *   - CLI_FALLBACK_TOOL_DEFINITIONS -- first catalog slice used by `aimeat connect call`
 *   - getAimeatToolDefinition() -- lookup helper by tool name
 * @usage
 *   import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../mcp/catalog/definitions.js';
 * @version-history
 *   v1.x -- 2026-08-28 -- definitions/crew.ts: the five aimeat_crew_* tools (read, validate, try,
 *     draft, publish a JSON crew definition on one of the caller's agents).
 *   v1.x -- 2026-07-13 -- aimeat_cortex_install description states the CREATE-ONLY contract:
 *     re-installing an existing name fails (PROCESSING_FAILED on the ZIP path); updates go through
 *     PUT /v1/cortex/{name} (idempotent redeploy) or delete + reinstall. Found in TARGET-032.
 *   v1.x -- 2026-07-02 -- aimeat_workspace_write / aimeat_memory_write / aimeat_organism_update
 *     descriptions teach the aimeat-memory LIVE data fence (embed a memory key in document markdown;
 *     current value renders fresh on every open) alongside the existing mermaid guidance.
 *   v1.0.0 -- 2026-05-28 -- Add initial shared catalog for connector CLI fallback
 *   v1.1.0 -- 2026-05-28 -- Add app, extension, and cortex lifecycle tools to CLI fallback catalog
 *   v1.2.0 -- 2026-05-28 -- Add core memory, work, wallet, board, storage, and admin CLI fallback tools
 *   v1.3.0 -- 2026-05-28 -- Allow unknown payload field metadata
 *   v1.4.0 -- 2026-05-28 -- Add remaining shared public/connector MCP tools except server-only admin mint
 *   v1.5.0 -- 2026-05-28 -- Add memory tags and owner-scope listing metadata
 *   v1.6.0 -- 2026-05-30 -- MCP audit Phase 1: add supportsResponseFormat + conciseFields metadata,
 *     add aimeat_admin_mint entry (catalog now complete vs all registered tools). Catalog is the
 *     canonical source of tool descriptions read by both MCP surfaces via shape.ts:descriptionFor().
 *   v1.7.0 -- 2026-05-30 -- MCP audit Phase 1 (F6): enrich terse tool descriptions to "new teammate" level.
 *   v1.8.0 -- 2026-05-30 -- F10 drift reconciliation: align catalog input metadata with reconciled
 *     server/connector schemas (organism, knowledge, groups, catalogue, apps, capabilities, boards,
 *     flags, memory, tasks, work, message, handbook, extensions, cortex, storage, instances).
 *   v1.9.0 -- 2026-07-11 -- aimeat_storage_upload description: embed images via the response embed_url /
 *     embed_markdown (owner-addressed /v1/pub), never a hand-written /v1/storage path.
 */

export type { ToolCallerType, ToolVisibility, ToolInputField, AimeatToolDefinition } from './definitions/types.js';

import type { AimeatToolDefinition } from './definitions/types.js';
import { agentMessagingTools } from './definitions/agent-messaging.js';
import { crewTools } from './definitions/crew.js';
import { companyTools } from './definitions/companies.js';
import { schedulesTasksMemoryTools } from './definitions/schedules-tasks-memory.js';
import { discoveryWorkBoardsTools } from './definitions/discovery-work-boards.js';
import { capabilitiesGroupsSkillsTools } from './definitions/capabilities-groups-skills.js';
import { organismsWorkspacesAppsTools } from './definitions/organisms-workspaces-apps.js';
import { extensionsCortexTools } from './definitions/extensions-cortex.js';
import { packagesTools } from './definitions/packages.js';
import { commerceTools } from './definitions/commerce.js';
import { exchangeTools } from './definitions/exchange.js';
import { complianceTools } from './definitions/compliance.js';
import { dataMapTools } from './definitions/data-map.js';
import { surfaceLayoutTools } from './definitions/surface-layout.js';
import { appUiTools } from './definitions/app-ui.js';
import { designbookTools } from './definitions/designbook.js';
import { connectionTools } from './definitions/connections.js';

export const CLI_FALLBACK_TOOL_DEFINITIONS: AimeatToolDefinition[] = [
    ...agentMessagingTools,
    ...crewTools,
    ...schedulesTasksMemoryTools,
    ...discoveryWorkBoardsTools,
    ...capabilitiesGroupsSkillsTools,
    ...organismsWorkspacesAppsTools,
    // Extensions, the per-app IAM door and the cortex packs. They used to sit inside the slice
    // above and moved out when that file passed the line ceiling. One entry changes relative
    // position as a result — the operator-only aimeat_admin_mint, which used to come after them and
    // now comes before. The catalog is read as a set by every consumer that matters (the parity
    // audits compare names, the surfaces filter by visibility), so the order is a listing detail.
    ...extensionsCortexTools,
    ...packagesTools,
    ...commerceTools,
    ...companyTools,
    ...exchangeTools,
    ...complianceTools,
    ...dataMapTools,
    ...surfaceLayoutTools,
    ...appUiTools,
    ...designbookTools,
    ...connectionTools,
];

const definitionByName = new Map(CLI_FALLBACK_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

export function getAimeatToolDefinition(name: string): AimeatToolDefinition | undefined {
    return definitionByName.get(name);
}
