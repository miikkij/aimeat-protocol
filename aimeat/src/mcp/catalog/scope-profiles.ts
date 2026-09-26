/**
 * @file scope-profiles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Role-based scope bundles for provisioning agents: MCP_SCOPE_PROFILES and
 *   scopesForProfile(). Moved unchanged out of ./scopes.ts, which re-exports both, so every importer
 *   of scopes.ts keeps working.
 * @structure
 *   - MCP_SCOPE_PROFILES — agent mode -> the scopes it is provisioned with
 *   - scopesForProfile() — the bundle for a mode, with a logged fallback for an unknown one
 * @usage
 *   import { scopesForProfile } from '../catalog/scopes.js';
 *   const scopes = scopesForProfile('task-runner');
 * @version-history
 *   v1.0.0 -- 2026-09-26 -- Moved unchanged from scopes.ts (v1.30.1), which had passed the 800-line
 *     limit.
 */
import { logger } from '../../utils/logger.js';

/**
 * Role-based scope bundles for provisioning agents (e.g. at device-auth approval). Maps the
 * existing AgentRecord.mode values to sensible defaults drawn from the scope vocabulary the node
 * actually enforces today (memory / social / wallet / work / consent). As new scope domains are
 * added (e.g. task:*, app:*), extend these bundles. 'interactive'/'autonomous'/'workstation' are
 * broad because they front owner-attached, human-in-the-loop use (e.g. Claude Desktop, VSCode);
 * 'task-runner' is minimal.
 */
export const MCP_SCOPE_PROFILES: Record<string, string[]> = {
    'task-runner': ['memory:read', 'memory:write', 'work:read', 'work:accept'],
    coordinator: ['memory:read', 'memory:write', 'social:read', 'social:write', 'messages:send', 'messages:read', 'work:read', 'work:request', 'workflow:read', 'workflow:write'],
    appdev: ['memory:read', 'memory:write'],
    'organism-knowledge': ['memory:read', 'memory:write', 'social:read'],
    interactive: ['*'],
    autonomous: ['*'],
    workstation: ['*'],
};

/**
 * Scope bundle for an agent mode/profile; falls back to a conservative read+write memory set.
 *
 * A NAME THAT IS NOT IN THE TABLE IS SAID OUT LOUD. The fallback is right for a caller that has no
 * mode to offer, and it is a defect for a caller that names one: the built-in chat agent asked for
 * a profile called `agent`, got the fallback, and shipped able to read and write memory and to do
 * nothing else on the person's own node for six days. Nothing failed, nothing logged, and the
 * missing capability looked like a design decision. The return value is unchanged — a warning, not
 * a refusal, because the fallback is still the safe answer to a question nobody can parse.
 */
export function scopesForProfile(mode: string | undefined): string[] {
    const known = mode ? MCP_SCOPE_PROFILES[mode] : undefined;
    if (mode && !known) {
        logger.warn('scopesForProfile: unknown profile, falling back to memory read+write', {
            profile: mode, known: Object.keys(MCP_SCOPE_PROFILES).join(', '),
        });
    }
    return known || ['memory:read', 'memory:write'];
}
