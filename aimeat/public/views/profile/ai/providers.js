/**
 * @file public/views/profile/ai/providers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Three sections of the AI page: the providers (every provider the owner can use, a row
 *   each with what it serves, its key and whether it works; an owner's own opens to its key, its
 *   capabilities with a model each, a real test and delete; the form that adds one), the routing
 *   (which provider answers each capability, first and then the ones to fall back to, and the rules
 *   for moving on) and the model policy (open, the recommended models, or the owner's own list, and
 *   whose calls it covers). Pure render over ctx.pv (ai/use-providers.js), on the page's existing
 *   components.
 * @structure secProviders · offLines · providerRow · providerOpen · addForm · classifierOptions · classifierRow ·
 *   secRouting · secPolicy
 * @usage import { secProviders, secRouting, secPolicy } from './ai/providers.js';
 * @version-history
 *   v1.6.0 — 2026-10-02 — With "Only tested providers" on, a capability's routing row says which provider
 *     in its list the node skips until it is tested (an owner's, on, never tested: untestedIn), with Test
 *     now beside it (pv.testNow, the same test as the providers' rows). With the rule off, nothing.
 *   v1.5.0 — 2026-10-02 — The question marks that explain the routing rules, the embeddings row, the
 *     model policy, the Content Classifier and the PDF engine: ai.fallback, ai.fallback_attempts,
 *     ai.fallback_pool, ai.only_tested, ai.fallback_leaves_machine, ai.max_cost_per_call,
 *     ai.embeddings, ai.model_policy, ai.content_classifier, ai.pdf_engine (components/HelpTip.js);
 *     the rules' grey lines that the explanations now carry are gone.
 *   v1.4.0 — 2026-10-02 — The fine-tuning fields (temperature, top P, longest answer, reasoning) carry
 *     a question mark that explains each one: what it does, its range, examples (components/HelpTip.js).
 *   v1.3.1 — 2026-10-02 — Above the providers, a line for each capability that is off for a reason the
 *     person can fix here, with Test now when a test turns it on, and one for a capability whose
 *     provider failed its last test (offLines); an owner's provider with an untested or failing
 *     capability has Test now on its collapsed row, which opens it at that test and runs it.
 *   v1.3.0 — 2026-09-29 — Jouni's review: in the routing editor the Content Classifier's row has a
 *     select like the other rows (the decision model, each decision provider, the text routing, each
 *     text provider), saved with them; its status line stays under it; a daily cap of none says so.
 *   v1.2.1 — 2026-09-29 — The Content Classifier row says the fix for CLASSIFICATION_OFF_FOR_OWNER (off
 *     for the person's own content while the operator leaves it to each person); the routing rules'
 *     label stands the section space below the capability rows, so the classifier's fix line no
 *     longer reads as part of the rules.
 *   v1.2.0 — 2026-09-29 — The routing's capability rows end with the Content Classifier (classifierRow,
 *     TARGET-082 V5): on or off, decision model or text model, and the fix when it is off.
 *   v1.1.0 — 2026-09-28 — A capability's editor (capEditor): its model with the settings its kind
 *     takes, the speech voice, the transcription language, OpenRouter's PDF engine and the default
 *     fine-tuning of text, vision and files, saved together (AI roles).
 *   v1.0.0 — 2026-09-28 — Initial (System 2): the page for the providers, the routing and the model
 *     policy, on the page's existing components (Jouni: no design lab for this, the same components
 *     and the same style).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { PageSection } from '/components/PageSection.js';
import { Facts, FactLine } from '/components/Facts.js';
import { List, Row, Name, Who, Desc, Doors, Panel } from '/components/List.js';
import { Box } from '/components/Box.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Mark, Marks, Code, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Hint } from '/components/Hint.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Row as Line, Space } from '/components/Layout.js';
import { HelpLabel } from '/components/HelpTip.js';
import { x, dateWord } from './frame.js';
import { CAPS, PROVIDER_TYPES, slug, capPatchOf, testableCapOf, untestedIn } from './use-providers.js';
import { t } from '/js/i18n.js';

const msg = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);
const HEALTH_STATE = { ok: 'fine', degraded: 'attention', failing: 'danger', untested: 'off' };
const enabledCaps = (p) => CAPS.filter((c) => p.capabilities?.[c]?.enabled);
/** A Facts row name with the HelpTip of `term` after it (components/HelpTip.js). */
const named = (term, words) => html`<${HelpLabel} term=${term} label=${words}>${words}<//>`;
/** A capability's row name; the 'embed' capability carries the ai.embeddings explanation. */
const capName = (c) => (c === 'embed' ? named('ai.embeddings', x('cap.embed')) : x('cap.' + c));

