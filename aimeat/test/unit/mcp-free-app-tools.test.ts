/**
 * @file test/unit/mcp-free-app-tools.test.ts
 * @description MCP app-tool price decisions preserve free calls, refusals and pinned contracts.
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — The McpServer fake takes registerTool(name, config, handler), the form every tool registers with since the MCP SDK v2 migration step 3.
 *   2026-10-20 — appToolBindingRefusal is part of the capability-invoke module this suite mocks, and
 *     a refusal from it fails the tool without invoking anything (secaudit 2026-10).
 *   2026-10-11 — The `price.morsels` case asserted the old model; a morsel amount is pacing, so only money keeps a tool behind its contract.
 *   2026-10-06 —Regression: cross-owner unpriced tools incorrectly answered NO_CONTRACT over MCP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { MeteredOutcome } from '../../src/services/metered-access.js';
import { registerExchangeRunTools } from '../../src/mcp/exchange-run.js';
import { authoriseMeteredCall } from '../../src/services/metered-access.js';
import { invokeCapability, appToolBindingRefusal } from '../../src/services/capability-invoke.js';
import { consumeInternalPass } from '../../src/routes/extensions/internal-pass.js';
import { membersOnlyRefusalForCapability } from '../../src/services/members-only.js';
import { getInterfaceVersion } from '../../src/services/app-tool-interfaces.js';

vi.mock('../../src/services/metered-access.js', () => ({ authoriseMeteredCall: vi.fn() }));
vi.mock('../../src/services/capability-invoke.js', () => ({ invokeCapability: vi.fn(), appToolBindingRefusal: vi.fn() }));
vi.mock('../../src/services/call-timing.js', () => ({ recordCallDuration: vi.fn() }));
vi.mock('../../src/services/members-only.js', () => ({ membersOnlyRefusalForCapability: vi.fn(), MEMBERS_ONLY_MESSAGE: 'Members only.' }));
vi.mock('../../src/services/app-tool-interfaces.js', () => ({ getInterfaceVersion: vi.fn() }));

const caller = 'helper#buyer@node.test', scopes = ['social:read'];
const tool = { name: 'read', action_id: 'ext:sample:dispatch', lockedInput: { op: 'get' },
  inputSchema: { type: 'object', required: ['op'], properties: { op: { type: 'string' } } } };
type ToolResult = { isError?: boolean; content: { text: string }[] };
type Handler = (input: Record<string, unknown>) => Promise<ToolResult>;

function harness(fields: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const mcp = { registerTool: (name: string, _config: unknown, handler: Handler) => {
    handlers.set(name, handler);
  } } as unknown as McpServer;
  const storage = { getMemory: vi.fn().mockResolvedValue({ visibility: 'public', value: { tools: [{ ...tool, ...fields }] } }),
    getCapability: vi.fn().mockImplementation(async id => ({ id })), listMemory: vi.fn().mockResolvedValue([]) } as unknown as Storage;
  registerExchangeRunTools(mcp, storage, { nodeId: 'node.test' } as AimeatConfig, () => caller, () => 'session-token', scopes);
  return { storage, call: (input: Record<string, unknown> = {}) => handlers.get('aimeat_app_tool_invoke')!({ owner: 'seller', app: 'sample.html', tool: 'read', input }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authoriseMeteredCall).mockResolvedValue({ kind: 'no_right' });
  vi.mocked(membersOnlyRefusalForCapability).mockResolvedValue(null);
  vi.mocked(getInterfaceVersion).mockResolvedValue(null);
  vi.mocked(appToolBindingRefusal).mockReturnValue(null);
  vi.mocked(invokeCapability).mockResolvedValue({ result: { ready: true } } as never);
});

describe('unpriced app tools over node MCP', () => {
  it.each([{}, { price: { morsels: 0 } }])('invokes a free tool with its locked input and authenticated caller: %j', async fields => {
    const h = harness(fields), result = await h.call({ op: 'delete' });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ metered: false, result: { ready: true } });
    const args = vi.mocked(invokeCapability).mock.calls[0];
    expect(args[3]).toEqual({ op: 'get' });
    expect(args[4]).toBe(caller); expect(args[5]).toBe('session-token'); expect(args[8]).toEqual({ scopes });
    expect(consumeInternalPass(args[7])).toEqual({ kind: 'unpriced', coordExt: 'apptool:seller/sample.html', coordAction: 'read' });
  });

  // Money prices only: an old `price.morsels` is a pacing amount since 2026-10-11, so that tool runs
  // without a contract and is charged its pacing (e2e-app-tool-free-mcp covers the charge).
  it.each([{ priceMoney: { amount: 1000, currency: 'EUR' } },
    { pricesMoney: [{ amount: 1000, currency: 'USD' }] }])('keeps a priced tool behind its contract: %j', async fields => {
    const result = await harness(fields).call();
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('NO_CONTRACT:');
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it('does not expose an unpublished private manifest through the free path', async () => {
    const h = harness();
    vi.mocked(h.storage.getMemory).mockResolvedValue({ visibility: 'private', value: { tools: [tool] } } as never);
    const result = await h.call();
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('APP_TOOLS_NOT_FOUND:');
    expect(authoriseMeteredCall).not.toHaveBeenCalled(); expect(invokeCapability).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'refused_rate', 'refused_budget'] as const)('never falls through a %s entitlement to a free call', async kind => {
    vi.mocked(authoriseMeteredCall).mockResolvedValue({ kind, entitlement: { state: 'revoked', contractRef: 'old', unit: 'morsels', budget: { capUnits: 1 } } } as MeteredOutcome);
    const result = await harness().call();
    expect(result.isError).toBe(true); expect(invokeCapability).not.toHaveBeenCalled();
  });

  it("refuses a manifest binding the app's owner does not own, without invoking it", async () => {
    vi.mocked(appToolBindingRefusal).mockReturnValue(
      { statusCode: 403, code: 'CAPABILITY_NOT_OWNED_BY_APP', message: 'not the app owner\'s' });
    const result = await harness().call();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('CAPABILITY_NOT_OWNED_BY_APP:');
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it('preserves the members-only and spending-scope refusals', async () => {
    vi.mocked(membersOnlyRefusalForCapability).mockResolvedValue('members' as never);
    expect((await harness().call()).content[0].text).toContain('MEMBERS_ONLY:');
    expect(authoriseMeteredCall).not.toHaveBeenCalled();
    vi.mocked(membersOnlyRefusalForCapability).mockResolvedValue(null);
    vi.mocked(authoriseMeteredCall).mockResolvedValue({ kind: 'scope_required', scope: 'contract:spend' });
    expect((await harness().call()).content[0].text).toContain('SCOPE_DENIED:');
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it('keeps paid contracts pinned and refunds a failed capability invocation', async () => {
    const refund = vi.fn(), accrue = vi.fn();
    vi.mocked(authoriseMeteredCall).mockResolvedValue({ kind: 'settled', charged: 1, refund, accrue,
      entitlement: { surface: { kind: 'app-tool', ifaceVersion: 3 }, providerGhii: 'seller@node.test' } } as unknown as MeteredOutcome);
    vi.mocked(getInterfaceVersion).mockResolvedValue({ binding: 'ext:old:dispatch' } as never);
    const h = harness(), result = await h.call();
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ metered: true, iface_version: 3 });
    expect(h.storage.getCapability).toHaveBeenCalledWith('ext:old:dispatch');
    expect(consumeInternalPass(vi.mocked(invokeCapability).mock.calls[0][7])?.kind).toBe('settled');
    expect(accrue).toHaveBeenCalledOnce(); expect(refund).not.toHaveBeenCalled();
    vi.mocked(invokeCapability).mockRejectedValue(Object.assign(new Error('refused'), { code: 'CAPABILITY_REFUSED' }));
    expect((await h.call()).content[0].text).toContain('CAPABILITY_REFUSED:');
    expect(refund).toHaveBeenCalledOnce();
  });
});
