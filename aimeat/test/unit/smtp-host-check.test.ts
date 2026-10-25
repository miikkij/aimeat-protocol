/**
 * @file test/unit/smtp-host-check.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A company's SMTP host against the outbound address rules and the operator's list of
 *   private mail servers (services/company/smtp-host-check.ts; secaudit2026oct22,
 *   sendAsCompany:smtp-host-address-class).
 * @usage cd aimeat && pnpm exec vitest run test/unit/smtp-host-check.test.ts
 * @version-history
 *   2026-10-25 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { checkSmtpHost, isListedPrivateHost } from '../../src/services/company/smtp-host-check.js';

const resolvesTo = (...addresses: string[]) => async () => addresses.map(address => ({ address }));
const unresolved = async (): Promise<Array<{ address: string }>> => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); };

const saved = { egress: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS, dev: process.env.AIMEAT_DEV_MODE };
function publicNode(): void { process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'false'; delete process.env.AIMEAT_DEV_MODE; }
afterEach(() => {
  if (saved.egress === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = saved.egress;
  if (saved.dev === undefined) delete process.env.AIMEAT_DEV_MODE; else process.env.AIMEAT_DEV_MODE = saved.dev;
});

describe('the operator\'s list of private mail servers', () => {
  it('matches a host name, an address and a network, and nothing else', () => {
    expect(isListedPrivateHost('Mail.Internal', '10.0.5.7', ['mail.internal'])).toBe(true);
    expect(isListedPrivateHost('relay', '10.0.5.7', ['10.0.5.7'])).toBe(true);
    expect(isListedPrivateHost('relay', '10.0.5.7', ['10.0.5.0/24'])).toBe(true);
    expect(isListedPrivateHost('relay', '10.0.6.7', ['10.0.5.0/24'])).toBe(false);
    expect(isListedPrivateHost('relay', 'fd00::25', ['fd00::/64'])).toBe(true);
    expect(isListedPrivateHost('relay', '10.0.5.7', ['fd00::/64', 'nonsense/99', ''])).toBe(false);
  });
});

describe('checkSmtpHost', () => {
  it('passes a public mail server and connects to the address it checked', async () => {
    publicNode();
    expect(await checkSmtpHost('smtp.example.com', [], resolvesTo('93.184.216.34'))).toEqual({ ok: true, address: '93.184.216.34' });
  });

  it('refuses a private address on a public node, naming the setting, unless the operator lists it', async () => {
    publicNode();
    const refused = await checkSmtpHost('relay.corp', [], resolvesTo('10.1.2.3'));
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.message).toContain('email.company_smtp_private_hosts');
    expect(await checkSmtpHost('relay.corp', ['10.1.0.0/16'], resolvesTo('10.1.2.3'))).toEqual({ ok: true, address: '10.1.2.3' });
  });

  it('refuses a name with any private answer, so the answer does not depend on which address is picked', async () => {
    publicNode();
    expect((await checkSmtpHost('mixed.example', [], resolvesTo('93.184.216.34', '127.0.0.1'))).ok).toBe(false);
  });

  it('keeps loopback for a node in local mode, and refuses it on a public node', async () => {
    publicNode();
    expect((await checkSmtpHost('127.0.0.1', [])).ok).toBe(false);
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    expect(await checkSmtpHost('127.0.0.1', [])).toEqual({ ok: true, address: '127.0.0.1' });
    expect((await checkSmtpHost('169.254.169.254', [])).ok).toBe(false);
  });

  it('does not refuse a name that does not resolve yet; the send then fails on the name', async () => {
    publicNode();
    expect(await checkSmtpHost('smtp.example.invalid', [], unresolved)).toEqual({ ok: true, address: null });
  });
});
