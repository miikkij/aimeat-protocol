/**
 * @file decide-providers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's DECISION PROVIDERS inside the decision-model card: every provider this
 *   account may use, the owner's default among them, and the form that adds a provider of their own.
 *
 *   WHY A SCREEN. A provider is the address the owner's scrubbed content is sent to, with the key that
 *   goes with it, so only the owner in person adds one or chooses the default: an agent that could do
 *   either could send the owner's data anywhere or move itself off the provider chosen for it. Reading
 *   the providers and naming one per call is on MCP (aimeat_decide_settings, `provider` on
 *   aimeat_decide).
 *
 *   EACH ROW SAYS FOUR THINGS a person decides by: where it runs (an online service, or a local
 *   decision model on this machine), whose it is (this server's, a built-in example, your own), what it
 *   can carry (how many options, how much text), and where the content goes.
 *
 *   NO KEY IS EVER SHOWN. The node says only whether one is saved.
 * @structure DecideProviders({ view, onSaved }) · providerTitle(view, id) · toProviderBody(draft)
 * @usage import { DecideProviders } from './decide-providers.js';
 *   html`<${DecideProviders} view=${settings.providers} onSaved=${load} />`
 * @version-history
 *   v1.1.0 — 2026-09-23 — Review round: a message is drawn beside the control that caused it and a
 *     closed form takes its message with it; the form names the three addresses a local model may
 *     have and says so while typing; an online service takes a price, and an owner's one without a
 *     price says "no price given"; each row shows its address; numbers rounded and written in the
 *     page's language; the price said per decision.
 *   v1.0.0 — 2026-09-23 — Initial: decision providers on the settings page.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, money } from '/js/format.js';
import { apiPut, apiDelete } from '/js/api.js';

const EMPTY = { id: '', title: '', kind: 'hosted', url: '', model: '', takesKey: true, apiKey: '', maxOptions: '', context: '', price: '' };

/** The meta lines' class. One place, so a contrast fix is one line. */
const META = 'pf-aitr-row-meta';

/** A text length as a person reads it: to the nearest hundred once it is over a thousand. */
function roundChars(c) { return c >= 1000 ? Math.round(c / 100) * 100 : c; }

/** A typical decision's size, in the node's token estimate, for a price a person can picture. */
const TYPICAL_DECISION_TOKENS = 1000;

/**
 * What a provider costs, in words. A local model costs nothing. A hosted one with a price is priced per
 * typical decision. An owner's hosted provider with no price given says so rather than "costs nothing":
 * the owner's own service may well charge, and the node cannot know.
 */