/** What the row says about the key: set, missing, the node's, or none needed. */
function keyWords(p) {
  if (p.source === 'node') return x('pv.keyNode');
  if (p.auth?.type === 'none') return x('pv.keyNone');
  if (p.auth?.type === 'env') return x('pv.keyEnv');
  return p.auth?.has_key ? x('pv.keySet') : x('pv.keyMissing');
}

/** One line on whether it works: the worst health among its capabilities. */
function healthWords(p) {
  const hs = enabledCaps(p).map((c) => p.health?.[c]?.status || 'untested');
  if (!hs.length) return x('pv.noCaps');
  if (hs.includes('failing')) return x('pv.healthFailing');
  if (hs.includes('degraded')) return x('pv.healthDegraded');
  if (hs.every((s) => s === 'ok')) return x('pv.healthOk');
  return x('pv.healthUntested');
}

/* ── Providers ────────────────────────────────────────────────────────────────────────────────── */

export function secProviders(ctx, num) {
  const pv = ctx.pv;
  const count = pv.view ? x('pv.count', { own: pv.owned.length, all: pv.providers.length }) : '';
  return html`
    <${PageSection} id="ai-providers" num=${num} title=${x('pv.title')} count=${count}>
      <${Note} kind="lead">${x('pv.lead')}<//>
      ${offLines(ctx)}
      ${pv.error ? html`<${Note} kind="message" error>${pv.error}<//>` : null}
      ${!pv.view && !pv.error ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${pv.view ? html`
        <${List} cols="name-desc-who-doors" head=${[x('pv.colProvider'), x('pv.colServes'), x('pv.colKey'), '']}>
          ${pv.providers.map((p) => providerRow(ctx, p))}
        <//>
        ${pv.adding ? addForm(ctx) : html`
          <${Actions}>
            <${Loud} control disabled=${pv.owned.length >= (pv.view.limits?.max_owner_providers ?? 20)} onClick=${() => pv.setAdding(true)}>${x('pv.add')}<//>
          <//>`}
        <${Hint}>${x('pv.hint')}<//>` : null}
    <//>`;
}

/**
 * What is off, above the providers: one line per capability, with what stopped it, and Test now when
 * a test turns it on. The person is already on the page the node's `fix` sends them to, so the line
 * is the first half of that sentence (`off.<reason>`) and the button is the second.
 */
function offLines(ctx) {
  const pv = ctx.pv;
  if (!pv.off.length && !pv.failing.length) return null;
  const testNow = (p, cap) => html`<${Action} small disabled=${pv.busy === 'test'} onClick=${() => pv.testNow(p, cap)}>${x('pv.testNow')}<//>`;
  const rows = pv.off.map((o) => {
    const p = o.testProvider ? pv.find(o.testProvider.id) : null;
    const what = o.reason === 'UNTESTED' && !p ? 'off.UNTESTED_ANY' : 'off.' + o.reason;
    return {
      key: 'off-' + o.cap,
      k: x('cap.' + o.cap),
      state: 'attention',
      v: x(what, { cap: x('cap.' + o.cap), provider: p ? p.title : '' }),
      actions: p ? testNow(p, o.testProvider.capability) : null,
    };
  }).concat(pv.failing.map((f) => ({
    key: 'failing-' + f.cap,
    k: x('cap.' + f.cap),
    state: 'danger',
    v: x('off.FAILING', { provider: f.provider.title }),
    actions: testNow(f.provider, f.cap),
  })));
  return html`<${Space} below="medium"><${Note} kind="state" tone="attention">${x('pv.offLead')}<//><${Facts} rows=${rows} /><//>`;
}

function providerRow(ctx, p) {
  const pv = ctx.pv;
  const open = pv.openId === p.id;
  const own = p.source === 'owner';
  const caps = enabledCaps(p);
  // Test now on the collapsed row only: an opened row has its own test at the foot of the panel.
  const testable = open ? null : testableCapOf(p);
  const meta = [x('ptype.' + p.type), own ? '' : x('pv.fromNode')].filter(Boolean).join(' · ');
  return html`
    <${Row} key=${p.id} open=${open} id=${'ai-provider-' + p.id}>
      <${Name} meta=${meta} warn=${!!p.problem}>${p.title}<//>
      <${Desc} sub=${p.problem || p.data_statement || ''}>${caps.length ? caps.map((c) => x('cap.' + c)).join(' · ') : x('pv.noCaps')}<//>
      <${Who} sub=${healthWords(p)} warn=${own && p.auth?.type === 'key' && !p.auth?.has_key}>${keyWords(p)}<//>
      <${Doors}>
        ${testable ? html`<${Action} small row disabled=${pv.busy === 'test'} onClick=${() => pv.testNow(p, testable)}>${x('pv.testNow')}<//>` : null}
        ${own ? html`<${Action} small row onClick=${() => pv.toggle(p.id)}>${open ? x('close') : x('change')}<//>` : null}
      <//>
      ${open && own ? providerOpen(ctx, p) : null}
    <//>`;
}

function providerOpen(ctx, p) {
  const pv = ctx.pv;
  const serves = p.type === 'extension' && p.extension_provider
    ? CAPS.filter((c) => opServes(p.extension_provider.ops, c))
    : PROVIDER_TYPES[p.type] || [];
  const on = enabledCaps(p);
  const rows = [];
  if (p.auth?.type === 'key') {
    rows.push({
      k: x('keyLabel'),
      v: html`<${TextField} box unmanaged value=${pv.keyDraft} placeholder=${p.auth.has_key ? x('keyMasked') : x('pv.keyPlaceholder')} ariaLabel=${x('keyLabel')}
        onInput=${(v) => pv.setKeyDraft(v)}
        actions=${html`<${Action} small disabled=${pv.busy === 'key'} onClick=${() => pv.saveKey(p.id)}>${x('save')}<//>`} />`,
      sub: p.auth.has_key ? x('pv.keyStoredHint') : x('pv.keyHint'),
      actions: p.auth.has_key ? html`<${Action} small soft tone="danger" onClick=${() => pv.removeKey(p.id)}>${x('pv.removeKey')}<//>` : null,
    });
  }
  for (const c of serves) {
    const cfg = p.capabilities?.[c];
    const hl = p.health?.[c];
    const status = cfg?.enabled ? (hl?.status || 'untested') : null;
    const retiring = cfg?.model_status === 'retiring' || cfg?.model_status === 'retired';
    const sub = [
      status ? x('health.' + status) + (hl?.lastOkAt ? ` · ${x('pv.lastOk', { date: dateWord(hl.lastOkAt) })}` : '') : x('pv.capOff'),
      hl?.lastError && status !== 'ok' ? hl.lastError.message : '',
      retiring ? x('pv.modelRetiring', { date: cfg.model_retires_at ? dateWord(cfg.model_retires_at) : '' }) : '',
    ].filter(Boolean).join(' · ');
    rows.push({
      key: 'cap-' + c,
      k: capName(c),
      state: status ? HEALTH_STATE[status] : 'off',
      v: html`
        <${Line} wrap gap="medium">
          <${Check} inline checked=${!!cfg?.enabled} disabled=${pv.busy === 'cap'} onChange=${(v) => pv.saveCap(p, c, { enabled: v })}>${x('pv.capInUse')}<//>
        <//>
        ${cfg?.enabled ? capEditor(pv, p, c) : null}`,
      sub,
    });
  }
  if (p.type === 'extension') {
    rows.push({
      k: x('pv.extension'),
      v: html`<${Code}>${p.extension}<//>${p.extension_provider ? html` · ${x('pv.extHosts', { hosts: (p.extension_provider.hosts || []).join(', ') })}` : ''}`,
      sub: x('pv.extKeyHint'),
    });
  }
  rows.push({
    k: x('pv.test'),
    v: html`
      <${Line} wrap gap="medium">
        <${Select} fit ariaLabel=${x('pv.testCap')} value=${pv.testCap} onChange=${(v) => pv.setTestCap(v)}
          options=${(on.length ? on : ['text']).map((c) => [c, x('cap.' + c)])} />
        <${Action} small disabled=${pv.busy === 'test' || !on.length} onClick=${() => pv.test(p)}>${pv.busy === 'test' ? x('testing') : x('pv.testRun')}<//>
      <//>`,
    sub: x('pv.testHint'),
  });
  const doors = html`
    <${Action} small soft tone="danger" onClick=${() => pv.remove(p)}>${x('pv.delete')}<//>
    <${Action} small soft onClick=${() => pv.toggle(p.id)}>${x('close')}<//>`;
  return html`
    <${Panel} doors=${doors}>
      ${p.data_statement ? html`<${Note} kind="lead">${p.data_statement}<//>` : null}
      <${Facts} rows=${rows} />
      ${msg(pv.msg)}
    <//>`;
}

const STT_LANGS = ['', 'fi', 'en', 'sv', 'de', 'fr', 'es', 'et'];

/**
 * One capability's editor: its model, and the settings its kind takes (the speech voice, the
 * transcription language, OpenRouter's PDF engine, the default fine-tuning of text, vision and files),
 * saved together.
 */
function capEditor(pv, p, c) {
  const d = pv.modelDraft[c] || {};
  const set = (patch) => pv.setModelDraft(c, patch);
  const tuning = c === 'text' || c === 'vision' || c === 'files';
  const num = (key, min, max, step) => html`
    <${TextField} label=${x('param.' + key)} help=${'ai.' + key} type="number" size="short" min=${min} max=${max} step=${step} value=${d[key] ?? ''} placeholder=${x('default')} onInput=${(v) => set({ [key]: v })} />`;
  return html`
    <${Line} wrap gap="small">
      <${TextField} value=${d.model ?? ''} placeholder=${x('pv.modelPlaceholder')} ariaLabel=${x('pv.modelFor', { cap: x('cap.' + c) })} onInput=${(v) => set({ model: v })} />
      ${c === 'speech' ? html`<${TextField} value=${d.voice ?? ''} placeholder=${x('pv.voicePlaceholder')} ariaLabel=${x('pv.voice')} onInput=${(v) => set({ voice: v })} />` : null}
      ${c === 'transcription' ? html`<${Select} fit ariaLabel=${x('pv.language')} value=${d.language ?? ''} onChange=${(v) => set({ language: v })}
          options=${STT_LANGS.map((code) => [code, code ? t('profile.openrouter.stt.lang_' + code) : x('sttLangDetect')])} />` : null}
      ${c === 'files' && p.type === 'openrouter' ? html`<${Select} fit label=${x('pv.parser')} help="ai.pdf_engine" value=${d.parser ?? ''} onChange=${(v) => set({ parser: v })}
          options=${[['', x('pv.parserNone')], ['native', x('pv.parserNative')], ['mistral-ocr', 'Mistral OCR'], ['cloudflare-ai', 'Cloudflare AI']]} />` : null}
    <//>
    ${tuning ? html`
      <${Note} kind="meta">${x('pv.tuning')}<//>
      <${Line} wrap gap="medium">
        ${num('temperature', 0, 2, 0.1)}${num('top_p', 0, 1, 0.05)}${num('max_tokens', 1, 1000000, 256)}
        <${Select} fit label=${x('param.reasoning')} help="ai.reasoning" value=${d.reasoning ?? ''} onChange=${(v) => set({ reasoning: v })}
          options=${['', 'off', 'low', 'medium', 'high'].map((k) => [k, x('reasoning.' + (k || 'default'))])} />
      <//>` : null}
    <${Actions}><${Action} small disabled=${pv.busy === 'cap'} onClick=${() => pv.saveCap(p, c, capPatchOf(c, d, p.type))}>${x('save')}<//><//>`;
}

/** Whether an extension's declared ops serve a capability (services/ai/extension-provider.ts CAPABILITY_OP). */
function opServes(ops, c) {
  const op = { text: 'text', vision: 'text', files: 'text', image: 'image', speech: 'speak', transcription: 'transcribe', embed: 'embed' }[c];
  return (ops || []).includes(op);
}

function addForm(ctx) {
  const pv = ctx.pv;
  const d = pv.draft;
  const needsUrl = d.type === 'local' || d.type === 'openai-compatible';
  const id = slug(d.title || (d.type === 'extension' ? d.extension : d.type));
  const rows = [
    { k: x('pv.type'), v: html`<${Select} fit ariaLabel=${x('pv.type')} value=${d.type} onChange=${(v) => pv.setDraft({ type: v })}
        options=${Object.keys(PROVIDER_TYPES).map((tp) => [tp, x('ptype.' + tp)])} />`, sub: x('ptypeHint.' + d.type) },
    { k: x('pv.name'), v: html`<${TextField} box value=${d.title} placeholder=${x('ptype.' + d.type)} ariaLabel=${x('pv.name')} onInput=${(v) => pv.setDraft({ title: v })} />`,
      sub: id ? x('pv.idHint', { id }) : x('pv.nameHint') },
    needsUrl ? { k: x('baseUrl'), v: html`<${TextField} box type="url" value=${d.baseUrl} placeholder="https://…/v1" ariaLabel=${x('baseUrl')} onInput=${(v) => pv.setDraft({ baseUrl: v })} />`,
      sub: d.type === 'local' ? x('pv.localHint') : x('pv.urlHint') } : null,
    d.type === 'extension' ? { k: x('pv.extension'), v: html`<${TextField} box value=${d.extension} placeholder="my-model-service" ariaLabel=${x('pv.extension')} onInput=${(v) => pv.setDraft({ extension: v })} />`,
      sub: x('pv.extensionHint') } : null,
    d.type !== 'local' ? { k: x('keyLabel'), v: html`<${TextField} box unmanaged value=${d.apiKey} placeholder=${x('pv.keyPlaceholder')} ariaLabel=${x('keyLabel')} onInput=${(v) => pv.setDraft({ apiKey: v })} />`,
      sub: d.type === 'openai-compatible' ? x('pv.keyOptional') : d.type === 'extension' ? x('pv.extKeyHint') : x('pv.keyHint') } : null,
    { k: x('pv.serves'), v: html`<${Line} wrap gap="medium">${PROVIDER_TYPES[d.type].map((c) => html`<${Check} inline key=${c} checked=${!!d.caps[c]} onChange=${(v) => pv.toggleDraftCap(c, v)}>${x('cap.' + c)}<//>`)}<//>`,
      sub: x('pv.servesHint') },
  ];
  return html`
    <${Box}>
      <${Label} block>${x('pv.addTitle')}<//>
      <${Facts} rows=${rows} />
      <${Actions}>
        <${Loud} control disabled=${pv.busy === 'add'} onClick=${() => pv.add()}>${x('pv.addSave')}<//>
        <${Action} small soft onClick=${() => pv.setAdding(false)}>${x('cancel')}<//>
      <//>
      ${msg(pv.addMsg)}
    <//>`;
}

/* ── Routing ──────────────────────────────────────────────────────────────────────────────────── */

/** The fix the page says in the reader's language, by the server's reason; any other reason keeps the server's words. */
const CLASSIFIER_FIX = {
  CLASSIFICATION_OFF: 'cc.fixOff', CLASSIFICATION_OFF_FOR_OWNER: 'cc.fixOwnerOff', AI_LABELLING_OFF: 'cc.fixAiOff', DECIDE_DISABLED: 'cc.fixDecide',
};

/**
 * The Content Classifier's choices in the routing editor: the decision model (the owner's default
 * decision provider, then each decision provider by name) and a text model (the text routing, then
 * each provider that serves text). The current choice stays in the list even when its provider is
 * no longer listed.
 * @param {any} pv @param {Array<any>} textServers
 * @returns {Array<[string, string]>}
 */
function classifierOptions(pv, textServers) {
  const opts = [
    ['jev:', x('cc.optJevDefault')],
    ...(pv.decideProviders || []).map((p) => [`jev:${p.id}`, x('cc.optJev', { name: p.title || p.id })]),
    ['llm:', x('cc.optLlmRouting')],
    ...textServers.map((p) => [`llm:${p.id}`, x('cc.optLlm', { name: p.title || p.id })]),
  ];
  const cur = pv.ccDraft;
  if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, cur.slice(cur.indexOf(':') + 1)]);
  return opts;
}

