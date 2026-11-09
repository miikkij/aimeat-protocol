/**
 * @file src/services/extension-live/changed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.changed({ owners })`: an extension tells the node that the data it serves changed
 *   for named owners, and the node sends the extension's own live domain, `ext:<installer>/<name>`,
 *   to those owners' open event streams (routes/sse.ts). A page that shows the extension's data
 *   subscribes to that domain with AIMEAT.live and reads again when it arrives, so no page polls an
 *   extension whose data lives in an outside service.
 *
 *   What it carries: the domain name and nothing else, the same as every other change event. What it
 *   reaches: only streams of the named owners (ChangeEvent.ownerGaii), and of those only principals
 *   whose scopes cover `ext:invoke` (auth/sse-domain-scopes.ts), the word a page needs to call the
 *   extension at all. The domain is the extension's own, so an extension cannot name another
 *   extension's domain or a core domain. Without `owners` it tells the caller's owner.
 *
 *   An owner of another node, an empty name and anything past MAX_OWNERS are left out: the count the
 *   call answers is how many owners were told. One call is one outbound call of the action's budget
 *   (limits.max_api_calls), like ctx.notify.
 * @structure MAX_OWNERS, buildExtensionChanged
 * @usage changed: buildExtensionChanged({ config, extName: ext.name, extOwner: ext.installedBy, callerOwner: caller.owner })
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial: an accounting screen whose books are in an outside service had no
 *     way to learn that an agent or a colleague changed them.
 */
import type { AimeatConfig } from '../../config.js';
import type { ExtensionCtx } from '../extension-ctx-contract.js';
import { emitChange, extensionDomain } from '../event-bus.js';
import { localAccountOf } from '../../utils/gaii.js';

/** The most owners one call tells. A firm's roster is tens of people; the rest of a longer list is dropped. */
export const MAX_OWNERS = 100;

export function buildExtensionChanged(deps: {
  config: AimeatConfig;
  extName: string;
  /** Bare name of the account that installed the extension: the first half of its domain. */
  extOwner: string;
  /** The caller's owner (on an unattended run, the installer): who is told when `owners` is absent. */
  callerOwner: string;
}): NonNullable<ExtensionCtx['changed']> {
  const { config, extName, extOwner, callerOwner } = deps;
  const domain = extensionDomain(extOwner, extName);
  return async (opts?: { owners?: unknown }) => {
    const named = Array.isArray(opts?.owners) ? opts.owners : [callerOwner];
    const told = new Set<string>();
    for (const entry of named) {
      if (told.size >= MAX_OWNERS) break;
      if (typeof entry !== 'string' || !entry || entry.length > 256) continue;
      const account = localAccountOf(entry.includes('@') ? entry : `${entry}@${config.nodeId}`);
      if (account) told.add(account);
    }
    for (const account of told) emitChange(domain, `${account}@${config.nodeId}`);
    return told.size;
  };
}
