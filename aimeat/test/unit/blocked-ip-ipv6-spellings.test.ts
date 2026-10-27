/**
 * @file test/unit/blocked-ip-ipv6-spellings.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description IPv6 loopback and unspecified are decided on the address, not on its spelling: the
 *   long, zero-padded, partly compressed and dotted forms of ::1 and :: are refused on a public node
 *   like the short forms, and a company SMTP host written that way is refused there. On a node in local
 *   mode the long loopback spelling passes as ::1 does (secaudit2026oct26,
 *   blockedIpReason/noncanonical-ipv6-loopback-unspecified).
 * @usage cd aimeat && pnpm exec vitest run test/unit/blocked-ip-ipv6-spellings.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { blockedIpReason, isLoopbackIp } from '../../src/utils/blocked-ip.js';
import { checkSmtpHost } from '../../src/services/company/smtp-host-check.js';

const saved = { egress: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS, dev: process.env.AIMEAT_DEV_MODE };
function publicNode(): void { process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'false'; delete process.env.AIMEAT_DEV_MODE; }
afterEach(() => {
  if (saved.egress === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = saved.egress;
  if (saved.dev === undefined) delete process.env.AIMEAT_DEV_MODE; else process.env.AIMEAT_DEV_MODE = saved.dev;
});

const LOOPBACK_SPELLINGS = ['::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '0::1', '0:0::0:1', '::0.0.0.1', '::0001'];
const UNSPECIFIED_SPELLINGS = ['::', '0:0:0:0:0:0:0:0', '0000::', '::0', '::0.0.0.0'];

describe('blockedIpReason: every spelling of IPv6 loopback and unspecified', () => {
  for (const ip of LOOPBACK_SPELLINGS) {
    it(`refuses ${ip} as loopback`, () => { expect(blockedIpReason(ip)).toBe('IPv6 loopback'); });
  }
  for (const ip of UNSPECIFIED_SPELLINGS) {
    it(`refuses ${ip} as unspecified`, () => { expect(blockedIpReason(ip)).toBe('IPv6 unspecified'); });
  }
  it('still passes a public IPv4 and IPv6 address', () => {
    expect(blockedIpReason('93.184.216.34')).toBeNull();
    expect(blockedIpReason('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
    expect(blockedIpReason('2606:2800:0220:0001:0248:1893:25c8:1946')).toBeNull();
  });
  it('isLoopbackIp answers for every loopback spelling, and for no other address', () => {
    for (const ip of LOOPBACK_SPELLINGS) expect(isLoopbackIp(ip)).toBe(true);
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::')).toBe(false);
    expect(isLoopbackIp('::2')).toBe(false);
    expect(isLoopbackIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
});

describe('checkSmtpHost with a long IPv6 spelling', () => {
  it('refuses the long loopback and unspecified spellings on a public node', async () => {
    publicNode();
    for (const ip of [...LOOPBACK_SPELLINGS, ...UNSPECIFIED_SPELLINGS]) {
      const r = await checkSmtpHost(ip, []);
      expect(r.ok, ip).toBe(false);
      expect(r.ok === false && r.code, ip).toBe('SMTP_HOST_NOT_ALLOWED');
    }
  });
  it('keeps ::1 and its long spelling on a node in local mode, and a public literal on a public node', async () => {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    expect(await checkSmtpHost('::1', [])).toEqual({ ok: true, address: '::1' });
    expect(await checkSmtpHost('0:0:0:0:0:0:0:1', [])).toEqual({ ok: true, address: '0:0:0:0:0:0:0:1' });
    publicNode();
    expect(await checkSmtpHost('2606:2800:220:1:248:1893:25c8:1946', [])).toEqual({ ok: true, address: '2606:2800:220:1:248:1893:25c8:1946' });
    expect(await checkSmtpHost('93.184.216.34', [])).toEqual({ ok: true, address: '93.184.216.34' });
  });
});