/**
 * The Content Classifier as one more row among the capabilities (content_classifier of GET
 * /v1/ai/capabilities): on or off, the kind of model it runs on, and the fix when it is off. In the
 * editor its value is a select like the other rows' (classifierOptions), saved with them. It has no
 * provider order of its own: a decision model classifier uses the decision model, a text model
 * classifier the text row above unless a provider is named. Null until the answer is in.
 */
function classifierRow(cc, pv, e, textServers) {
  if (!cc) return null;
  const kind = x(cc.type === 'llm' ? 'cc.typeLlm' : 'cc.typeJev');
  const v = e
    ? html`<${Select} fit ariaLabel=${x('cc.name')} value=${pv.ccDraft || ''} onChange=${(val) => pv.setCcDraft(val)} options=${classifierOptions(pv, textServers)} />`
    : x(cc.on ? 'cc.on' : 'cc.off', { kind });
  if (cc.on) {
    const mode = x('cc.mode.' + (cc.aiMode || 'suggest'));
    const sub = cc.dailyPerOwner == null ? x('cc.onSubNoCap', { mode }) : x('cc.onSub', { n: cc.dailyPerOwner, mode });
    return { key: 'classifier', k: named('ai.content_classifier', x('cc.name')), v, sub };
  }
  const fix = CLASSIFIER_FIX[cc.reason] ? x(CLASSIFIER_FIX[cc.reason]) : cc.fix || '';
  return { key: 'classifier', k: named('ai.content_classifier', x('cc.name')), v, missing: !e, sub: fix, subTone: 'notice' };
}

