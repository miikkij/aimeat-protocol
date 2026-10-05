/**
 * @file src/mcp/resource-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP's resources (aimeat://memory/…, aimeat://organisms/{id} and the rest)
 *   answer under the same rules as its tools. Tools are wrapped at registration in mcp/index.ts: a
 *   permission checked on every call against the request's own scopes, and an organism that admits
 *   only listed agents refusing the others. Resources were not wrapped, so a permission taken away
 *   from an agent stopped its tools and not its resources, and aimeat://organisms/{id} answered an
 *   agent its organism does not admit (secaudit 2026-10, AUTH-2; the resource half of September's A02).
 *
 *   ONE SOURCE FOR THE PERMISSION. Each resource names the tool that reads the same thing
 *   (RESOURCE_READ_TOOL), and the tool's catalogue scope decides, so the two cannot drift apart. A
 *   resource registered without an entry is refused at registration, which an author meets the first
 *   time the server starts.
 * @structure RESOURCE_READ_TOOL · withResourceGate(register, opts)
 * @usage patchable.registerResource = withResourceGate(originalRegisterResource, { allows, agentGaii, storage });
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, AUTH-2).
 */
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Storage } from '../storage/interface.js';
import { barredAgentFor, agentBarredMessage } from '../services/organism-agent-access.js';

/** Each resource, and the tool that reads the same thing: its scope is the resource's scope. */
export const RESOURCE_READ_TOOL: Readonly<Record<string, string>> = {
  'app-index-ui': 'aimeat_app_list',
  'board-posts': 'aimeat_board_read',
  'chat-instance': 'aimeat_instance_status',
  'consent-record': 'aimeat_consent_list',
  'agent-memory': 'aimeat_memory_read',
  'agent-storage': 'aimeat_storage_download',
  'agent-wallet': 'aimeat_wallet_balance',
  'extension-details': 'aimeat_extension_get',
  'knowledge-package': 'aimeat_knowledge_get',
  'organism-details': 'aimeat_organism_get',
};

type AnyFn = (...args: unknown[]) => unknown;
type Contents = { contents: Array<{ uri: string; text: string }> };

export function withResourceGate(register: AnyFn, opts: {
  /** Whether this request may call the named tool (its scope, read from the request's own token). */
  allows: (tool: string) => boolean;
  agentGaii: () => string;
  storage: Pick<Storage, 'getOrganism'>;
}): AnyFn {
  return (...args: unknown[]) => {
    const name = args[0] as string;
    const tool = RESOURCE_READ_TOOL[name];
    if (!tool) throw new Error(`MCP resource "${name}" names no read tool in mcp/resource-gate.ts RESOURCE_READ_TOOL; add it there.`);
    const denied = (uri: URL): Contents => ({
      contents: [{ uri: uri.toString(), text: `Access denied: this resource needs the permission ${tool} needs, which this connection does not hold.` }],
    });

    const next = [...args];
    // A template's list names what exists, so it is gated too.
    const template = args[1];
    if (template instanceof ResourceTemplate && template.listCallback) {
      const list = template.listCallback;
      next[1] = new ResourceTemplate(template.uriTemplate, {
        list: async (extra) => (opts.allows(tool) ? list(extra) : { resources: [] }),
      });
    }

    const last = args.length - 1;
    const read = args[last] as AnyFn;
    next[last] = async (...readArgs: unknown[]) => {
      const uri = readArgs[0] as URL;
      if (!opts.allows(tool)) return denied(uri);
      if (name === 'organism-details') {
        const variables = readArgs[1] as { id?: unknown } | undefined;
        const id = typeof variables?.id === 'string' ? decodeURIComponent(variables.id) : '';
        const gaii = opts.agentGaii();
        const organism = id ? await barredAgentFor(opts.storage, id, gaii) : null;
        if (organism) return { contents: [{ uri: uri.toString(), text: agentBarredMessage(organism, gaii) }] };
      }
      return read(...readArgs);
    };
    return register(...next);
  };
}
