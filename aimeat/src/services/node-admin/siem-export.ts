/**
 * @file src/services/node-admin/siem-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's security events, pushed to the organisation's own monitoring (team setup
 *   T10): as syslog lines (RFC 5424 over UDP or TCP) to `siem.syslog` and as OTLP log records (JSON
 *   over HTTP) to `siem.otlp_url`. A SOC watches a node the way it watches its other systems, and a
 *   Wazuh manager reads the syslog stream with the decoder in docs/operations/siem-wazuh.md.
 *
 *   WHAT GOES OUT, by kind (`siem.events`, comma-separated):
 *   - `refusal`: every request the node turned away at the door (services/auth-audit.ts), the same
 *     fields as the refusal log line: never the credential, only a short digest of it.
 *   - `operator`: an operator's act on the node or on a person's data (services/operator/access-audit.ts).
 *   - `incident`: a security incident opened (services/security-incident.ts).
 *   - `team`: a team's approval gate held an AI's delete, send or payment, and a lead decided it
 *     (services/team/action-gate.ts and the approval route).
 *   - `trail`: every MCP tool call and authenticated REST change (middleware/trail-recorder.ts). Off
 *     by default: it is the busiest stream and carries every person's activity.
 *   No record content and no value ever goes out: names, codes, routes, counts and ids.
 *
 *   NEVER IN THE WAY. An event is a fire-and-forget send: a collector that is down, slow or
 *   unreachable costs a warning once per boot and never a refusal, a delay or an error to anyone.
 *   UDP sends and forgets; TCP keeps one connection and drops what arrives while it reconnects;
 *   OTLP collects for a second and posts one batch, at most 500 records, through safeFetch with the
 *   operator's collector named as an allowed origin.
 *
 *   Settings are read on every event, so an operator changes the target on the Config page without
 *   a restart.
 * @structure SiemKind · SiemEvent · configureSiem · siemEmit · syslogLine · otlpBody · siemStatus
 * @usage
 *   configureSiem(config);                                  // once, at boot
 *   siemEmit('refusal', { status: 401, code: 'AUTH_REQUIRED', path: '/v1/memory' });
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T10).
 */
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { connect as tcpConnect, type Socket as TcpSocket } from 'node:net';
import { hostname } from 'node:os';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { safeFetch } from '../../utils/url-validator.js';
import { onUsageRecorded } from '../usage/usage-buffer.js';

export type SiemKind = 'refusal' | 'operator' | 'incident' | 'team' | 'trail';
export interface SiemEvent { kind: SiemKind; at: string; node: string; fields: Record<string, unknown> }

type SiemConfig = Pick<AimeatConfig, 'nodeId' | 'siemSyslog' | 'siemOtlpUrl' | 'siemEvents'>;

// process-local: nothing; every process binds the same config at boot and sends its own events.
let bound: SiemConfig | null = null;
// process-local: nothing; each process warns once in its own log.
const warned = new Set<string>();
const sent = { syslog: 0, otlp: 0, dropped: 0 };

// process-local: nothing; each process listens to its own usage stream, which holds its own calls.
let offTrail: (() => void) | null = null;

/**
 * Bind the node's settings; the exporter reads them on every event. The trail is read from the
 * usage stream every measured call is written to (services/usage/usage-buffer.ts), so every
 * surface's calls go out without a line in each.
 */
export function configureSiem(config: SiemConfig): void {
    bound = config;
    offTrail?.();
    offTrail = onUsageRecorded(call => siemEmit('trail', {
        account: call.ownerGhii, actor: call.actorGaii, actor_kind: call.actorKind, surface: call.surface,
        call: call.coordinate, outcome: call.outcome, ...(call.reason ? { reason: call.reason } : {}),
        ...(call.counterpartyGhii ? { counterparty: call.counterpartyGhii } : {}), duration_ms: call.durationMs,
    }));
}

function warnOnce(key: string, message: string, meta: Record<string, unknown>): void {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message, meta);
}

