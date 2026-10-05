/**
 * @file src/tool-catalog/scopes-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator tools' rows of TOOL_SCOPES: the organism break-glass words and
 *   operator:admin. A pure move out of scopes.ts (max-file-lines): TOOL_SCOPES spreads these rows
 *   where they stood, so the table reads the same.
 * @structure OPERATOR_TOOL_SCOPES
 * @version-history
 *   v1.3.0 — 2026-10-02 — aimeat_package_claim: operator:admin (package sale design, phase 3).
 *   v1.2.0 — 2026-10-01 — aimeat_admin_federation_peer_remove: operator:admin.
 *   v1.1.0 — 2026-09-30 — aimeat_admin_node_update: operator:admin.
 *   v1.0.0 — 2026-09-29 — Moved from scopes.ts, unchanged.
 */

export const OPERATOR_TOOL_SCOPES: Record<string, string> = {

    aimeat_admin_mint:                        'operator:admin',
};
