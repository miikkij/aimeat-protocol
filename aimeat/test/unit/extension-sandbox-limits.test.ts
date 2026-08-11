/**
 * @file extension-sandbox-limits.test.ts
 * @description Locks the arithmetic that decides how much memory, time and outbound budget one
 *   extension action may have (services/extension-ctx.ts sandboxLimits). The node's configured
 *   maxima are a CEILING; the manifest's declared numbers are a request; the small floors keep a
 *   manifest that asks for nothing from getting a sandbox too small to start in.
 *
 *   The test exists because the two doors disagreed. The HTTP door computed
 *   min(max(declared, floor), cap) and the MCP door computed max(declared, cap), which turns the
 *   ceiling into a floor: an extension declaring a 60-second timeout got 60 seconds through a tool
 *   call and was killed at the configured limit over HTTP, and every extension invoked over MCP got
 *   at least the node maximum memory and API-call budget whatever its manifest asked for.
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Security audit, MCP/REST drift: one ceiling, both doors
 */
import { describe, it, expect } from 'vitest';
import { sandboxLimits } from '../../src/services/extension-ctx.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 5000,
    extensionMaxApiCalls: 20,
} as AimeatConfig;

describe('sandboxLimits', () => {
    it('caps a manifest that asks for more than the node allows', () => {
        const limits = sandboxLimits({ memoryMb: 512, timeoutMs: 60_000, maxApiCalls: 1000 }, config);
        expect(limits).toEqual({ memoryMb: 64, timeoutMs: 5000, maxApiCalls: 20 });
    });

    it('grants a modest request as asked, without inflating it to the node maximum', () => {
        const limits = sandboxLimits({ memoryMb: 32, timeoutMs: 2000, maxApiCalls: 15 }, config);
        expect(limits).toEqual({ memoryMb: 32, timeoutMs: 2000, maxApiCalls: 15 });
    });

    it('floors a manifest that asks for nothing, so the sandbox can still start', () => {
        const limits = sandboxLimits({ memoryMb: 0, timeoutMs: 0, maxApiCalls: 0 }, config);
        expect(limits).toEqual({ memoryMb: 16, timeoutMs: 1000, maxApiCalls: 10 });
    });

    it('keeps the floor under the ceiling when the node is configured tighter than the floor', () => {
        const tight = { extensionMaxMemoryMb: 8, extensionTimeoutMs: 500, extensionMaxApiCalls: 2 } as AimeatConfig;
        const limits = sandboxLimits({ memoryMb: 0, timeoutMs: 0, maxApiCalls: 0 }, tight);
        expect(limits).toEqual({ memoryMb: 8, timeoutMs: 500, maxApiCalls: 2 });
    });
});
