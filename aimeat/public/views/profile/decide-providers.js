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
 *   v1.0.0 — 2026-09-23 — Initial: decision providers on the settings page.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPut, apiDelete } from '/js/api.js';

const EMPTY = { id: '', title: '', kind: 'hosted', url: '', model: '', takesKey: true, apiKey: '', maxOptions: '', context: '' };

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
    ...(Object.keys(limits).length ? { limits } : {}),
  };
}

function ProviderForm({ draft, busy, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
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
      ${draft.kind === 'local' && html`<p class="pf-aitr-note">${t('decideProviders.localHelp')}</p>`}
      <label class="pf-dr-field"><span>${t('decideProviders.f.url')}</span>
        <input class="og-input og-input--mono" value=${draft.url} disabled=${busy}
               placeholder=${draft.kind === 'local' ? 'http://127.0.0.1:8801/v1/systemone' : 'https://…/v1/systemone'}
               onInput=${e => set('url', e.currentTarget.value)} /></label>
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
      <div class="og-doors">
        <button type="button" class="og-door" onClick=${onSave} disabled=${busy}>${t('decideProviders.save')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onCancel} disabled=${busy}>${t('decideProviders.cancel')}</button>
      </div>
    </div>`;
}

export function DecideProviders({ view, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // A success message is kept as its locale KEY, so it follows a language switch.
  const act = async (fn, okKey) => {
    setBusy(true);
    setMsg(null);
    let done = false;
    try {
      await fn();
      setMsg({ key: okKey, error: false });
      await onSaved?.();
      done = true;
    } catch (err) {
      // The node names every problem of a refused provider; show all of them, one per line.
      const problems = err?.response?.error?.details?.problems;
      setMsg({ text: Array.isArray(problems) ? problems.join('\n') : (err?.message || t('decideProviders.saveFailed')), error: true });
    } finally {
      setBusy(false);
    }
    return done;
  };

  const save = async () => {
    const id = draft.id.trim();
    if (!id) { setMsg({ key: 'decideProviders.idMissing', error: true }); return; }
    if (await act(() => apiPut(`/v1/ai/decide/providers/${encodeURIComponent(id)}`, toProviderBody(draft)), 'decideProviders.saved')) setDraft(null);
  };

  // Choosing the server's own default gives the choice back to the server, so a later change there reaches this owner.
  const setDefault = (id) => act(() => apiPut('/v1/ai/decide/settings', { provider: id === view.node_default ? null : id }), 'decideProviders.defaultSaved');

  if (!view) return null;
  const list = view.providers || [];

  return html`
    <div class="pf-dr" id="decide-providers">
      <h4 class="pf-aitr-sub">${t('decideProviders.title')}</h4>
      <p class="pf-aitr-note">${t('decideProviders.desc')}</p>
      ${msg && html`<p class=${msg.error ? 'pf-aitr-error pf-dr-pre' : 'pf-aitr-note'} role="status">${msg.key ? t(msg.key) : msg.text}</p>`}

      <h5 class="pf-dr-h" id="decide-providers-default">${t('decideProviders.defaultLabel')}</h5>
      <label class="pf-dr-field">
        <select class="og-input" aria-labelledby="decide-providers-default" value=${view.default} disabled=${busy} onChange=${e => setDefault(e.currentTarget.value)}>
          ${list.map(p => html`<option key=${p.id} value=${p.id}>
            ${p.title}${p.id === view.node_default ? ` · ${t('decideProviders.serverDefault')}` : ''}</option>`)}
        </select></label>

      <ul class="pf-aitr-list">
        ${list.map(p => html`
          <li key=${p.id} class="pf-aitr-row">
            <span class="pf-aitr-row-main">${p.title}${p.id === view.default ? ` · ${t('decideProviders.isDefault')}` : ''}</span>
            <span class="pf-aitr-row-meta">
              ${t(`decideProviders.kind.${p.kind === 'local' ? 'local' : 'hosted'}`)} · ${t(`decideProviders.source.${p.source}`)} · ${p.model}
            </span>
            <span class="pf-aitr-row-meta">
              ${t('decideProviders.carries', { options: String(p.limits.max_choice_options), chars: String(p.limits.context_tokens * 4) })}
              ${' · '}${p.kind === 'local' || !p.price_per_mtok ? t('decideProviders.free') : t('decideProviders.price', { price: String(p.price_per_mtok) })}
              ${p.source === 'owner' && p.auth?.type === 'key' ? ` · ${p.auth.has_key ? t('decideProviders.keySaved') : t('decideProviders.keyMissing')}` : ''}
            </span>
            <span class="pf-aitr-row-meta">${t(p.leaves === false ? 'decideProviders.stays' : 'decideProviders.leaves')}</span>
            ${p.source === 'owner' && html`
              <span class="og-doors">
                <button type="button" class="og-door og-door--quiet" disabled=${busy}
                        onClick=${() => act(() => apiDelete(`/v1/ai/decide/providers/${encodeURIComponent(p.id)}`), 'decideProviders.removed')}>
                  ${t('decideProviders.remove')}</button>
              </span>`}
          </li>`)}
      </ul>

      ${!draft && html`
        <div class="og-doors">
          <button type="button" class="og-door" disabled=${busy} onClick=${() => { setMsg(null); setDraft({ ...EMPTY }); }}>
            ${t('decideProviders.add')}</button>
        </div>`}
      ${draft && html`<${ProviderForm} draft=${draft} busy=${busy} onChange=${setDraft} onSave=${save} onCancel=${() => setDraft(null)} />`}
    </div>`;
}

export default DecideProviders;