function priceText(p) {
  if (p.kind === 'local') return t('decideProviders.free');
  if (!p.price_per_mtok) return p.source === 'owner' ? t('decideProviders.priceUnknown') : t('decideProviders.free');
  const perDecision = (p.price_per_mtok * TYPICAL_DECISION_TOKENS) / 1_000_000;
  // A price per decision is a fraction of a cent, so it keeps up to six decimals.
  return t('decideProviders.pricePerDecision', {
    price: money(perDecision, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
    chars: num(TYPICAL_DECISION_TOKENS * 4),
    perMillion: money(p.price_per_mtok, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
  });
}

/** A provider's title by its id, from the view the node sent; the id itself when it is not listed. */
export function providerTitle(view, id) {
  const p = (view?.providers || []).find(x => x.id === id);
  return p ? p.title : String(id || '');
}

/**
 * The form's draft as the body of PUT /v1/ai/decide/providers/:id. Empty numbers are left to the node.
 * The person gives the text length in CHARACTERS; the node counts a quarter of a request's length as
 * its tokens, so the record holds characters / 4.
 */
export function toProviderBody(d) {
  const limits = {};
  if (String(d.maxOptions).trim() !== '') limits.max_choice_options = Number(d.maxOptions);
  if (String(d.context).trim() !== '') limits.context_tokens = Math.ceil(Number(d.context) / 4);
  return {
    title: d.title.trim(), kind: d.kind, url: d.url.trim(), model: d.model.trim(),
    auth: { type: d.takesKey ? 'key' : 'none' },
    ...(d.takesKey && d.apiKey.trim() ? { api_key: d.apiKey.trim() } : {}),
    ...(d.kind === 'hosted' && String(d.price).trim() !== '' ? { price_per_mtok: Number(d.price) } : {}),
    ...(Object.keys(limits).length ? { limits } : {}),
  };
}

/** A message where it was caused: `at` names the place, and only that place draws it. */
function Note({ msg, at }) {
  if (!msg || msg.at !== at) return null;
  return html`<p class=${msg.error ? 'pf-aitr-error pf-dr-pre' : 'pf-aitr-note'} role="status">${msg.key ? t(msg.key) : msg.text}</p>`;
}

/** The three hosts the node accepts as "on this machine" (services/decide/providers.ts). */
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/** True when a "local" draft points somewhere else: said on the form, before the node refuses it. */
export function localButNotHere(draft) {
  if (draft.kind !== 'local' || !draft.url.trim() || !URL.canParse(draft.url.trim())) return false;
  const host = new URL(draft.url.trim()).hostname.toLowerCase();
  return !LOOPBACK.includes(host) && !/^127\./.test(host);
}

function ProviderForm({ draft, busy, msg, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  const notHere = localButNotHere(draft);
  return html`
    <div class="pf-dr-editor">
      <label class="pf-dr-field"><span>${t('decideProviders.f.id')}</span>
        <input class="og-input og-input--mono" value=${draft.id} disabled=${busy} placeholder="my-model"
               onInput=${e => set('id', e.currentTarget.value)} /></label>
      <label class="pf-dr-field"><span>${t('decideProviders.f.title')}</span>
        <input class="og-input" value=${draft.title} disabled=${busy} onInput=${e => set('title', e.currentTarget.value)} /></label>
      <label class="pf-dr-field"><span>${t('decideProviders.f.kind')}</span>
        <select class="og-input" value=${draft.kind} disabled=${busy}
                onChange=${e => onChange({ ...draft, kind: e.currentTarget.value, takesKey: e.currentTarget.value === 'hosted' ? draft.takesKey : false })}>
          <option value="hosted">${t('decideProviders.kind.hosted')}</option>
          <option value="local">${t('decideProviders.kind.local')}</option>
        </select></label>
      <p class="pf-aitr-note">${t('decideProviders.localHelp')}</p>
      <label class="pf-dr-field"><span>${t('decideProviders.f.url')}</span>
        <input class="og-input og-input--mono" value=${draft.url} disabled=${busy}
               placeholder=${draft.kind === 'local' ? 'http://127.0.0.1:8801/v1/systemone' : 'https://…/v1/systemone'}
               onInput=${e => set('url', e.currentTarget.value)} /></label>
      ${notHere && html`<p class="pf-aitr-error" role="status">${t('decideProviders.notHere')}</p>`}
      <label class="pf-dr-field"><span>${t('decideProviders.f.model')}</span>
        <input class="og-input og-input--mono" value=${draft.model} disabled=${busy} placeholder="multilingual"
               onInput=${e => set('model', e.currentTarget.value)} /></label>
      <label class="pf-dr-check">
        <input type="checkbox" class="checkbox checkbox-sm" checked=${draft.takesKey} disabled=${busy}
               onChange=${() => set('takesKey', !draft.takesKey)} />
        ${' '}${t('decideProviders.f.takesKey')}
      </label>
      ${draft.takesKey && html`
        <label class="pf-dr-field"><span>${t('decideProviders.f.key')}</span>
          <input class="og-input" type="password" autocomplete="off" data-1p-ignore data-lpignore="true"
                 value=${draft.apiKey} disabled=${busy} onInput=${e => set('apiKey', e.currentTarget.value)} /></label>`}
      ${draft.kind === 'hosted' && html`
        <label class="pf-dr-field"><span>${t('decideProviders.f.price')}</span>
          <input class="og-input" type="number" min="0" step="any" value=${draft.price} disabled=${busy} placeholder="0.042"
                 onInput=${e => set('price', e.currentTarget.value)} /></label>`}
      <h5 class="pf-dr-h">${t('decideProviders.limitsTitle')}</h5>
      <p class="pf-aitr-note">${t('decideProviders.limitsHelp')}</p>
      <div class="pf-dr-pair">
        <label class="pf-dr-field"><span>${t('decideProviders.f.maxOptions')}</span>
          <input class="og-input" type="number" min="2" step="1" value=${draft.maxOptions} disabled=${busy} placeholder="20"
                 onInput=${e => set('maxOptions', e.currentTarget.value)} /></label>
        <label class="pf-dr-field"><span>${t('decideProviders.f.context')}</span>
          <input class="og-input" type="number" min="256" step="1" value=${draft.context} disabled=${busy} placeholder="4096"
                 onInput=${e => set('context', e.currentTarget.value)} /></label>
      </div>
      <${Note} msg=${msg} at="form" />
      <div class="og-doors">
        <button type="button" class="og-door" onClick=${onSave} disabled=${busy || notHere}>${t('decideProviders.save')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onCancel} disabled=${busy}>${t('decideProviders.cancel')}</button>
      </div>
    </div>`;
}

export function DecideProviders({ view, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // A success message is kept as its locale KEY, so it follows a language switch. `at` is where the
  // press happened, and the message is drawn there: a refusal a screen away from its button reads as
  // nothing happening. `okAt` is where a success lands when the place pressed is gone afterwards.
  const act = async (fn, okKey, at, okAt = at) => {
    setBusy(true);
    setMsg(null);
    let done = false;
    try {
      await fn();
      setMsg({ key: okKey, error: false, at: okAt });
      await onSaved?.();
      done = true;
    } catch (err) {
      // The node names every problem of a refused provider; show all of them, one per line.
      const problems = err?.response?.error?.details?.problems;
      setMsg({ text: Array.isArray(problems) ? problems.join('\n') : (err?.message || t('decideProviders.saveFailed')), error: true, at });
    } finally {
      setBusy(false);
    }
    return done;
  };

  const save = async () => {
    const id = draft.id.trim();
    if (!id) { setMsg({ key: 'decideProviders.idMissing', error: true, at: 'form' }); return; }
    if (await act(() => apiPut(`/v1/ai/decide/providers/${encodeURIComponent(id)}`, toProviderBody(draft)), 'decideProviders.saved', 'form', `row:${id}`)) setDraft(null);
  };
  const cancel = () => { setDraft(null); setMsg(m => (m && m.at === 'form' ? null : m)); };

  // Choosing the server's own default gives the choice back to the server, so a later change there reaches this owner.
  const setDefault = (id) => act(() => apiPut('/v1/ai/decide/settings', { provider: id === view.node_default ? null : id }), 'decideProviders.defaultSaved', 'default');

  if (!view) return null;
  const list = view.providers || [];

  return html`
    <div class="pf-dr" id="decide-providers">
      <h4 class="pf-aitr-sub">${t('decideProviders.title')}</h4>
      <p class="pf-aitr-note">${t('decideProviders.desc')}</p>
      <h5 class="pf-dr-h" id="decide-providers-default">${t('decideProviders.defaultLabel')}</h5>
      <label class="pf-dr-field">
        <select class="og-input" aria-labelledby="decide-providers-default" value=${view.default} disabled=${busy} onChange=${e => setDefault(e.currentTarget.value)}>
          ${list.map(p => html`<option key=${p.id} value=${p.id}>
            ${p.title}${p.id === view.node_default ? ` · ${t('decideProviders.serverDefault')}` : ''}</option>`)}
        </select></label>

      <${Note} msg=${msg} at="default" />

      <ul class="pf-aitr-list">
        ${list.map(p => html`
          <li key=${p.id} class="pf-aitr-row">
            <span class="pf-aitr-row-main">${p.title}${p.id === view.default ? ` · ${t('decideProviders.isDefault')}` : ''}</span>
            <span class=${META}>
              ${t(`decideProviders.kind.${p.kind === 'local' ? 'local' : 'hosted'}`)} · ${t(`decideProviders.source.${p.source}`)} · ${p.model}
            </span>
            <span class=${META}>
              ${t('decideProviders.carries', { options: num(p.limits.max_choice_options), chars: num(roundChars(p.limits.context_tokens * 4)) })}
              ${' · '}${priceText(p)}
              ${p.source === 'owner' && p.auth?.type === 'key' ? ` · ${p.auth.has_key ? t('decideProviders.keySaved') : t('decideProviders.keyMissing')}` : ''}
            </span>
            <span class=${META}>${t(p.leaves === false ? 'decideProviders.stays' : 'decideProviders.leaves')}</span>
            <span class=${`${META} og-input--mono`} translate="no">${p.url}</span>
            ${p.source === 'owner' && html`
              <span class="og-doors">
                <button type="button" class="og-door og-door--quiet" disabled=${busy}
                        onClick=${() => act(() => apiDelete(`/v1/ai/decide/providers/${encodeURIComponent(p.id)}`), 'decideProviders.removed', `row:${p.id}`, 'list')}>
                  ${t('decideProviders.remove')}</button>
              </span>`}
            <${Note} msg=${msg} at=${`row:${p.id}`} />
          </li>`)}
      </ul>
      <${Note} msg=${msg} at="list" />

      ${!draft && html`
        <div class="og-doors">
          <button type="button" class="og-door" disabled=${busy} onClick=${() => { setMsg(null); setDraft({ ...EMPTY }); }}>
            ${t('decideProviders.add')}</button>
        </div>`}
      ${draft && html`<${ProviderForm} draft=${draft} busy=${busy} msg=${msg} onChange=${setDraft} onSave=${save} onCancel=${cancel} />`}
    </div>`;
}

export default DecideProviders;
