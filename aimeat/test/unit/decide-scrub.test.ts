/**
 * @file test/unit/decide-scrub.test.ts
 * @description The decide scrubber on the shapes it will really see: a CADENCE contact record, a
 *   Finnish DM thread, a mail with a signature block, and a workspace paragraph with an IBAN and a
 *   henkilötunnus. The negatives matter as much: a date, a time, a price, a Y-tunnus, a year range,
 *   a bad IBAN checksum and a bad hetu check character must all reach the model unchanged.
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080 Module A, initial.
 */
import { describe, it, expect } from 'vitest';
import { createScrubber, PII_CLASSES } from '../../src/services/decide/scrub.js';
import { hetuValid, ibanValid } from '../../src/services/decide/scrub-detect.js';

describe('validators', () => {
  it('accepts the valid IBAN and hetu and refuses one-character changes', () => {
    expect(ibanValid('FI21 1234 5600 0007 85')).toBe(true);
    expect(ibanValid('FI21 1234 5600 0007 86')).toBe(false);
    expect(hetuValid('131052-308T')).toBe(true);
    expect(hetuValid('131052-308U')).toBe(false);
    expect(hetuValid('310252-308T')).toBe(false); // 31 February
  });
});

describe('contact record (CADENCE shape)', () => {
  const record = {
    name: 'Aino Mäkelä',
    email: 'aino.makela@overscale.fi',
    phone: '+358 40 123 4567',
    company: 'Overscale Solutions Oy',
    businessId: '3323553-5',
    address: 'Hämeentie 12 B 4, 00530 Helsinki',
    notes: 'Aino pyysi tarjousta 2026-09-19 klo 14.30. Budjetti 1 234,50 €. Soita numeroon 040-765 4321.',
  };

  it('replaces the personal fields, keeps the public ones, catches the first name in notes', () => {
    const sc = createScrubber();
    const out = sc.value(record);
    expect(out.name).toBe('[PERSON_1]');
    expect(out.email).toBe('[EMAIL_1]');
    expect(out.phone).toBe('[PHONE_1]');
    expect(out.address).toBe('[ADDRESS_1]');
    expect(out.company).toBe('Overscale Solutions Oy');
    expect(out.businessId).toBe('3323553-5');
    expect(out.notes).toContain('[PERSON_2] pyysi');
    expect(out.notes).toContain('2026-09-19');
    expect(out.notes).toContain('14.30');
    expect(out.notes).toContain('1 234,50 €');
    expect(out.notes).toContain('[PHONE_2]');
    expect(out.notes).not.toContain('765');
    expect(sc.report()).toEqual({
      removed: { email: 1, phone: 2, hetu: 0, iban: 0, address: 1, person: 2 },
      total: 6,
    });
  });

  it('learns hinted names before scrubbing, even when the mention comes first', () => {
    const sc = createScrubber();
    const out = sc.value({ summary: 'Mäkelä called twice.', contact: { full_name: 'Aino Mäkelä' } });
    expect(out.summary).toBe('[PERSON_1] called twice.');
    expect(out.contact.full_name).toBe('[PERSON_2]');
    expect(sc.restore(out.summary)).toBe('Mäkelä called twice.');
  });

  it('allow leaves a class alone, by pattern and by hint', () => {
    const sc = createScrubber({ allow: ['email', 'person'] });
    const out = sc.value(record);
    expect(out.email).toBe(record.email);
    expect(out.name).toBe(record.name);
    expect(out.phone).toBe('[PHONE_1]');
    expect(sc.report().removed.email).toBe(0);
  });
});

describe('Finnish DM thread', () => {
  const thread = [
    { from: 'jouni@aimeat.io', text: 'Moi! Onko Mattille jo lähetetty sopimus?' },
    { from: 'matti.virtanen@example.fi', text: 'Matti tässä. Sain sen, kiitos Jounille. Palaan asiaan viikolla 39.' },
    { from: 'jouni@aimeat.io', text: 'Hyvä. Virtanen, soitatko minulle 050 987 6543?' },
  ];

  it('catches first names, surnames and inflected forms of known people', () => {
    const sc = createScrubber({ knownNames: ['Matti Virtanen', 'Jouni Miikki'] });
    const out = sc.value(thread);
    const all = JSON.stringify(out);
    for (const leak of ['Matti', 'Mattille', 'Jounille', 'Virtanen', '987', 'aimeat.io', 'example.fi']) {
      expect(all).not.toContain(leak);
    }
    expect(out[1].text).toContain('viikolla 39');
    expect(out[0].from).toBe(out[2].from);
  });

  it('does not take a name that is only a common lowercase word', () => {
    const sc = createScrubber({ knownNames: ['Anna Laine'] });
    expect(sc.text('anna minulle aikaa, Anna')).toBe('anna minulle aikaa, [PERSON_1]');
  });
});