/** The kinds the operator chose; `trail` only when named. */
export function enabledKinds(raw: string | undefined): Set<SiemKind> {
    const all: SiemKind[] = ['refusal', 'operator', 'incident', 'team', 'trail'];
    const words = (raw ?? '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    return new Set(words.length ? all.filter(k => words.includes(k)) : all.filter(k => k !== 'trail'));
}

// RFC 5424: facility 13 (log audit) for the security kinds, 16 (local0) for the trail; severity
// 4 (warning) for a refusal and an incident, 5 (notice) for an operator or team act, 6 (info) for the trail.
const PRI: Record<SiemKind, number> = { refusal: 13 * 8 + 4, incident: 13 * 8 + 4, operator: 13 * 8 + 5, team: 13 * 8 + 5, trail: 16 * 8 + 6 };
const SEVERITY: Record<SiemKind, [number, string]> = { refusal: [13, 'WARN'], incident: [17, 'ERROR'], operator: [10, 'INFO'], team: [10, 'INFO'], trail: [9, 'INFO'] };

/** One RFC 5424 line: `<PRI>1 TIME HOST aimeat - KIND - {json}`. The JSON is the whole event. */
export function syslogLine(e: SiemEvent, host = hostname()): string {
    const safeHost = (host || '-').replace(/\s+/g, '').slice(0, 255) || '-';
    return `<${PRI[e.kind]}>1 ${e.at} ${safeHost} aimeat - ${e.kind} - ${JSON.stringify({ kind: e.kind, node: e.node, at: e.at, ...e.fields })}`;
}

/** The OTLP/HTTP JSON body for a batch of events (logs signal, one resource: this node). */
export function otlpBody(events: SiemEvent[], node: string): unknown {
    const attr = (key: string, v: unknown) => ({ key, value: typeof v === 'number' ? { intValue: String(Math.trunc(v)) } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: typeof v === 'string' ? v : JSON.stringify(v) } });
    return {
        resourceLogs: [{
            resource: { attributes: [attr('service.name', 'aimeat'), attr('aimeat.node', node)] },
            scopeLogs: [{
                scope: { name: 'aimeat.security' },
                logRecords: events.map(e => ({
                    timeUnixNano: String(Date.parse(e.at) * 1_000_000),
                    severityNumber: SEVERITY[e.kind][0], severityText: SEVERITY[e.kind][1],
                    body: { stringValue: JSON.stringify({ kind: e.kind, ...e.fields }) },
                    attributes: [attr('aimeat.kind', e.kind), ...Object.entries(e.fields).slice(0, 30).map(([k, v]) => attr(`aimeat.${k}`, v))],
                })),
            }],
        }],
    };
}

// ── syslog ──
// process-local: nothing; each process opens its own socket to the collector.
let udp: UdpSocket | null = null;
// process-local: nothing; each process keeps its own connection to the collector.
let tcp: { target: string; socket: TcpSocket | null; connecting: boolean } | null = null;

function parseTarget(raw: string): { proto: 'udp' | 'tcp'; host: string; port: number } | null {
    const m = /^(udp|tcp):\/\/(\[[^\]]+\]|[^:/]+):(\d{1,5})\/?$/i.exec(raw.trim());
    if (!m) return null;
    const port = Number(m[3]);
    if (port < 1 || port > 65535) return null;
    return { proto: m[1].toLowerCase() as 'udp' | 'tcp', host: m[2].replace(/^\[|\]$/g, ''), port };
}

