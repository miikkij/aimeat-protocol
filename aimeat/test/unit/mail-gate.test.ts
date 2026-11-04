/**
 * @file test/unit/mail-gate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/mail-gate.ts sendMail, the one function every node mail goes through. Per
 *   intent kind: an owner mail goes only to a proven address (owner-mail-address.ts provenOwnerAddress)
 *   and, with a limit, at most perDay times a day per sender; a third-party mail needs the account's
 *   turn or a written reason; sign-in and operator mail go to the address the caller names. Per
 *   message form: the one EmailService method, called with the caller's arguments and nothing more,
 *   so a caller moved onto the gate sends exactly what it sent before. And the check:single-entry
 *   rule mail-send counts a direct send and not the web-push method of the same name (codebase
 *   analysis 2026-11-03, item B3).
 * @usage pnpm exec vitest run test/unit/mail-gate.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B3).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { sendMail, senderLimitReached, type MailMessage } from '../../src/services/mail-gate.js';
import { takeMailSend } from '../../src/services/account-limits.js';
import type { EmailService } from '../../src/services/email.js';
import { RULES, lineTexts } from '../../scripts/check-single-entry.js';

const ADDRESS = 'alice@example.test';
const hashOf = (a: string) => createHash('sha256').update(a.toLowerCase().trim()).digest('hex');
const proven = { notificationEmail: ADDRESS, emailVerifiedAt: '2026-11-01T00:00:00.000Z', emailHash: hashOf(ADDRESS) };
const html: MailMessage = { form: 'html', subject: 'S', html: '<p>B</p>', text: 'B' };

function service(answer = true): EmailService & Record<string, ReturnType<typeof vi.fn>> {
  const m = () => vi.fn(async () => answer);
  return {
    enabled: true,
    sendVerificationCode: m(), sendMagicLink: m(), sendNotification: m(), sendInvite: m(),
    sendKeyInvite: m(), sendKeyCredentials: m(), sendRaw: m(), sendWithAttachments: m(),
  } as never;
}

describe('a node that sends no mail', () => {
  it('answers mail_off and calls nothing', async () => {
    const email = service();
    expect(await sendMail({ ...email, enabled: false }, { kind: 'sign-in', to: ADDRESS, why: 't' }, html)).toBe('mail_off');
    expect(await sendMail(null, { kind: 'sign-in', to: ADDRESS, why: 't' }, html)).toBe('mail_off');
    expect(email.sendRaw).not.toHaveBeenCalled();
  });
});

describe('an owner mail goes only to a proven address', () => {
  it('an address nobody confirmed gets nothing', async () => {
    const email = service();
    expect(await sendMail(email, { kind: 'owner', account: { ...proven, emailVerifiedAt: null } }, html)).toBe('no_address');
    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('a flag left from an earlier address does not prove the address named now', async () => {
    const email = service();
    expect(await sendMail(email, { kind: 'owner', account: { ...proven, emailHash: hashOf('earlier@example.test') } }, html)).toBe('no_address');
    expect(await sendMail(email, { kind: 'owner', account: null }, html)).toBe('no_address');
    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('usage: a proven address gets the mail once, at that address', async () => {
    const email = service();
    expect(await sendMail(email, { kind: 'owner', account: proven }, html)).toBe('sent');
    expect(email.sendRaw).toHaveBeenCalledTimes(1);
    expect(email.sendRaw.mock.calls[0]).toEqual([ADDRESS, 'S', '<p>B</p>', 'B']);
  });

  it('usage: a flagged record without a hash is read on the flag alone, as before', async () => {
    const email = service();
    expect(await sendMail(email, { kind: 'owner', account: { notificationEmail: ADDRESS, emailVerifiedAt: proven.emailVerifiedAt } }, html)).toBe('sent');
  });
});

describe('the per-sender daily limit on an owner mail', () => {
  it('one sender mails at most perDay times; another sender still mails; a failed send is not counted', async () => {
    const email = service();
    const limit = { key: `alice@n sender-a-${Math.random()}`, perDay: 2 };
    const failing = service(false);
    expect(await sendMail(failing, { kind: 'owner', account: proven, limit }, html)).toBe('failed');
    expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('sent');
    expect(senderLimitReached(limit)).toBe(false);
    expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('sent');
    expect(senderLimitReached(limit)).toBe(true);
    expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('limit');
    expect(email.sendRaw).toHaveBeenCalledTimes(2);
    expect(await sendMail(email, { kind: 'owner', account: proven, limit: { ...limit, key: `${limit.key}-other` } }, html)).toBe('sent');
  });

  it('usage: perDay 0 means no limit', async () => {
    const email = service();
    const limit = { key: `alice@n sender-b-${Math.random()}`, perDay: 0 };
    for (let i = 0; i < 12; i++) expect(await sendMail(email, { kind: 'owner', account: proven, limit }, html)).toBe('sent');
    expect(senderLimitReached(limit)).toBe(false);
  });
});

describe('a third-party mail is counted or says why not', () => {
  it('usage: with the account turn it was given, the mail goes to the address named', async () => {
    const email = service();
    const turn = takeMailSend(`gate-test-${Math.random()}@n`);
    if (!turn.ok) throw new Error('fresh account refused');
    expect(await sendMail(email, { kind: 'third-party', to: 'bob@example.test', count: { turn } }, html)).toBe('sent');
    expect(email.sendRaw.mock.calls[0]?.[0]).toBe('bob@example.test');
  });

  it('usage: with a written reason, the mail goes as before', async () => {
    const email = service();
    expect(await sendMail(email, { kind: 'third-party', to: 'bob@example.test', count: { uncounted: 'bounded elsewhere' } }, html)).toBe('sent');
  });

  it('a refused turn is not a turn', async () => {
    const email = service();
    await expect(sendMail(email, { kind: 'third-party', to: 'bob@example.test', count: { turn: { ok: false } as never } }, html)).rejects.toThrow(/did not give/);
    expect(email.sendRaw).not.toHaveBeenCalled();
  });
});

describe('check:single-entry rule mail-send', () => {
  const rule = RULES.find(r => r.id === 'mail-send')!;
  const hits = (src: string) => lineTexts(src).filter(l => rule.pattern.test(l)).length;

  it('counts a direct call of every mail service send method', () => {
    expect(hits([
      'await email.sendRaw(to, s, h, t);',
      'await emailSvc.sendVerificationCode(to, code, locale);',
      'await mail?.sendMagicLink(to, url);',
      'await svc.sendInvite(to, args, l); await svc.sendKeyInvite(to, a); await svc.sendKeyCredentials(to, a);',
      'await services.email.sendNotification(to, s, b);',
      'await emailService!.sendNotification(to, s, b);',
      'await getActiveEmailService()?.sendNotification(to, s, b);',
      'await email.sendWithAttachments(to, s, h, t, []);',
    ].join('\n'))).toBe(8);
  });

  it('does not count the web-push method of the same name, or the gate itself', () => {
    expect(hits([
      'await pushService.sendNotification(owner, payload);',
      'void deps.pushService.sendNotification(owner, p);',
      'await services.push.sendNotification(owner, p);',
      'await this.webpush.sendNotification(sub, body);',
      'await sendMail(email, intent, message);',
    ].join('\n'))).toBe(0);
  });
});

describe('each form is its one method, called with the arguments the caller passed', () => {
  const to = 'p@example.test';
  const pdf = [{ filename: 'a.pdf', content: Buffer.from('x'), contentType: 'application/pdf' }];
  const cases: Array<[MailMessage, string, unknown[]]> = [
    [{ form: 'notification', subject: 'S', body: 'B' }, 'sendNotification', [to, 'S', 'B']],
    [{ form: 'notification', subject: 'S', body: 'B', opts: { replyTo: null } }, 'sendNotification', [to, 'S', 'B', { replyTo: null }]],
    [{ form: 'html', subject: 'S', html: 'H', text: 'T' }, 'sendRaw', [to, 'S', 'H', 'T']],
    [{ form: 'attachments', subject: 'S', html: 'H', text: 'T', attachments: pdf }, 'sendWithAttachments', [to, 'S', 'H', 'T', pdf]],
    [{ form: 'attachments', subject: 'S', html: 'H', text: 'T', attachments: [], opts: { replyTo: 'r@x.test' } }, 'sendWithAttachments', [to, 'S', 'H', 'T', [], { replyTo: 'r@x.test' }]],
    [{ form: 'verification-code', code: '123456', locale: 'fi' }, 'sendVerificationCode', [to, '123456', 'fi']],
    [{ form: 'verification-code', code: '123456', locale: undefined }, 'sendVerificationCode', [to, '123456', undefined]],
    [{ form: 'magic-link', url: 'https://n/x', locale: 'en' }, 'sendMagicLink', [to, 'https://n/x', 'en']],
    [{ form: 'invite', args: { orgName: 'O' } as never, locale: 'en' }, 'sendInvite', [to, { orgName: 'O' }, 'en']],
    [{ form: 'key-invite', args: { orgName: 'O' } as never, locale: undefined }, 'sendKeyInvite', [to, { orgName: 'O' }, undefined]],
    [{ form: 'key-credentials', args: { username: 'u' } as never, locale: 'es' }, 'sendKeyCredentials', [to, { username: 'u' }, 'es']],
  ];
  for (const [message, method, args] of cases) {
    it(`${message.form}${'opts' in message ? ' with opts' : ''} calls ${method}(${args.length} arguments)`, async () => {
      const email = service();
      expect(await sendMail(email, { kind: 'operator', to, why: 't' }, message)).toBe('sent');
      const calls = Object.entries(email).filter(([k, v]) => k !== 'enabled' && (v as ReturnType<typeof vi.fn>).mock.calls.length > 0);
      expect(calls.map(([k]) => k)).toEqual([method]);
      expect(email[method]!.mock.calls[0]).toEqual(args);
      expect(email[method]!.mock.calls[0]).toHaveLength(args.length);
    });
  }

  it('a transport that answers false is failed; an error reaches the caller', async () => {
    expect(await sendMail(service(false), { kind: 'sign-in', to, why: 't' }, html)).toBe('failed');
    const email = service();
    email.sendRaw.mockRejectedValueOnce(new Error('smtp down'));
    await expect(sendMail(email, { kind: 'sign-in', to, why: 't' }, html)).rejects.toThrow('smtp down');
  });
});