describe('mail with signature block', () => {
  const mail = [
    'Hei,',
    '',
    'kiitos tapaamisesta 19.9.2026. Liitteenä tarjous, voimassa 2020-2026 välisille sopimuksille.',
    '',
    'Ystävällisin terveisin',
    'Liisa Korhonen',
    'Myyntijohtaja, Overscale Solutions Oy (Y-tunnus 3323553-5)',
    'puh. +358 50 111 2233',
    'Mannerheimintie 5 A 7',
    '00100 Helsinki',
    'liisa.korhonen@overscale.fi',
  ].join('\n');

  it('scrubs the signature and keeps the business content', () => {
    const sc = createScrubber({ knownNames: ['Liisa Korhonen'] });
    const out = sc.text(mail);
    expect(out).toContain('[PERSON_1]');
    expect(out).toContain('[PHONE_1]');
    expect(out).toContain('[EMAIL_1]');
    expect(out).toMatch(/\[ADDRESS_\d\]/);
    expect(out).not.toContain('Mannerheimintie');
    expect(out).not.toContain('00100');
    for (const keep of ['19.9.2026', '2020-2026', '3323553-5', 'Myyntijohtaja', 'Overscale Solutions Oy']) {
      expect(out).toContain(keep);
    }
    expect(sc.restore(out)).toBe(mail);
  });

  it('English street address', () => {
    const sc = createScrubber();
    expect(sc.text('Ship to 221B Baker Street, London.')).toBe('Ship to [ADDRESS_1], London.');
  });
});

describe('workspace document paragraph', () => {
  const para =
    'Palkka maksetaan tilille FI21 1234 5600 0007 85 (henkilötunnus 131052-308T). ' +
    'Vanha tili FI21 1234 5600 0007 86 on suljettu. Viite 131052-308U ei ole tunnus. ' +
    'Maksu 1 234,50 € erääntyy 30.9.2026 klo 12:00.';

  it('replaces the valid IBAN and hetu, leaves the invalid ones and the numbers', () => {
    const sc = createScrubber();
    const out = sc.text(para);
    expect(out).toContain('tilille [IBAN_1] (henkilötunnus [HETU_1])');
    expect(out).toContain('FI21 1234 5600 0007 86');
    expect(out).toContain('131052-308U');
    expect(out).toContain('1 234,50 €');
    expect(out).toContain('30.9.2026 klo 12:00');
    expect(sc.report().total).toBe(2);
    expect(sc.restore(out)).toBe(para);
  });
});

describe('negatives', () => {
  it.each([
    '2026-09-19', '19.9.2026', '05.06.2026', '14:30', 'klo 8.15', '1 234,50 €', '0,50 €',
    'Y-tunnus 3323553-5', 'Y-tunnus 0112038-9', 'vuodet 2020-2026', 'vuonna 2026', 'tilaus 123456789',
    'FI21 1234 5600 0007 86', '131052-308U',
  ])('leaves %s alone', (s) => {
    expect(createScrubber().text(s)).toBe(s);
  });
});

describe('stability, restore and mapping', () => {
  it('gives one placeholder per distinct value across calls, case-insensitively for names and e-mail', () => {
    const sc = createScrubber({ knownNames: ['Aino Mäkelä'] });
    const a = sc.text('AINO.MAKELA@overscale.fi ja Aino Mäkelä');
    const b = sc.text('aino.makela@OVERSCALE.fi ja aino mäkelä');
    expect(a).toBe('[EMAIL_1] ja [PERSON_1]');
    expect(b).toBe(a);
    expect(sc.report().removed.person).toBe(1);
  });

  it('restores a choice option name through mapping(), leaves unknown placeholders', () => {
    const sc = createScrubber({ knownNames: ['Aino Mäkelä', 'Liisa Korhonen'] });
    const criteria = sc.value({ 'Aino Mäkelä': 'account owner', 'Liisa Korhonen': null });
    const keys = Object.keys(criteria);
    expect(keys).toEqual(['Aino Mäkelä', 'Liisa Korhonen']); // keys are field names, kept
    const opt = sc.text('Liisa Korhonen');
    expect(sc.mapping().get(opt)).toBe('Liisa Korhonen');
    expect(sc.restore(`${opt} and [PERSON_9]`)).toBe('Liisa Korhonen and [PERSON_9]');
  });

  it('report lists every class', () => {
    expect(Object.keys(createScrubber().report().removed).sort()).toEqual([...PII_CLASSES].sort());
  });
});
