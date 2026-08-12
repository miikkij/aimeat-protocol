/**
 * @file e2e-ai-provenance-surfaces.ts
 * @description E2E for provenance PROPAGATION (TARGET-058 Phase 2): the same record, read four
 *   different ways, plus the serve-time HTML marks.
 *
 *   THE CRITERION THIS SUITE EXISTS FOR. One item — a published app — is fetched through the REST
 *   envelope, the markdown agent face, the WebMCP listing and the MCP tool result, and all four must
 *   carry the SAME provenance record id. A surface that silently drops it is the failure mode the
 *   whole phase is guarding against, and only reading all four at once catches it.
 *
 *   SERVE-TIME ONLY. The inline (runnable) HTML carries the `ai-disclosure` attribute, the meta tag,
 *   the link to the record and the schema.org JSON-LD; the raw download must be BYTE-IDENTICAL to
 *   what was uploaded. Marks that leak into the stored bundle would change the bytes the content
 *   hash is a statement about — and this codebase has published from a served copy before.
 * @structure owner + agent setup · agent publishes an app · four fetches · serve-time HTML
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-provenance-surfaces
 * @version-history
 *   v1.2.0 — 2026-08-12 — The viewport half of the top-layer test now asserts the rule instead of
 *     one spelling of the CSS. It had been failing since the mobile presentation changed on
 *     2026-08-03 (ai-provenance-marks.ts v1.5.0, which updated the golden fixture but not this
 *     suite): a substring regex hunting for a rule that hides the details link alone also matched
 *     the rule that collapses the text and the link together behind a tap. The assertions now read
 *     the label's stylesheet as rules — the mark is never hidden, anything collapsed has a state
 *     that restores it, the toggle stays keyboard-reachable — and the browser numbers behind them
 *     are in the comment beside them.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 3: the VISIBLE label on the inline serve (official EU
 *     icon in both theme variants, lockup proportions, aria-label, Accept-Language), and the
 *     stored-bundle assertion extended to prove the chip does not leak into the author's bytes either.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 2.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/**
 * `selector{declarations}` pairs from a stylesheet, each tagged with the at-rule it sits inside.
 *
 * The visible label's CSS is one long string built in services/ai-provenance-marks.ts, and matching
 * it with a substring regex is what let this suite rot: a pattern hunting for a rule that hides ONLY
 * the details link also matched `#aimeat-ai-label b,#aimeat-ai-label a{display:none}`, which hides
 * the link together with the text and is a different statement. Selectors and declarations in that
 * stylesheet carry no braces of their own, so this small scanner is exact where the regex was not.
 *
 * Deliberately not a CSS parser: it splits a selector list on commas, which would be wrong inside
 * `:is(a,b)`. The sheet it reads has no such selector, and a test that needs one should stop reading
 * CSS and measure a browser instead.
 */
function cssRules(sheet: string): { at: string; selectors: string[]; decls: string }[] {
    const rules: { at: string; selectors: string[]; decls: string }[] = [];
    let at = '';
    let i = 0;
    while (i < sheet.length) {
        const open = sheet.indexOf('{', i);
        if (open < 0) break;
        const head = sheet.slice(i, open).trim();
        if (head.startsWith('@')) { at = head; i = open + 1; continue; }
        const close = sheet.indexOf('}', open);
        if (close < 0) break;
        rules.push({ at, selectors: head.split(',').map((s) => s.trim()).filter(Boolean), decls: sheet.slice(open + 1, close) });
        i = close + 1;
        // A `}` here closes the at-rule the last rule sat in.
        while (i < sheet.length && (sheet[i] === '}' || sheet[i] === ' ' || sheet[i] === '\n')) {
            if (sheet[i] === '}') at = '';
            i++;
        }
    }
    return rules;
}

/** The label's own scoped stylesheet, taken from the served document rather than from the source. */
function labelStylesheet(html: string): string {
    const m = /<div id="aimeat-ai-label"[^>]*><style>([\s\S]*?)<\/style>/.exec(html);
    assert(!!m, 'the visible label carries no scoped stylesheet');
    return m![1];
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Server-sent-event framing is what /v1/mcp answers with when the client accepts it. */
function parseSSE(text: string): any[] {
    const out: any[] = [];
    const NL = String.fromCharCode(10);
    for (const evt of text.split(NL + NL)) {
        let data = '';
        for (const line of evt.trim().split(NL)) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
    }
    return out;
}

/** One MCP tool call on a fresh session, authenticated with the agent's own bearer token. */
async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
    let sessionId = '';
    let id = 1;
    const rpc = async (method: string, params: Record<string, unknown>) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
        return await res.json() as any;
    };
    await rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'Provenance surfaces E2E', version: '1.0.0' },
    });
    return await rpc('tools/call', { name, arguments: args });
}

