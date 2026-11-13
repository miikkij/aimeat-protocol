/**
 * @file test/unit/smtp-timeouts.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's SMTP transport has time limits. Without them the mail library waits 2
 *   minutes for a connection and 10 minutes of silence, so a mail server that accepted the connection
 *   and never greeted held its caller that long, three times over with the retries. A black-hole
 *   server (accepts, says nothing) must fail one attempt within the connect limit; 0 keeps the
 *   library's own limits, as before.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: SMTP timeouts).
 */
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { createTransport } from 'nodemailer';
import { smtpTransportOptions } from '../../src/services/email.js';
import { smtpDefaults } from '../../src/config/smtp.js';

const base = {
  smtpHost: '127.0.0.1', smtpPort: 25, smtpSecure: false, smtpUser: null, smtpPass: null, smtpRejectUnauthorized: true,
};

describe('smtpTransportOptions', () => {
  it('defaults to a 10 s connect and greeting limit and a 60 s silence limit', () => {
    const d = smtpDefaults();
    expect(d.smtpConnectTimeoutMs).toBe(10_000);
    expect(d.smtpSocketTimeoutMs).toBe(60_000);
    const o = smtpTransportOptions({ ...base, smtpConnectTimeoutMs: d.smtpConnectTimeoutMs, smtpSocketTimeoutMs: d.smtpSocketTimeoutMs });
    expect(o).toMatchObject({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 60_000 });
  });

  it('leaves the mail library its own limits at 0', () => {
    const o = smtpTransportOptions({ ...base, smtpConnectTimeoutMs: 0, smtpSocketTimeoutMs: 0 });
    expect(o).not.toHaveProperty('connectionTimeout');
    expect(o).not.toHaveProperty('greetingTimeout');
    expect(o).not.toHaveProperty('socketTimeout');
  });

  it('fails one attempt against a server that never greets within the connect limit', async () => {
    const held: net.Socket[] = [];
    const blackHole = net.createServer((s) => { held.push(s); });
    await new Promise<void>((r) => blackHole.listen(0, '127.0.0.1', () => r()));
    const port = (blackHole.address() as AddressInfo).port;
    try {
      const transport = createTransport(smtpTransportOptions({ ...base, smtpPort: port, smtpConnectTimeoutMs: 400, smtpSocketTimeoutMs: 400 }));
      const started = Date.now();
      await expect(transport.sendMail({ from: 'a@example.test', to: 'b@example.test', subject: 's', text: 't' })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      for (const s of held) s.destroy();
      await new Promise<void>((r) => blackHole.close(() => r()));
    }
  });
});
