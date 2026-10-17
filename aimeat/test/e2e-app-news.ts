/**
 * @file e2e-app-news.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: the app-info mark on a served app, the app's news, the draft notice and the app's
 *   live stream (wish-p-ivitysmerkki-ja-tietomerkki-sovelluksen-p-lle-merkkien-pii, 2026-10-18).
 *
 *   What it proves:
 *     - a served app carries the app-info mark with its live version, in the visitor's language,
 *       and the owner's switches take it off (marks.info) and start the row tucked (marks.tucked);
 *     - GET .../news answers anyone the version and the latest roadmap lines, and the draft only to
 *       a builder: the owner, and a person while they hold a development right (not before, not
 *       after it is taken back), never a stranger;
 *     - a draft notice longer than one sentence is refused, an empty one clears it, and promoting
 *       the draft without a roadmap line makes the notice that line;
 *     - every stream opens with the build; a visitor's app stream hears a new version and never a
 *       draft, a builder's hears the draft; an app behind an access code gives a visitor no ticket;
 *     - another account cannot write the owner's draft notice (403);
 *     - a served copy published back is stored without the mark.
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @version-history
 *   v1.0.0 -- 2026-10-18 -- Initial.
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 100000;
const ownerName = `newsa${stamp}`;
const builderName = `newsb${stamp}`;
const strangerName = `newsc${stamp}`;
const FILE = 'news-app.html';
const GATED_FILE = 'news-gated.html';
const APP = `${ownerName}/${FILE}`;
const MARK = 'id="aimeat-app-info"';
const NOTICE = 'The score board fits a phone.';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const HTML = (n: number) => `<!DOCTYPE html><html><head><title>News</title></head><body><h1>news app ${n}</h1></body></html>`;
let ownerTok = '';
let builderTok = '';
let strangerTok = '';
const auth = (tok: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tok}` } });

async function served(lang = 'en'): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILE}?mode=inline`, { headers: { 'Accept-Language': lang } });
    assert(res.status === 200, `inline serve status ${res.status}`);
    return res.text();
}

/** The app-info mark's data block as the script reads it. */
function markData(html: string): any {
    const m = html.match(/<script type="application\/json" id="aimeat-app-info-data">([^<]*)<\/script>/);
    assert(!!m, 'no app-info data block');
    return JSON.parse(m![1]);
}

async function news(tok?: string) {
    return json(`/v1/apps/${ownerName}/${FILE}/news`, tok ? auth(tok) : {});
}

