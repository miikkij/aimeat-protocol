/**
 * @file test/unit/mail-gate-reserve.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/mail-gate.ts sendMail under the per-sender daily limit when sends of one
 *   sender overlap: the slot is taken before the delivery is awaited, so N concurrent sends under
 *   perDay P deliver P mails, and a delivery that answers false or throws gives its slot back
 *   (secaudit2026nov08 round 14, mail-gate:sender-limit-counted-after-delivery).
 * @usage pnpm exec vitest run test/unit/mail-gate-reserve.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { sendMail, senderLimitReached, type MailMessage } from '../../src/services/mail-gate.js';
import type { EmailService } from '../../src/services/email.js';

const ADDRESS = 'alice@example.test';
const hashOf = (a: string) => createHash('sha256').update(a.toLowerCase().trim()).digest('hex');
const proven = { notificationEmail: ADDRESS, emailVerifiedAt: '2026-11-01T00:00:00.000Z', emailHash: hashOf(ADDRESS) };
const html: MailMessage = { form: 'html', subject: 'S', html: '<p>B</p>', text: 'B' };

/** A mail service whose sendRaw answers `answer` after `ms` milliseconds. */
function slowService(answer: boolean | 'throw', ms = 30): EmailService & { sendRaw: ReturnType<typeof vi.fn> } {
  const sendRaw = vi.fn(() => new Promise<boolean>((resolve, reject) => {
    setTimeout(() => (answer === 'throw' ? reject(new Error('smtp down')) : resolve(answer)), ms);
  }));
  return { enabled: true, sendRaw } as never;
}

describe('overlapping sends of one sender under the daily limit', () => {
  it('ten concurrent sends under perDay 3 deliver three mails and answer limit seven times', async () => {
    const email = slowService(true);
    const limit = { key: `alice@n burst-${Math.random()}`, perDay: 3 };
    const answers = await Promise.all(Array.from({ length: 10 }, () => sendMail(email, { kind: 'owner', account: proven, limit }, html)));
    expect(answers.filter(a => a === 'sent')).toHaveLength(3);
    expect(answers.filter(a => a === 'limit')).toHaveLength(7);
    expect(email.sendRaw).toHaveBeenCalledTimes(3);
  });

  it('usage: sequential sends under perDay 3 answer sent three times and limit the fourth', async () => {
    const email = slowService(true, 1);
    const limit = { key: `alice@n seq-${Math.random()}`, perDay: 3 };
    for (let i = 0; i < 3; i++) expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('sent');
    expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('limit');
  });

  it('usage: perDay 0 sends every concurrent mail', async () => {
    const email = slowService(true);
    const limit = { key: `alice@n nolimit-${Math.random()}`, perDay: 0 };
    const answers = await Promise.all(Array.from({ length: 6 }, () => sendMail(email, { kind: 'owner', account: proven, limit }, html)));
    expect(answers.every(a => a === 'sent')).toBe(true);
  });

  it('a delivery that answers false or throws gives its slot back', async () => {
    const limit = { key: `alice@n fail-${Math.random()}`, perDay: 1 };
    expect(await sendMail(slowService(false), { kind: 'owner', account: proven, limit }, html)).toBe('failed');
    expect(senderLimitReached(limit)).toBe(false);
    await expect(sendMail(slowService('throw'), { kind: 'owner', account: proven, limit }, html)).rejects.toThrow('smtp down');
    expect(senderLimitReached(limit)).toBe(false);
    expect(await sendMail(slowService(true), { kind: 'owner', account: proven, limit }, html)).toBe('sent');
    expect(senderLimitReached(limit)).toBe(true);
  });

  it('while a send is in flight its slot is held', async () => {
    const email = slowService(true, 50);
    const limit = { key: `alice@n inflight-${Math.random()}`, perDay: 1 };
    const first = sendMail(email, { kind: 'owner', account: proven, limit }, html);
    expect(senderLimitReached(limit)).toBe(true);
    expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('limit');
    expect(await first).toBe('sent');
  });
});
