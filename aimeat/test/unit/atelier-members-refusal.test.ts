/**
 * @file test/unit/atelier-members-refusal.test.ts
 * @description The members blocks say a node refusal in the page's language: the code is read off
 *   a thrown error or the envelope, the retry date and the wait go through the SDK's formatter
 *   (AIMEAT.fmt, stubbed here so the test proves the route rather than one locale's output), an
 *   unknown code keeps the node's sentence, and a person declined less than a week ago is told when
 *   they may ask again instead of being given a form the node refuses. Over a stub AIMEAT.iam.
 * @version-history
 *   v1.0.0 - 2026-10-02 - Initial (wish-joinrequest-shows-the-node-s-english-refusal-on-a-finnish-or).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let shared: any;
let i18n: any;
let me: any;
let requestAnswer: () => Promise<any>;
let assignAnswer: any;

const NODE_SENTENCE = 'Your request was declined. You can ask again from 2026-10-08T09:00:00.000Z.';
const RETRY_AT = '2026-10-08T09:00:00.000Z';

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const buttons = (root: any, text: string) => all(root).filter((n) => n.tagName === 'BUTTON' && n.textContent === text);
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }

/** What the iam library throws for a refused ask once it keeps the node's code and details. */
function reaskError(): Error {
  return Object.assign(new Error(NODE_SENTENCE), { code: 'REASK_TOO_SOON', details: { retryAt: RETRY_AT } });
}

async function sendAsk(): Promise<any> {
  const host = document.createElement('div');
  kit.joinRequest({ target: host, app: 'me/club.html' });
  await settle();
  part(host, 'send')[0].dispatchEvent({ type: 'click', bubbles: true });
  await settle();
  return host;
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {
    fmt: {
      dateTime: (v: string) => `DATE(${v})`,
      duration: (ms: number) => `SPAN(${ms})`,
    },
    iam: {
      me: () => me,
      init: async () => me,
      can: () => false,
      admin: async (op: string) => (op === 'state'
        ? { roles: { member: ['use'] }, requests: [{ owner: 'kim' }], seen: {}, members: [] }
        : assignAnswer),
      request: () => requestAnswer(),
      suggestRole: () => 'member',
    },
  };
  kit = await import('../../src/static/sdk-libs/atelier/members.js');
  shared = await import('../../src/static/sdk-libs/atelier/members-shared.js');
  i18n = (await import('../../src/static/sdk-libs/atelier/i18n.js')).i18n;
});
afterAll(() => restore());

beforeEach(() => {
  me = { isOwner: false, member: false, role: null, caps: [], requested: null };
  requestAnswer = async () => { throw reaskError(); };
  assignAnswer = { ok: true };
});
afterEach(() => i18n.setLang('en'));

describe('joinRequest: a refused ask in the page\'s language', () => {
  it('says REASK_TOO_SOON in Finnish, with the date through the formatter, and never the node\'s English', async () => {
    i18n.setLang('fi');
    const host = await sendAsk();
    const said = part(host, 'status')[0].textContent;
    expect(said).toContain(`Omistaja hylkäsi aiemman pyyntösi. Voit pyytää uudelleen DATE(${RETRY_AT}) alkaen.`);
    expect(said).not.toContain('Your request was declined');
  });

  it('says it in Spanish and in English the same way', async () => {
    i18n.setLang('es');
    expect(part(await sendAsk(), 'status')[0].textContent).toContain(`Puedes pedirlo de nuevo a partir del DATE(${RETRY_AT}).`);
    i18n.setLang('en');
    expect(part(await sendAsk(), 'status')[0].textContent).toContain(`You can ask again from DATE(${RETRY_AT}).`);
  });

  it('reads the code off an envelope as well as off a thrown error', async () => {
    i18n.setLang('fi');
    requestAnswer = async () => { throw { ok: false, error: { code: 'REASK_TOO_SOON', message: NODE_SENTENCE, details: { retryAt: RETRY_AT } } }; };
    expect(part(await sendAsk(), 'status')[0].textContent).toContain('Voit pyytää uudelleen');
  });

  it('keeps the node\'s sentence for a code it has no words for, and for an error with no code', async () => {
    i18n.setLang('fi');
    requestAnswer = async () => { throw Object.assign(new Error('The node is busy.'), { code: 'SOMETHING_NEW' }); };
    expect(part(await sendAsk(), 'status')[0].textContent).toContain('The node is busy.');
    requestAnswer = async () => { throw new Error(NODE_SENTENCE); };
    expect(part(await sendAsk(), 'status')[0].textContent).toContain(NODE_SENTENCE);
  });

  it('tells a person declined less than a week ago when they may ask again, and offers no form', async () => {
    i18n.setLang('fi');
    const later = new Date(Date.now() + 3 * 86400000).toISOString();
    me = { isOwner: false, member: false, role: null, caps: [], requested: { at: '2026-09-30T10:00:00Z', state: 'declined', retryAt: later } };
    const host = document.createElement('div');
    kit.joinRequest({ target: host, app: 'me/club.html' });
    await settle();
    expect(part(host, 'status')[0].textContent).toContain(`Voit pyytää uudelleen DATE(${later}) alkaen.`);
    expect(part(host, 'send')).toEqual([]);
  });

  it('offers the form again once the week has passed', async () => {
    me = { isOwner: false, member: false, role: null, caps: [], requested: { at: '2026-09-01T10:00:00Z', state: 'declined', retryAt: '2026-09-08T10:00:00Z' } };
    const host = document.createElement('div');
    kit.joinRequest({ target: host, app: 'me/club.html' });
    await settle();
    expect(part(host, 'send').length).toBe(1);
  });
});