function sendSyslog(target: string, line: string): void {
    const t = parseTarget(target);
    if (!t) { warnOnce(`syslog-target:${target}`, 'siem: siem.syslog is not udp://host:port or tcp://host:port; nothing is sent', { target }); return; }
    if (t.proto === 'udp') {
        if (!udp) {
            udp = createSocket(t.host.includes(':') ? 'udp6' : 'udp4');
            udp.on('error', err => warnOnce('udp-error', 'siem: the syslog socket failed; events are not sent until it works', { error: String(err) }));
            udp.unref();
        }
        const buf = Buffer.from(line, 'utf8');
        udp.send(buf, t.port, t.host, err => { if (err) { sent.dropped++; warnOnce('udp-send', 'siem: a syslog send failed', { error: String(err) }); } else sent.syslog++; });
        return;
    }
    // TCP: newline-framed lines on one connection; what arrives while it (re)connects is dropped.
    if (!tcp || tcp.target !== target) { tcp?.socket?.destroy(); tcp = { target, socket: null, connecting: false }; }
    const state = tcp;
    if (state.socket && !state.socket.destroyed && !state.connecting) {
        state.socket.write(line + '\n', err => { if (err) sent.dropped++; else sent.syslog++; });
        return;
    }
    sent.dropped++;
    if (state.connecting) return;
    state.connecting = true;
    const socket = tcpConnect({ host: t.host, port: t.port }, () => { state.connecting = false; });
    socket.setKeepAlive(true);
    socket.unref();
    socket.on('error', err => { warnOnce('tcp-error', 'siem: the syslog connection failed; it is tried again on the next event', { target, error: String(err) }); });
    socket.on('close', () => { state.connecting = false; if (state.socket === socket) state.socket = null; });
    state.socket = socket;
}

// ── OTLP ──
// process-local: a process that stops loses its last second of OTLP events; each process posts its own.
let batch: SiemEvent[] = [];
// process-local: nothing; each process flushes its own batch.
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const OTLP_BATCH_MAX = 500;

async function flushOtlp(): Promise<void> {
    flushTimer = null;
    const url = bound?.siemOtlpUrl?.trim();
    const events = batch;
    batch = [];
    if (!url || !events.length || !bound) return;
    try {
        const origin = new URL(url).origin;
        // The operator named this collector; it is often on the organisation's own network, which the
        // SSRF rule refuses for every address nobody named.
        const res = await safeFetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(otlpBody(events, bound.nodeId)), allowOrigins: [origin], maxRedirects: 0,
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) sent.otlp += events.length;
        else { sent.dropped += events.length; warnOnce(`otlp-${res.status}`, 'siem: the OTLP collector refused a batch', { url, status: res.status }); }
    } catch (err) {
        sent.dropped += events.length;
        warnOnce('otlp-error', 'siem: the OTLP collector could not be reached; events are dropped until it can', { url, error: String(err) });
    }
}

function queueOtlp(e: SiemEvent): void {
    if (batch.length >= OTLP_BATCH_MAX) { sent.dropped++; return; }
    batch.push(e);
    if (!flushTimer) { flushTimer = setTimeout(() => { void flushOtlp(); }, 1000); flushTimer.unref?.(); }
}

/**
 * Send one event to whatever the operator configured. Never throws, never waits. `fields` are the
 * event's facts: a caller hands names, codes and ids, never a record value or a credential.
 */
export function siemEmit(kind: SiemKind, fields: Record<string, unknown>): void {
    try {
        const cfg = bound;
        if (!cfg) return;
        const syslog = cfg.siemSyslog?.trim();
        const otlp = cfg.siemOtlpUrl?.trim();
        if (!syslog && !otlp) return;
        if (!enabledKinds(cfg.siemEvents).has(kind)) return;
        const event: SiemEvent = { kind, at: new Date().toISOString(), node: cfg.nodeId, fields };
        if (syslog) sendSyslog(syslog, syslogLine(event));
        if (otlp) queueOtlp(event);
    } catch (err) {
        warnOnce('emit', 'siem: an event could not be sent', { kind, error: String(err) });
    }
}

/** For the operator's Security page and a test: where events go and how many went. */
export function siemStatus(): { syslog: string | null; otlp_url: string | null; events: SiemKind[]; sent: typeof sent } {
    return {
        syslog: bound?.siemSyslog?.trim() || null, otlp_url: bound?.siemOtlpUrl?.trim() || null,
        events: [...enabledKinds(bound?.siemEvents)], sent: { ...sent },
    };
}

/** Send what the OTLP batch holds now (a test, and a stopping node). */
export async function flushSiem(): Promise<void> {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flushOtlp();
}
