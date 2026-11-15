/**
 * @file test/unit/siem-export.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's security events to the organisation's monitoring (services/siem-export.ts):
 *   a refusal arrives at a syslog listener over UDP and over TCP as one RFC 5424 line with the
 *   refusal's facts and never the credential; nothing is sent with no target or for a kind the
 *   operator left out; the trail is out unless named; the OTLP body is the logs signal's shape; a
 *   target that is not udp:// or tcp:// sends nothing and throws nothing.
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (team setup T10).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createSocket } from 'node:dgram';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { configureSiem, siemEmit, syslogLine, otlpBody, enabledKinds, siemStatus } from '../../src/services/siem-export.js';
import { recordAuthFailure } from '../../src/services/auth-audit.js';

const cfg = { nodeId: 'test-node', siemSyslog: '', siemOtlpUrl: '', siemEvents: '' };
const udp = createSocket('udp4');
let tcp: Server | null = null;
afterAll(() => { udp.close(); tcp?.close(); configureSiem({ ...cfg }); });

async function udpPort(): Promise<number> {
    await new Promise<void>(r => udp.bind(0, '127.0.0.1', () => r()));
    return (udp.address() as AddressInfo).port;
}
const nextUdp = () => new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no syslog line arrived')), 2000);
    udp.once('message', m => { clearTimeout(t); resolve(m.toString('utf8')); });
});

const refusal = () => recordAuthFailure(
    { method: 'GET', path: '/v1/memory', ip: '198.51.100.7', host: 'node.example', userAgent: 'curl/8', authorization: 'Bearer SECRET-TOKEN-VALUE-123456', hasCookie: false },
    { status: 401, code: 'AUTH_REQUIRED', reason: 'bad token' },
);

describe('siem export', () => {
    it('sends nothing with no target, and the default kinds leave the trail out', () => {
        configureSiem({ ...cfg });
        expect(() => siemEmit('refusal', { code: 'X' })).not.toThrow();
        expect(siemStatus().sent.syslog).toBe(0);
        expect([...enabledKinds('')].sort()).toEqual(['incident', 'operator', 'refusal', 'team']);
        expect(enabledKinds('refusal, trail').has('trail')).toBe(true);
    });

    it('a refusal arrives over UDP as one RFC 5424 line, without the credential', async () => {
        const port = await udpPort();
        configureSiem({ ...cfg, siemSyslog: `udp://127.0.0.1:${port}` });
        const got = nextUdp();
        refusal();
        const line = await got;
        expect(line).toMatch(/^<108>1 \d{4}-\d\d-\d\dT[^ ]+ \S+ aimeat - refusal - \{/);
        const json = JSON.parse(line.slice(line.indexOf('{')));
        expect(json).toMatchObject({ kind: 'refusal', node: 'test-node', status: 401, code: 'AUTH_REQUIRED', path: '/v1/memory', ip: '198.51.100.7' });
        expect(line).not.toContain('SECRET-TOKEN-VALUE');
    });

    it('a kind the operator left out is not sent', async () => {
        const port = (udp.address() as AddressInfo).port;
        configureSiem({ ...cfg, siemSyslog: `udp://127.0.0.1:${port}`, siemEvents: 'incident' });
        const got = nextUdp();
        siemEmit('refusal', { code: 'NOT_SENT' });
        siemEmit('incident', { code: 'SENT' });
        expect(await got).toContain('"code":"SENT"');
    });

    it('over TCP, lines are newline-framed on one connection', async () => {
        const lines: string[] = [];
        tcp = createServer(sock => sock.on('data', d => lines.push(...d.toString('utf8').split('\n').filter(Boolean))));
        await new Promise<void>(r => tcp!.listen(0, '127.0.0.1', () => r()));
        const port = (tcp.address() as AddressInfo).port;
        configureSiem({ ...cfg, siemSyslog: `tcp://127.0.0.1:${port}` });
        siemEmit('operator', { act: 'config.set', n: 0 });          // opens the connection; dropped
        await new Promise(r => setTimeout(r, 200));
        siemEmit('operator', { act: 'config.set', n: 1 });
        siemEmit('team', { action: 'team:delete', status: 'pending' });
        await new Promise(r => setTimeout(r, 300));
        expect(lines.length).toBe(2);
        expect(lines[0]).toMatch(/^<109>1 .* aimeat - operator - /);
        expect(lines[1]).toContain('"action":"team:delete"');
    });

    it('a target that is not udp:// or tcp:// sends nothing and throws nothing', () => {
        configureSiem({ ...cfg, siemSyslog: 'http://127.0.0.1:514' });
        expect(() => siemEmit('incident', { code: 'X' })).not.toThrow();
    });

    it('the syslog line and the OTLP body have their formats', () => {
        const e = { kind: 'incident' as const, at: '2026-11-15T10:00:00.000Z', node: 'n1', fields: { code: 'ZIP', size: 3 } };
        expect(syslogLine(e, 'host one')).toBe('<108>1 2026-11-15T10:00:00.000Z hostone aimeat - incident - {"kind":"incident","node":"n1","at":"2026-11-15T10:00:00.000Z","code":"ZIP","size":3}');
        const body = otlpBody([e], 'n1') as { resourceLogs: Array<{ resource: { attributes: Array<{ key: string }> }; scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }> };
        const rec = body.resourceLogs[0].scopeLogs[0].logRecords[0];
        expect(body.resourceLogs[0].resource.attributes.map(a => a.key)).toEqual(['service.name', 'aimeat.node']);
        expect(rec.severityText).toBe('ERROR');
        expect(rec.timeUnixNano).toBe(String(Date.parse(e.at) * 1_000_000));
    });
});