async function publish(file: string, html: string, extra: Record<string, unknown> = {}) {
    const r = await json('/v1/apps', auth(ownerTok, {
        method: 'POST',
        body: JSON.stringify({ filename: file, content: b64(html), name: 'News App', description: 'an app with news', category: 'utility', ...extra }),
    }));
    assert(r.status === 201 || r.status === 200, `publish ${file} ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
}

async function saveDraft(tok: string, body: Record<string, unknown>) {
    return json(`/v1/apps/${ownerName}/${FILE}/draft`, auth(tok, { method: 'PUT', body: JSON.stringify({ content: b64(HTML(99)), ...body }) }));
}

/** Open a stream with a ticket, run `act`, and collect the frames that arrive within `ms`. */
async function streamWhile(ticketPath: string, tok: string | null, act: () => Promise<void>, ms = 2500): Promise<string[]> {
    const t = await json(ticketPath, { method: 'POST', body: JSON.stringify({ app: APP }), ...(tok ? auth(tok) : {}) });
    assert(t.status === 200, `ticket ${ticketPath} ${t.status}: ${JSON.stringify(t.body)}`);
    const ac = new AbortController();
    const res = await fetch(`${BASE}/v1/events?ticket=${encodeURIComponent(t.body.data.ticket)}`, { signal: ac.signal });
    assert(res.status === 200, `stream status ${res.status}`);
    const frames: string[] = [];
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const reading = (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) return;
                for (const block of dec.decode(value).split('\n\n')) if (block.trim() && !block.startsWith(':')) frames.push(block);
            }
        } catch { /* aborted at the end of the window */ }
    })();
    await new Promise((r) => setTimeout(r, 300));
    await act();
    await new Promise((r) => setTimeout(r, ms));
    ac.abort();
    await reading;
    return frames;
}

console.log('\n=== App news, draft notice and app stream E2E ===\n');

await test('Setup: three owners, a public app and a gated one', async () => {
    ownerTok = (await registerOwner(BASE, ownerName)).token;
    builderTok = (await registerOwner(BASE, builderName)).token;
    strangerTok = (await registerOwner(BASE, strangerName)).token;
    await publish(FILE, HTML(1));
    await publish(GATED_FILE, HTML(1), { access_code: 'open-sesame-42' });
});

await test('The served app carries the app-info mark with its version, in the visitor\'s language', async () => {
    const en = await served('en');
    assert(en.includes(MARK), 'no app-info mark');
    assert(en.includes('/js/app-news.js'), 'the mark does not load its script');
    const d = markData(en);
    assert(d.app === APP && d.v === 1 && d.tucked === false, `data ${JSON.stringify(d)}`);
    assert(String(d.more).endsWith(`/v1/appcat?app=${encodeURIComponent(APP)}`), `the catalogue link does not name the app: ${d.more}`);
    const fi = await served('fi');
    assert(fi.includes('Tietoa sovelluksesta'), 'the Finnish words are missing');
});

await test('The owner\'s switches: marks.tucked starts the row tucked, marks.info takes the mark off', async () => {
    const t = await json(`/v1/apps/${FILE}`, auth(ownerTok, { method: 'PATCH', body: JSON.stringify({ marks: { tucked: true } }) }));
    assert(t.status === 200, `PATCH tucked ${t.status}: ${JSON.stringify(t.body)}`);
    assert(markData(await served()).tucked === true, 'the row does not start tucked');
    const off = await json(`/v1/apps/${FILE}`, auth(ownerTok, { method: 'PATCH', body: JSON.stringify({ marks: { info: false } }) }));
    assert(off.status === 200, `PATCH info ${off.status}`);
    assert(!(await served()).includes(MARK), 'the mark is still served after the owner switched it off');
    const back = await json(`/v1/apps/${FILE}`, auth(ownerTok, { method: 'PATCH', body: JSON.stringify({ marks: { info: true, tucked: false } }) }));
    assert(back.status === 200 && (await served()).includes(MARK), 'the mark did not come back');
    const bad = await json(`/v1/apps/${FILE}`, auth(ownerTok, { method: 'PATCH', body: JSON.stringify({ marks: { tucked: 'yes' } }) }));
    assert(bad.status === 400, `a non-boolean switch answered ${bad.status}`);
});

await test('A notice longer than one sentence is refused before anything is written', async () => {
    const r = await saveDraft(ownerTok, { notice: 'x'.repeat(281) });
    assert(r.status === 400, `long notice answered ${r.status}`);
    const n = await news(ownerTok);
    assert(n.body.data.draft === null, `a draft was written: ${JSON.stringify(n.body.data.draft)}`);
});

await test('The news: anyone gets the version, only a builder gets the draft', async () => {
    const saved = await saveDraft(ownerTok, { notice: NOTICE });
    assert(saved.status === 200, `draft ${saved.status}: ${JSON.stringify(saved.body)}`);
    const anon = await news();
    assert(anon.status === 200 && anon.body.data.version === 1, `anon ${anon.status}`);
    assert(!('draft' in anon.body.data) && anon.body.data.builder === false, 'a visitor got the draft');
    const own = await news(ownerTok);
    assert(own.body.data.builder === true, 'the owner is not a builder');
    assert(own.body.data.draft?.notice?.text === NOTICE && own.body.data.draft.notice.by === ownerName, `owner draft ${JSON.stringify(own.body.data.draft)}`);
    const stranger = await news(strangerTok);
    assert(!('draft' in stranger.body.data), 'another account got the draft');
});

await test('Another account cannot write a notice on the owner\'s draft', async () => {
    const r = await saveDraft(strangerTok, { notice: 'Written by a stranger.' });
    assert(r.status === 403 || r.status === 401, `a stranger's draft write answered ${r.status}: ${JSON.stringify(r.body)}`);
    const own = await news(ownerTok);
    assert(own.body.data.draft?.notice?.text === NOTICE, `the owner's notice changed: ${JSON.stringify(own.body.data.draft)}`);
});