async function setupOwner(label: string) {
    const name = `surf${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Surf', password: 'Provenance1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Surf', password: 'Provenance1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

/** A minimal single-file app. Deliberately contains a literal `</body>` inside its own script —
 *  the injector must not land inside app JavaScript, which has broken a live app before. */
const APP_HTML = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Provenance surface test</title></head>',
    '<body>',
    '<h1>Surface test</h1>',
    '<script>const trap = "</" + "body>"; console.log(trap);</script>',
    '</body>',
    '</html>',
].join('\n');

(async () => {
    console.log('\n── AI Provenance surfaces (TARGET-058 Phase 2) ──');

    const o = await setupOwner('o');
    const agent = await connectAgent(o.token, o.name, `surfpub${Date.now()}`, ['memory:read', 'memory:write', 'apps:write']);
    const filename = `provsurface${Date.now()}.html`;

    let appProvId = '';

    await test('An AGENT publishing an app with no declaration gets it stamped (Mint-3)', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({
                filename, mime_type: 'text/html',
                content: Buffer.from(APP_HTML, 'utf-8').toString('base64'),
                name: 'Provenance surface test', description: 'Reads four ways.',
            }),
        });
        assert(r.status === 200 || r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);

        const versions = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}/versions`);
        assert(versions.status === 200, `versions ${versions.status}`);
        appProvId = versions.body.meta?.provenance?.id;
        assert(!!appProvId, `no provenance on the app an agent published: ${JSON.stringify(versions.body.meta)}`);
        const rec = versions.body.meta.provenance.record;
        assert(rec.level === 'ai-generated' && rec.humanInvolvement === 'none', `level/involvement ${rec.level}/${rec.humanInvolvement}`);
        assert(rec.attestation.stampedBy === 'node' && rec.attestation.observed === false,
            'a Mint-3 stamp is the node inferring, not the node witnessing');
    });

    // ── THE criterion: one item, four fetches, one record id ──

    await test('1/4 — the REST envelope carries it in meta.provenance', async () => {
        const r = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}/versions`);
        assert(r.body.meta?.provenance?.id === appProvId, `envelope: ${r.body.meta?.provenance?.id}`);
        assert(r.body.data.provenance === undefined, 'it belongs in meta, never in data');
        assert((r.headers.get('link') ?? '').includes('rel="ai-provenance"'), 'Link header absent');
    });

    await test('2/4 — the markdown agent face carries it in frontmatter AND in the body', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?format=md`);
        assert(res.status === 200, `md ${res.status}`);
        const text = await res.text();
        assert(text.startsWith('---'), 'no frontmatter block');
        assert(text.includes('ai_provenance:'), 'frontmatter carries no record');
        assert(text.includes(`/v1/provenance/${appProvId}`), `frontmatter points elsewhere`);
        // The body line is the half that survives being summarised.
        assert(text.includes('**AI provenance**'), 'no human-readable line in the body');
        assert((res.headers.get('ai-disclosure') ?? '').includes('mode='), 'AI-Disclosure header absent');
    });

    await test('3/4 — the WebMCP listing carries it', async () => {
        const r = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}/webmcp`);
        assert(r.status === 200, `webmcp ${r.status}`);
        assert(r.body.ai_provenance?.spec === 'aimeat.provenance/v1', `webmcp record: ${JSON.stringify(r.body.ai_provenance)}`);
        assert(r.body.ai_provenance_url.endsWith(`/v1/provenance/${appProvId}`), `webmcp url ${r.body.ai_provenance_url}`);
    });

    await test('4/4 — the MCP tool result carries it', async () => {
        const r = await mcpCall(agent.token, 'aimeat_app_get', { owner: o.name, filename });
        const payload = JSON.parse(r.result.content[0].text);
        assert(payload.ai_provenance?.spec === 'aimeat.provenance/v1',
            `MCP result carries no record: ${JSON.stringify(payload.ai_provenance)}`);
        assert(payload.ai_provenance_url.endsWith(`/v1/provenance/${appProvId}`),
            `MCP points elsewhere: ${payload.ai_provenance_url}`);
    });

    await test('...and the one id all four named resolves anonymously, because the app is public', async () => {
        const r = await json(`/v1/provenance/${appProvId}`);
        assert(r.status === 200, `a published app's record must resolve anonymously: ${r.status}`);
        assert(r.body.data.provenance.spec === 'aimeat.provenance/v1', 'wrong document');
    });

    // ── Serve-time HTML marks, and the stored bundle unchanged ──

    await test('The inline HTML carries the disclosure marks', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?mode=inline`);
        assert(res.status === 200, `inline ${res.status}`);
        const html = await res.text();
        assert(/<html[^>]*\sai-disclosure="autonomous"/i.test(html), 'the ai-disclosure attribute is not on <html>');
        assert(html.includes('<meta name="ai-disclosure" content="autonomous">'), 'the meta tag is absent');
        assert(html.includes(`<link rel="ai-provenance" href="`), 'the link to the record is absent');
        assert(html.includes('application/ld+json'), 'the schema.org block is absent');
        assert(html.includes('trainedAlgorithmicMedia'), 'the JSON-LD carries no digitalSourceType');
        // The injector must not have landed inside the app's own JavaScript.
        assert(html.includes('const trap = "</" + "body>";'), 'the app script was corrupted by injection');
        assert((res.headers.get('ai-disclosure') ?? '').includes('mode=machine-generated'), 'header absent on the inline serve');
    });

    // ── TARGET-058 Phase 3: the VISIBLE label a person actually sees ──

    await test('The inline HTML carries the visible label, not only the machine marks', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?mode=inline`);
        const html = await res.text();
        assert(html.includes('id="aimeat-ai-label"'), 'the visible label chip is absent from the served app');
        // The official EU icon, at the right stem for an unreviewed model-written app.
        assert(html.includes('/assets/eu-ai-icons/svg/ai-generated_black.svg'),
            'the light-theme EU icon is not referenced');
        assert(html.includes('/assets/eu-ai-icons/svg/ai-generated_white.svg'),
            'the dark-theme EU icon variant is not referenced — the mark would vanish in dark mode');
        // The wide lockup must keep its own proportions; a square box distorts it.
        assert(html.includes('aspect-ratio:1789.84 / 566.93'), 'the lockup aspect ratio is not preserved');
        assert(/aria-label="[^"]+"/.test(html), 'the icon carries no aria-label');
        assert(html.includes('AI-generated'), 'the plain-language text beside the icon is absent');
        // It must not collide with the aimeat.io attribution badge, which is bottom-RIGHT.
        assert(html.includes('left:12px!important'), 'the label is not placed clear of the attribution badge');
        assert(html.includes('id="aimeat-app-badge"'), 'the attribution badge went missing');
        // And it must still not have landed inside the app's own JavaScript.
        assert(html.includes('const trap = "</" + "body>";'), 'the app script was corrupted by injection');
    });

    await test('The visible label reaches the TOP LAYER and survives every viewport', async () => {
        // A browser measurement caught this: `position:fixed` at the maximum z-index loses to an app
        // that appends its own fixed layer at the SAME z-index, because DOM order breaks the tie. The
        // Code requires placement "where no intervening overlay elements exist", and a manual popover
        // is the only mechanism that delivers it — it sits above every z-index and above a modal
        // dialog's backdrop.
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?mode=inline`);
        const html = await res.text();
        assert(html.includes('showPopover'), 'the label never enters the top layer — an app overlay will bury it');
        assert(html.includes(':popover-open'), 'the popover state has no box rules, so the UA default would centre and shrink it');
        // The attribute must NOT be in the markup: an unshown popover is display:none, so hard-coding
        // it would make the label VANISH wherever the script does not run.
        assert(!/<div id="aimeat-ai-label"[^>]*\spopover[=\s>]/.test(html),
            'a hard-coded popover attribute would hide the label whenever the script is blocked');
        // WHAT "SURVIVES EVERY VIEWPORT" MEANS, and why it is not "nothing is ever collapsed".
        // A viewport of 640px or less shows the EU icon alone, on the same 34px row as the aimeat.io
        // attribution badge, and moves the words plus the details link behind one tap (developer
        // decision 2026-08-02, after the always-expanded chip collided with an app dialog in Oma
        // talo). Measured in a browser on 2026-08-12 against this served document: at 390x844 the
        // collapsed pill is 69x34 at x=12 carrying the official 47x15 lockup, the badge button is
        // 36x36 at x=328, and the two do not overlap; one tap gives a 301x42 panel at bottom:58px
        // whose link is 114x18 and hit-tests as the topmost element, so it is clickable through the
        // toggle overlay. At 320x568, 642x800 and 1280x460 the mark is inside the viewport with no
        // overflow, and above 640px the words and the link are on screen without any tap.
        //
        // So the standing rules are: the MARK itself is never hidden at any viewport, anything
        // collapsed away has a state that brings it back, and the control that opens it is reachable
        // without a pointer.
        const rules = cssRules(labelStylesheet(html));
        const HIDDEN = /display\s*:\s*none|visibility\s*:\s*hidden/;
        const SHOWN = /display\s*:\s*(?!none)[a-z-]+/;
        for (const sel of ['#aimeat-ai-label', '#aimeat-ai-label i']) {
            const hidden = rules.filter((r) => r.selectors.includes(sel) && HIDDEN.test(r.decls));
            assert(hidden.length === 0,
                `"${sel}" is hidden ${hidden[0]?.at || 'unconditionally'} — a reader at that viewport is told nothing`);
        }
        // The details link is the interactive second layer the Code encourages. Collapsed behind a
        // tap is allowed; gone is not, and an earlier version did hide it outright below 520px.
        const linkRules = rules
            .map((r, ix) => ({ r, ix }))
            .filter(({ r }) => r.selectors.some((s) => s.startsWith('#aimeat-ai-label') && s.endsWith(' a')));
        for (const { r: hide, ix } of linkRules.filter(({ r }) => HIDDEN.test(r.decls))) {
            const restored = linkRules.some(({ r, ix: jx }) => jx > ix && r.at === hide.at && SHOWN.test(r.decls));
            assert(restored,
                `"How this was made" is hidden ${hide.at || 'unconditionally'} with no later rule that shows it again`);
        }
        // display:none would take the toggle out of the tab order and strand a keyboard reader with
        // no way to open that second layer, so it is visually hidden instead.
        const toggle = rules.filter((r) => r.selectors.includes('#aimeat-ai-label input'));
        assert(toggle.length > 0 && !toggle.some((r) => HIDDEN.test(r.decls)),
            'the expand toggle is display:none — a keyboard reader cannot reach the second layer');
        assert(html.includes('<input type="checkbox" id="aimeat-ai-label-open">')
            && /<label for="aimeat-ai-label-open"[^>]*aria-label="[^"]+"/.test(html),
            'the tap-to-expand control lost its markup, so the collapsed pill cannot be opened at all');
        // The EXPANDED panel moves off the bottom row rather than covering the attribution badge,
        // which is the other overlay element the Code asks for spacing from.
        const narrow = rules.filter((r) => r.at === '@media (max-width:640px)');
        assert(narrow.length > 0, 'the narrow-viewport rules are gone — the two marks would fight over one corner');
        assert(narrow.some((r) => r.selectors.some((s) => s.includes(':has(input:checked)')) && /bottom:58px/.test(r.decls)),
            'the expanded label sits on the attribution badge row on a narrow viewport');
    });

    await test('The visible label follows Accept-Language — the Finnish reader gets Finnish', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?mode=inline`,
            { headers: { 'Accept-Language': 'fi-FI,fi;q=0.9' } });
        const html = await res.text();
        // Numeric entities, not raw UTF-8: a published app is served without a charset parameter and
        // usually declares none of its own, so raw bytes would render as "TekoÃ¤lyn tuottama".
        assert(html.includes('Teko&#228;lyn tuottama'), 'the Finnish label text is absent for a Finnish reader');
        assert(html.includes('Miten t&#228;m&#228; on tehty'), 'the Finnish "how this was made" link text is absent');
        assert(!/Tekoälyn/.test(html), 'the Finnish text is raw UTF-8 — it will mojibake in a charset-less app document');
    });

    await test('...and the STORED bundle is byte-identical to what was uploaded', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}`);
        assert(res.status === 200, `download ${res.status}`);
        const raw = Buffer.from(await res.arrayBuffer());
        assert(raw.equals(Buffer.from(APP_HTML, 'utf-8')),
            'the served marks reached the stored bundle — the content hash now describes bytes nobody uploaded');
        assert(!raw.toString('utf-8').includes('ai-disclosure'), 'a disclosure mark is in the stored bytes');
        assert(!raw.toString('utf-8').includes('aimeat-ai-label'), 'the visible label reached the stored bytes');
    });

    await test('The record was minted about the STORED bytes, not the served ones', async () => {
        const hash = `sha256:${createHash('sha256').update(APP_HTML).digest('hex')}`;
        const r = await json(`/v1/provenance/by-hash/${hash.replace('sha256:', '')}`);
        assert(r.status === 200, `by-hash ${r.status}`);
        assert(r.body.data.records.some((x: any) => x.id === appProvId),
            'a third party hashing the downloaded file cannot find the record this node minted');
    });

    // ── Parking the app un-publishes its record: visibility follows the content, for apps too ──

    await test('Parking the app takes its record back to the identical 404', async () => {
        const p = await json(`/v1/apps/${encodeURIComponent(filename)}`, {
            method: 'PATCH', headers: auth(o.token), body: JSON.stringify({ parked: true }),
        });
        assert(p.status === 200, `park ${p.status}: ${JSON.stringify(p.body?.error)}`);
        const anon = await json(`/v1/provenance/${appProvId}`);
        const missing = await json('/v1/provenance/00000000-0000-4000-8000-000000000000');
        assert(anon.status === 404, `a parked app's record still resolves: ${anon.status}`);
        assert(anon.body.error.message === missing.body.error.message, 'the 404s differ');
    });

    // ── The FIFTH carrier: the browser library published apps actually read through ──
    //
    // The four fetches above all prove the node SERVES the record. None of them proves an app can
    // GET it, and that is a different question with its own answer: every read in aimeat-data.js
    // ended in `res.data`, and the node puts provenance on `meta`. So the statement was served
    // correctly and thrown away at the last hop, on the one path a published app uses. An app could
    // render model-written content and have no way to say so, however carefully the writing agent
    // had declared it. Exactly the loss the connector had (ai-provenance-carry.ts v1.1.0).

    const noteKey = `prov.note.${Date.now()}`;
    let noteProvId = '';

    await test('An agent writing PUBLIC memory gets it stamped, and the envelope carries the record', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({ key: noteKey, value: 'Kirjoitettu mallilla.', visibility: 'public' }),
        });
        assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);
        const r = await json(`/v1/memory/${encodeURIComponent(agent.gaii)}/${encodeURIComponent(noteKey)}`);
        assert(r.status === 200, `public read ${r.status}`);
        noteProvId = r.body.meta?.provenance?.id;
        assert(!!noteProvId, `the public read envelope carries no provenance: ${JSON.stringify(r.body.meta)}`);
    });

    await test('aimeat-data getPublicEntry() hands the record to the app; getPublic() still returns the bare value', async () => {
        // Run the LIBRARY SOURCE against the live node with the three browser globals it touches
        // (window / document.querySelector / location). check:sdk holds source and shipped bundle
        // together, so exercising the source exercises what apps load.
        const g = globalThis as unknown as Record<string, unknown>;
        const saved = { window: g.window, document: g.document, location: g.location };
        g.window = { __AIMEAT_SDK_CFG__: { nodeId: NODE_ID, baseUrl: BASE } };
        g.document = { querySelector: () => null };
        g.location = { protocol: 'file:', origin: BASE };
        try {
            const mod = await import(`../src/static/sdk-libs/data/index.js?t=${Date.now()}`);
            void mod;
            const api = (g.window as { AIMEAT?: { data?: any } }).AIMEAT?.data;
            assert(!!api?.getPublicEntry, 'the library exposes no getPublicEntry — an app cannot reach the record');

            const bare = await api.getPublic(agent.gaii, noteKey);
            assert(bare === 'Kirjoitettu mallilla.',
                `getPublic must keep returning the bare value (every published app depends on it), got ${JSON.stringify(bare)}`);

            const entry = await api.getPublicEntry(agent.gaii, noteKey);
            assert(entry?.value === 'Kirjoitettu mallilla.', 'getPublicEntry lost the value');
            assert(entry?.provenance?.id === noteProvId,
                `getPublicEntry dropped the provenance: ${JSON.stringify(entry?.provenance)}`);
            assert(entry.provenance.record.level === 'ai-generated' && entry.provenance.record.humanInvolvement === 'none',
                'the record an app receives must be the one the node served');
            // `recordUrl`, camelCase: this is the ENVELOPE carrier (ServedProvenance), not the
            // per-item `ai_provenance` DTO whose keys are snake_case. Two carriers, two
            // conventions, and an app that guesses gets undefined — so the assertion pins it.
            assert(typeof entry.provenance.recordUrl === 'string' && entry.provenance.recordUrl.includes('/v1/provenance/'),
                `an app must be able to link out to the addressable record, got ${JSON.stringify(entry.provenance.recordUrl)}`);
        } finally {
            g.window = saved.window; g.document = saved.document; g.location = saved.location;
        }
    });

    await test('...and the SHIPPED bundle carries it too, not just the source', async () => {
        const res = await fetch(`${BASE}/v1/libs/aimeat-data.js`);
        assert(res.ok, `served lib ${res.status}`);
        const text = await res.text();
        assert(text.includes('getPublicEntry'), 'the served bundle predates the source — run pnpm build:sdk');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
