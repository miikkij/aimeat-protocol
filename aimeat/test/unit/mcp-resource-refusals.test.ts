/**
 * @file test/unit/mcp-resource-refusals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit #186: four MCP resources answered a read they refuse with the bare
 *   text "Access denied". Each now answers `CODE: what happened. What to do next.` (resourceRefusal).
 *   The resources are registered on a recording stand-in for the MCP server and read with a record
 *   that belongs to another owner, so the read callback that runs is the one the node registers.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-resource-refusals.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #186).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { CallerContext } from '../../src/services/caller-context.js';
import { registerBoardsTools } from '../../src/mcp/boards.js';
import { registerChatInstancesTools } from '../../src/mcp/chat-instances.js';
import { registerConsentTools } from '../../src/mcp/consent.js';
import { registerOrganismsTools } from '../../src/mcp/organisms.js';

const NODE = 'res-refusal-node';
const AGENT = `bot#alice@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as unknown as AimeatConfig;

type Read = (uri: URL, variables: Record<string, string>) => Promise<{ contents: Array<{ text: string }> }>;

/** A stand-in MCP server that records every registerResource call and ignores everything else. */
function recordingServer(): { mcp: never; resources: Map<string, Read> } {
  const resources = new Map<string, Read>();
  const target = {
    registerResource: (...args: unknown[]) => { resources.set(args[0] as string, args[args.length - 1] as Read); },
  };
  const mcp = new Proxy(target, {
    get: (t, prop) => (prop in t ? (t as Record<string | symbol, unknown>)[prop] : () => undefined),
  });
  return { mcp: mcp as never, resources };
}

/** Storage that answers the given lookups and null for everything else. */
function storageWith(answers: Record<string, unknown>): Storage {
  return new Proxy({}, {
    get: (_t, prop) => async () => (prop in answers ? answers[prop as string] : null),
  }) as Storage;
}

const caller = (): CallerContext => ({
  owner: 'alice', ownerGhii: `alice@${NODE}`, principal: AGENT, roles: ['agent'], scopes: [],
  kind: 'agent', operator: async () => false, has: () => false,
}) as unknown as CallerContext;
const noop = (): void => undefined;

/** The refusal's leading code, after checking it is `CODE: sentence` with a next step in the sentence. */
function refusalCode(text: string): string {
  expect(text).not.toBe('Access denied');
  expect(text).toMatch(/^[A-Z_]+: .*\b(ask|list|search)\b/i);
  return text.split(':')[0]!;
}

describe('MCP resources refuse with a code and a next step', () => {
  it('board-posts: a board not shared with the caller', async () => {
    const { mcp, resources } = recordingServer();
    const storage = storageWith({ getBoard: { id: 'b1', name: 'Private', visibility: 'private', ownerGaii: `mallory@${NODE}`, allowedGaiis: [] } });
    registerBoardsTools(mcp, storage, config, () => AGENT, noop, noop, [], caller);
    const read = resources.get('board-posts')!;
    const out = await read(new URL('aimeat://boards/b1'), { boardId: 'b1' });
    expect(refusalCode(out.contents[0]!.text)).toBe('ACCESS_DENIED');
  });

  it('chat-instance: another owner\'s instance', async () => {
    const { mcp, resources } = recordingServer();
    const storage = storageWith({ getChatInstance: { id: 'i1', ownerName: 'mallory', platform: 'x', appName: 'y' } });
    registerChatInstancesTools(mcp, storage, config, () => AGENT, noop, noop);
    const out = await resources.get('chat-instance')!(new URL('aimeat://instances/i1'), { id: 'i1' });
    expect(refusalCode(out.contents[0]!.text)).toBe('ACCESS_DENIED');
  });

  it('consent-record: another owner\'s record', async () => {
    const { mcp, resources } = recordingServer();
    const storage = storageWith({ getConsent: { id: 'c1', ownerGaii: `mallory@${NODE}`, purpose: 'p', status: 'active' } });
    registerConsentTools(mcp, storage, config, () => AGENT, noop, noop, [], caller);
    const out = await resources.get('consent-record')!(new URL('aimeat://consents/c1'), { id: 'c1' });
    expect(refusalCode(out.contents[0]!.text)).toBe('ACCESS_DENIED');
  });

  it('organism-details: a private organism the caller is not a member of', async () => {
    const { mcp, resources } = recordingServer();
    const storage = storageWith({ getOrganism: { id: 'o1', name: 'Closed', visibility: 'private', type: 'team', members: ['mallory'] } });
    registerOrganismsTools(mcp, storage, config, () => AGENT, noop, noop, [], caller);
    const out = await resources.get('organism-details')!(new URL('aimeat://organisms/o1'), { id: 'o1' });
    expect(refusalCode(out.contents[0]!.text)).toBe('FORBIDDEN');
  });
});