await test('A development right shows the draft while it is held, and not after it is taken back', async () => {
    const before = await news(builderTok);
    assert(!('draft' in before.body.data), 'the draft showed before the right was given');
    const g = await json(`/v1/apps/${ownerName}/${FILE}/dev-grants/${builderName}`, auth(ownerTok, { method: 'PUT', body: JSON.stringify({ level: 'drafter' }) }));
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body)}`);
    const held = await news(builderTok);
    assert(held.body.data.builder === true && held.body.data.draft?.notice?.text === NOTICE, `with the right ${JSON.stringify(held.body.data)}`);
    const d = await json(`/v1/apps/${ownerName}/${FILE}/dev-grants/${builderName}`, auth(ownerTok, { method: 'DELETE' }));
    assert(d.status === 200, `revoke ${d.status}`);
    const after = await news(builderTok);
    assert(!('draft' in after.body.data), 'the draft still showed after the right was taken back');
});

await test('Every stream opens with the build; a visitor hears a new version and never a draft', async () => {
    const frames = await streamWhile('/v1/events/visitor-ticket', null, async () => {
        const d = await saveDraft(ownerTok, {});
        assert(d.status === 200, `draft ${d.status}`);
        await publish(FILE, HTML(2), { roadmap: 'The heading says two.' });
    });
    assert(frames.some((f) => f.startsWith('event: hello') && f.includes('"build"')), `no hello: ${JSON.stringify(frames)}`);
    assert(frames.some((f) => f.startsWith('event: app') && f.includes('"kind":"version"') && f.includes('"version":2')), `no version event: ${JSON.stringify(frames)}`);
    assert(!frames.some((f) => f.includes('"kind":"draft"')), `a visitor heard the draft: ${JSON.stringify(frames)}`);
    assert(!frames.some((f) => f.startsWith('data: {"domains"')), 'a visitor stream carried a domain frame');
});

await test('The owner\'s app stream hears the draft', async () => {
    const frames = await streamWhile('/v1/events/ticket', ownerTok, async () => {
        const d = await saveDraft(ownerTok, {});
        assert(d.status === 200, `draft ${d.status}`);
    });
    assert(frames.some((f) => f.startsWith('event: app') && f.includes('"kind":"draft"')), `no draft event: ${JSON.stringify(frames)}`);
});

await test('An app behind an access code gives a visitor no ticket, and a stranger no news', async () => {
    const t = await json('/v1/events/visitor-ticket', { method: 'POST', body: JSON.stringify({ app: `${ownerName}/${GATED_FILE}` }) });
    assert(t.status === 404, `visitor ticket for a gated app answered ${t.status}`);
    const n = await json(`/v1/apps/${ownerName}/${GATED_FILE}/news`, auth(strangerTok));
    assert(n.status === 404, `news of a gated app answered a stranger ${n.status}`);
    const own = await json(`/v1/apps/${ownerName}/${GATED_FILE}/news`, auth(ownerTok));
    assert(own.status === 200, `the owner read the gated app's news: ${own.status}`);
});

await test('Promoting the draft without a roadmap line makes the notice that line; an empty notice clears', async () => {
    const s = await saveDraft(ownerTok, { notice: NOTICE });
    assert(s.status === 200, `draft ${s.status}`);
    const p = await json(`/v1/apps/${ownerName}/${FILE}/publish-draft`, auth(ownerTok, { method: 'POST', body: '{}' }));
    assert(p.status === 200 || p.status === 201, `publish-draft ${p.status}: ${JSON.stringify(p.body)}`);
    const n = await news();
    assert(n.body.data.version === 3, `version ${n.body.data.version}`);
    assert(n.body.data.changes[0]?.what === NOTICE && n.body.data.changes[0]?.version === 3, `changes ${JSON.stringify(n.body.data.changes)}`);
    const again = await saveDraft(ownerTok, { notice: NOTICE });
    assert(again.status === 200, `draft ${again.status}`);
    const cleared = await saveDraft(ownerTok, { notice: '' });
    assert(cleared.status === 200, `clear ${cleared.status}`);
    const own = await news(ownerTok);
    assert(own.body.data.draft && !own.body.data.draft.notice, `the notice was not cleared: ${JSON.stringify(own.body.data.draft)}`);
    await json(`/v1/apps/${ownerName}/${FILE}/draft`, auth(ownerTok, { method: 'DELETE' }));
});

await test('A served copy published back is stored without the app-info mark', async () => {
    const copy = await served();
    assert(copy.includes(MARK), 'the served copy has no mark to strip');
    await publish(FILE, copy, { roadmap: 'Published from a served copy.' });
    const raw = await fetch(`${BASE}/v1/apps/${ownerName}/${FILE}`, auth(ownerTok));
    assert(raw.status === 200, `raw download ${raw.status}`);
    assert(!(await raw.text()).includes(MARK), 'the stored bytes carry the mark');
});

await test('Cleanup: all three owners deleted', async () => {
    for (const [name, tok] of [[ownerName, ownerTok], [builderName, builderTok], [strangerName, strangerTok]] as const) {
        const r = await json(`/v1/owners/${encodeURIComponent(name)}`, auth(tok, { method: 'DELETE' }));
        assert(r.status === 200, `delete ${name} ${r.status}`);
    }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`App news E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
