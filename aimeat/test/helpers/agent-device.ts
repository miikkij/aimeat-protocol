/**
 * @file test/helpers/agent-device.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent connected the way a real one is: device authorization (RFC 8628), the
 *   owner's approval with the scopes they pick, and the token the device then collects. One copy for
 *   every suite that needs an agent this way.
 *
 *   WHY (report of 2026-11-15, 2.5 and 5.3). About seventy suites wrote these three calls out
 *   inline, each with its own error text, and a change to the flow had seventy places to land.
 *   scripts/check-suite-hygiene.ts counts the suites that still write the flow out, and the count may
 *   only fall. A suite that tests the flow itself (its refusals, its answers) keeps its own calls.
 * @structure DeviceAgent · connectAgentByDevice()
 * @usage
 *   import { connectAgentByDevice } from './helpers/agent-device.js';
 *   const agent = await connectAgentByDevice(BASE, { owner: 'alice', ownerToken, name: 'reader', scopes: ['memory:read'] });
 *   await fetch(`${BASE}/v1/memory`, { headers: { Authorization: `Bearer ${agent.token}` } });
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 5.3).
 */

export interface DeviceAgent {
    /** The agent's bearer token, as the device collected it. */
    token: string;
    /** The agent's name as it was asked for. */
    name: string;
    /** Everything the token answer carried (the GAII, the refresh token where one is issued). */
    answer: Record<string, unknown>;
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
}

/**
 * Connect an agent of `owner` by device authorization and return its token. Throws with the step
 * and the node's answer when a step is refused, so a failing setup says where it stopped.
 */
export async function connectAgentByDevice(base: string, opts: { owner: string; ownerToken: string; name: string; scopes: string[] }): Promise<DeviceAgent> {
    const start = await post(base, '/v1/agents/device-authorize', { agent_name: opts.name, owner: opts.owner });
    if (start.status !== 200 || !start.body?.data?.device_code) {
        throw new Error(`device-authorize ${start.status}: ${JSON.stringify(start.body?.error ?? start.body)}`);
    }
    const approve = await post(base, '/v1/agents/verify', {
        user_code: start.body.data.user_code, action: 'approve', scopes: opts.scopes, owner_token: opts.ownerToken,
    });
    if (approve.status !== 200) throw new Error(`verify (approve) ${approve.status}: ${JSON.stringify(approve.body?.error ?? approve.body)}`);
    const tok = await post(base, '/v1/agents/device-token', {
        device_code: start.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const token = tok.body?.token ?? tok.body?.access_token ?? tok.body?.data?.token;
    if (tok.status !== 200 || typeof token !== 'string') throw new Error(`device-token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { token, name: opts.name, answer: tok.body };
}