describe('members: a refused action on the owner\'s screen', () => {
  it('says SEATS_FULL in Finnish instead of the node\'s sentence', async () => {
    i18n.setLang('fi');
    me = { isOwner: true, member: false, role: 'owner', caps: ['*'] };
    assignAnswer = { ok: false, error: { code: 'SEATS_FULL', message: 'All 3 "member" seats are taken (3 in use).' } };
    const host = document.createElement('div');
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    buttons(part(host, 'asked')[0], 'Hyväksy')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    const said = part(host, 'failure')[0].textContent;
    expect(said).toContain('Tämän roolin kaikki paikat ovat käytössä.');
    expect(said).not.toContain('seats are taken');
  });
});

describe('refusalWords', () => {
  const CODES = ['REASK_TOO_SOON', 'SEATS_FULL', 'TOO_MANY_INVITES', 'RATE_LIMITED', 'FORBIDDEN', 'ACCESS_DENIED',
    'SCOPE_DENIED', 'AUTH_REQUIRED', 'NOT_FOUND', 'INVALID_INPUT', 'OWNER_CANNOT_ASK', 'MEMBER_IS_OWNER'];

  it('has words for every code the members routes answer, in all three languages, each written apart', () => {
    for (const code of CODES) {
      i18n.setLang('en');
      const en = shared.refusalWords(code, {});
      i18n.setLang('fi');
      const fi = shared.refusalWords(code, {});
      i18n.setLang('es');
      const es = shared.refusalWords(code, {});
      expect(en, code).not.toBe('');
      expect(fi, code).not.toBe(en);
      expect(es, code).not.toBe(en);
      expect(fi, code).not.toBe(es);
      for (const s of [en, fi, es]) expect(s, code).not.toMatch(/\{[a-z]+\}/);
    }
  });

  it('gives the wait of a rate limit through the formatter, and the sentence without a date when none came', () => {
    i18n.setLang('fi');
    expect(shared.refusalWords('RATE_LIMITED', { retry_after_sec: 540 })).toBe('Liian monta yritystä lyhyessä ajassa. Yritä uudelleen SPAN(540000) kuluttua.');
    expect(shared.refusalWords('REASK_TOO_SOON', {})).toBe('Omistaja hylkäsi aiemman pyyntösi. Voit pyytää uudelleen, kun hylkäyksestä on kulunut viikko.');
  });

  it('answers nothing for a value that is not a code', () => {
    expect(shared.refusalWords(undefined)).toBe('');
    expect(shared.refusalWords('not a code')).toBe('');
    expect(shared.refusalWords('UNKNOWN_CODE')).toBe('');
  });
});

describe('refusal: a node sentence that names the field stays', () => {
  it('keeps the node\'s sentence for INVALID_INPUT and NOT_FOUND, and uses the general words only when it said nothing', () => {
    i18n.setLang('fi');
    const named = { ok: false, error: { code: 'INVALID_INPUT', message: "Field 'email' is too long" } };
    expect(shared.refusal(named)).toBe("Field 'email' is too long");
    expect(shared.refusal(Object.assign(new Error('No account named kim'), { code: 'NOT_FOUND' }))).toBe('No account named kim');
    expect(shared.refusal({ ok: false, error: { code: 'INVALID_INPUT' } })).toBe(shared.refusalWords('INVALID_INPUT', {}));
    expect(shared.refusal({ ok: false, error: { code: 'SEATS_FULL', message: 'Seats full' } })).toBe(shared.refusalWords('SEATS_FULL', {}));
  });
});