export function secRouting(ctx, num) {
  const pv = ctx.pv;
  if (!pv.view) return null;
  const routing = pv.view.routing || { defaults: {}, rules: {} };
  const e = !!pv.routeDraft;
  const titleOf = (id) => pv.providers.find((p) => p.id === id)?.title || id;
  const servers = (c) => pv.providers.filter((p) => p.capabilities?.[c]?.enabled);
  const set = CAPS.filter((c) => (routing.defaults?.[c] || []).length).length;
  const r = e ? pv.rulesDraft : routing.rules;
  const capRow = (c) => {
    const list = e ? pv.routeDraft[c] : (routing.defaults?.[c] || []);
    const options = [['', x('rt.none')], ...servers(c).map((p) => [p.id, p.title])];
    const untested = untestedIn(pv, list, c, !!r.onlyTested);
    const testNow = (p) => html`<${Action} small key=${p.id} disabled=${pv.busy === 'test'} onClick=${() => pv.testNow(p, c)}>${x('pv.testNow')}${untested.length > 1 ? ` · ${p.title}` : ''}<//>`;
    const v = e
      ? html`<${Line} wrap gap="small">
          ${[0, 1, 2].slice(0, Math.min(3, list.length + 1)).map((i) => html`
            ${i ? html`<${Note} inline>${x('rt.then')}<//>` : null}
            <${Select} fit key=${c + i} ariaLabel=${x('rt.place', { cap: x('cap.' + c), n: i + 1 })} value=${list[i] || ''} onChange=${(id) => pv.setRoute(c, i, id)} options=${options} />`)}
        <//>`
      : (list.length ? list.map(titleOf).join(' → ') : x('rt.auto'));
    if (untested.length) {
      return {
        key: c, k: capName(c), v, subTone: 'notice',
        sub: untested.map((p) => x('rt.untestedSkipped', { provider: p.title })).join(' '),
        actions: html`${untested.map(testNow)}`,
      };
    }
    return { key: c, k: capName(c), v, missing: !e && !list.length, sub: servers(c).length ? '' : x('rt.noServer') };
  };
  const rules = [
    { key: 'fallback', k: named('ai.fallback', x('rt.fallback')), v: e ? html`<${Check} inline checked=${!!r.fallback} onChange=${(v) => pv.setRule({ fallback: v })}>${x('rt.fallbackOn')}<//>` : (r.fallback ? x('rt.fallbackYes', { n: r.maxAttempts }) : x('rt.fallbackNo')) },
    e ? { key: 'attempts', k: named('ai.fallback_attempts', x('rt.attempts')), v: html`<${TextField} type="number" size="short" min="1" max="5" step="1" value=${String(r.maxAttempts ?? 3)} ariaLabel=${x('rt.attempts')} onInput=${(v) => pv.setRule({ maxAttempts: v })} />` } : null,
    { key: 'pool', k: named('ai.fallback_pool', x('rt.pool')), v: e ? html`<${Check} inline checked=${!!r.extendToPool} onChange=${(v) => pv.setRule({ extendToPool: v })}>${x('rt.poolOn')}<//>` : (r.extendToPool ? x('rt.poolYes', { order: x('rt.order.' + (r.poolOrder || 'priority')) }) : x('rt.poolNo')) },
    e && r.extendToPool ? { k: x('rt.orderLabel'), v: html`<${Select} fit ariaLabel=${x('rt.orderLabel')} value=${r.poolOrder || 'priority'} onChange=${(v) => pv.setRule({ poolOrder: v })}
        options=${['priority', 'cheapest', 'fastest'].map((k) => [k, x('rt.order.' + k)])} />` } : null,
    { key: 'tested', k: named('ai.only_tested', x('rt.tested')), v: e ? html`<${Check} inline checked=${!!r.onlyTested} onChange=${(v) => pv.setRule({ onlyTested: v })}>${x('rt.testedOn')}<//>` : (r.onlyTested ? x('yes') : x('no')) },
    { key: 'leave', k: named('ai.fallback_leaves_machine', x('rt.leave')), v: e ? html`<${Check} inline checked=${!!r.fallbackMayLeaveMachine} onChange=${(v) => pv.setRule({ fallbackMayLeaveMachine: v })}>${x('rt.leaveOn')}<//>` : (r.fallbackMayLeaveMachine ? x('yes') : x('no')) },
    { k: x('rt.voice'), v: e ? html`<${Check} inline checked=${!!r.speechVoiceMayChange} onChange=${(v) => pv.setRule({ speechVoiceMayChange: v })}>${x('rt.voiceOn')}<//>` : (r.speechVoiceMayChange ? x('yes') : x('no')), sub: x('rt.voiceSub') },
    { key: 'cost', k: named('ai.max_cost_per_call', x('rt.cost')), v: e ? html`<${TextField} type="number" size="short" min="0" step="0.01" value=${r.maxCostPerCallUsd ?? ''} placeholder=${x('rt.costNone')} ariaLabel=${x('rt.cost')} onInput=${(v) => pv.setRule({ maxCostPerCallUsd: v })} />`
      : (r.maxCostPerCallUsd != null ? `$${r.maxCostPerCallUsd}` : x('rt.costNone')), missing: !e && r.maxCostPerCallUsd == null },
  ];
  return html`
    <${PageSection} id="ai-routing" num=${num} title=${x('rt.title')} count=${x('rt.count', { n: set, total: CAPS.length })}>
      <${Note} kind="lead">${x('rt.lead')}<//>
      <${Facts} rows=${[...CAPS.map(capRow), classifierRow(pv.classifier, pv, e, servers('text'))]} />
      <${Space} above="section">
        <${Label} block>${x('rt.rules')}<//>
        <${Facts} rows=${rules} />
      <//>
      <${Actions}>
        ${e
          ? html`<${Action} small disabled=${pv.busy === 'routing'} onClick=${() => pv.saveRouting()}>${x('save')}<//><${Action} small soft onClick=${() => pv.editRouting(false)}>${x('cancel')}<//>`
          : html`<${Action} small onClick=${() => pv.editRouting(true)}>${x('change')}<//>`}
      <//>
      ${msg(pv.routeMsg)}
    <//>`;
}

