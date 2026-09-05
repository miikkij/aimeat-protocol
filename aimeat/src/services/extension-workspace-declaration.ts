/**
 * @file src/services/extension-workspace-declaration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The manifest's `workspace: { read, write }` declaration as it is stored on an
 *   extension record, and the one reader of it. A LEAF module on purpose: the manifest builder
 *   (routes/extensions/manifest.ts) and the CRUD routes need only this, and importing the full
 *   sandbox binding (extension-workspace.ts → workspace-tool-ops.ts → memory-write → scheduler →
 *   mcp/index → mcp/extensions → manifest.ts) closed an import cycle dependency-cruiser refused.
 * @structure WorkspaceDeclaration · WORKSPACE_DECLARATION_KEY · workspaceDeclarationOf()
 * @usage
 *   const decl = workspaceDeclarationOf(ext);   // { read, write } | null
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, split out of extension-workspace.ts at the cycle.
 */
import type { ExtensionRecord } from '../storage/interface.js';

/** What a manifest may declare. Both default to false; absent means no capability at all. */
export interface WorkspaceDeclaration { read: boolean; write: boolean }

/** The config key the manifest builder writes the declaration to. `__`-prefixed, so a manifest's
 *  own `config:` block cannot set it (routes/extensions/manifest.ts strips those). */
export const WORKSPACE_DECLARATION_KEY = '__workspace';

/** The declaration on an installed extension, or null when the manifest declared none. */
export function workspaceDeclarationOf(ext: Pick<ExtensionRecord, 'config'>): WorkspaceDeclaration | null {
    const raw = ext.config?.[WORKSPACE_DECLARATION_KEY];
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    const read = d.read === true;
    const write = d.write === true;
    return read || write ? { read, write } : null;
}