/* ── Model policy ─────────────────────────────────────────────────────────────────────────────── */

export function secPolicy(ctx, num) {
  const pv = ctx.pv;
  if (!pv.policy) return null;
  const pol = pv.policy.policy || { mode: 'open' };
  const rec = pv.policy.recommended || {};
  const recCaps = CAPS.filter((c) => (rec[c] || []).length);
  const d = pv.policyDraft;
  const e = !!d;
  const mode = e ? d.mode : pol.mode;
  const applies = (e ? d.appliesTo : pol.appliesTo) || {};
  const WHO = ['owner', 'chat', 'agents', 'apps'];
  const modeV = e
    ? html`${['open', 'recommended', 'custom'].map((m) => html`<${Check} radio inline name="ai-policy-mode" key=${m} checked=${d.mode === m} disabled=${m === 'recommended' && !recCaps.length} onChange=${() => pv.setPolicyField({ mode: m })}>${x('pol.mode.' + m)}<//>`)}`
    : x('pol.mode.' + pol.mode);
  const rows = [
    { key: 'mode', k: named('ai.model_policy', x('pol.modeLabel')), v: modeV, sub: x('pol.modeSub.' + mode) },
    mode === 'custom' ? { k: x('pol.allow'), v: e
      ? html`<${TextArea} rows="5" value=${d.allow} placeholder=${'openai:gpt-5-mini\nopenrouter:anthropic/claude-sonnet-5'} ariaLabel=${x('pol.allow')} onInput=${(v) => pv.setPolicyField({ allow: v })} />`
      : html`<${Marks}>${(pol.allow || []).map((a) => html`<${Mark} key=${a}>${a}<//>`)}<//>`, sub: x('pol.allowSub') } : null,
    mode !== 'open' ? { k: x('pol.appliesTo'), v: e
      ? html`<${Line} wrap gap="medium">${WHO.map((w) => html`<${Check} inline key=${w} checked=${!!applies[w]} onChange=${(v) => pv.setPolicyField({ appliesTo: { ...d.appliesTo, [w]: v } })}>${x('pol.who.' + w)}<//>`)}<//>`
      : WHO.filter((w) => applies[w]).map((w) => x('pol.who.' + w)).join(' · ') || x('pol.nobody'), sub: x('pol.appliesSub') } : null,
    { k: x('pol.recommended'), v: recCaps.length
      ? html`${recCaps.map((c) => html`<${FactLine} key=${c} sub=${(rec[c] || []).join(', ')}>${x('cap.' + c)}<//>`)}`
      : x('pol.noRecommended'), missing: !recCaps.length, sub: x('pol.recommendedSub') },
  ];
  return html`
    <${PageSection} id="ai-policy" num=${num} title=${x('pol.title')} count=${x('pol.mode.' + pol.mode)}>
      <${Note} kind="lead">${x('pol.lead')}<//>
      <${Facts} rows=${rows} />
      <${Actions}>
        ${e
          ? html`<${Action} small disabled=${pv.busy === 'policy'} onClick=${() => pv.savePolicy()}>${x('save')}<//><${Action} small soft onClick=${() => pv.editPolicy(false)}>${x('cancel')}<//>`
          : html`<${Action} small onClick=${() => pv.editPolicy(true)}>${x('change')}<//>`}
      <//>
      ${msg(pv.policyMsg)}
    <//>`;
}
