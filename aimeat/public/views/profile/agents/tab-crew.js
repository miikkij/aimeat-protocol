/**
 * @file tab-crew.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Crew tab: a JSON crew definition for this agent, from an empty template menu
 *   through draft, validated, published and back. Five states the person sees:
 *     empty      no definition — pick a template or paste JSON; never an empty form
 *     draft      edited, not checked — Try and Publish are off
 *     validated  the agent's own validator accepted exactly this text — Try and Publish are on
 *     published  the live definition, with when the runtime last reported loading it
 *     invalid    the validator's messages, verbatim, anchored to the member or task they name
 *   Validate and Try ask the agent over the connector tunnel (GET .../crew reports whether it is
 *   connected); the node holds no validator, so an agent that is not running cannot be asked and
 *   the tab says that instead of guessing. A trial leaves nothing behind. Publish validates again
 *   on the server before writing, so a stale green light cannot publish a broken definition.
 * @structure
 *   - statusOf() — the five-state derivation from what is loaded, edited and validated
 *   - TabCrew — load, actions (validate / try / publish / draft / restore), the header and the
 *     form-or-JSON body; sections live in ./crew-editor.js, templates in ./crew-templates.js
 * @version-history
 *   v1.1.0 -- 2026-08-28 -- A definition published from outside the tab (crewaimeat CLI) has no
 *     revision number; the live line says so instead of "revision 0", and the runtime line shows
 *     when it loaded rather than a timestamp in a number's place.
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api, apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { timeAgo } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { CREW_TEMPLATES, buildTemplate } from './crew-templates.js';
import { anchorErrors, ErrorLines, IdentitySection, CrewSection, RunSection, ContractSection } from './crew-editor.js';

const html = htm.bind(h);
const K = 'profile.agents.detail.crew';
const TRY_POLL_MS = 2000;

const canon = (doc) => (doc ? JSON.stringify(doc) : '');

/** The five states, from what is loaded, what is edited, and what the validator last said. */
export function statusOf({ doc, published, validation }) {
  if (!doc) return 'empty';
  const text = canon(doc);
  if (validation && validation.forText === text) return validation.errors.length ? 'invalid' : 'validated';
  if (published && canon(published.doc) === text) return 'published';
  return 'draft';
}

export default function TabCrew({ agentName, showToast }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [state, setState] = useState(null);           // GET /crew
  const [doc, setDoc] = useState(null);               // the working copy
  const [validation, setValidation] = useState(null); // { forText, errors }
  const [view, setView] = useState('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState(null);
  const [busy, setBusy] = useState(null);             // 'validate' | 'publish' | 'draft' | 'restore' | null
  const [tryPrompt, setTryPrompt] = useState('');
  const [tryRun, setTryRun] = useState(null);         // { id, status, result, error }
  const { confirm, ConfirmUI } = useConfirm();
  const docRef = useRef(doc);
  docRef.current = doc;
  const base = `/v1/agents/${encodeURIComponent(agentName)}/crew`;

  const load = useCallback(async ({ keepEdits = true } = {}) => {
    try {
      const resp = await apiGet(base);
      const data = resp?.data || null;
      setState(data);
      setLoadError(null);
      const current = docRef.current;
      // First load, or a reload after publish: take the draft, else the live doc. While the person
      // is editing, a live update must not overwrite their text.
      if (!keepEdits || current === null) {
        const next = data?.draft?.doc || data?.published?.doc || null;
        setDoc(next);
        setJsonText(next ? JSON.stringify(next, null, 2) : '');
      }
    } catch (err) {
      setLoadError(err.message);
    }
    setLoading(false);
  }, [base]);

  useEffect(() => { load({ keepEdits: false }); }, [load]);

  useEffect(() => {
    const handler = () => load({ keepEdits: true });
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const status = statusOf({ doc, published: state?.published, validation });
  const online = !!state?.online;
  const errors = anchorErrors(status === 'invalid' ? validation.errors : []);
  const published = state?.published || null;
  const runtime = state?.runtime || null;

  const edit = (next) => {
    setDoc(next);
    setJsonText(JSON.stringify(next, null, 2));
  };

  const pickTemplate = (id) => {
    setValidation(null);
    edit(buildTemplate(id, agentName));
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      setJsonError(null);
      setDoc({ ...parsed, agent_name: agentName });
    } catch (e) {
      setJsonError(e.message);
    }
  };

  const failToast = (err) => showToast(err?.message || String(err), true);

  async function validate() {
    if (!doc) return;
    setBusy('validate');
    const text = canon(doc);
    try {
      const resp = await api(`${base}/validate`, { method: 'POST', body: JSON.stringify({ doc }), timeoutMs: 45_000, retries: 0 });
      const errs = Array.isArray(resp?.data?.errors) ? resp.data.errors : [];
      setValidation({ forText: text, errors: errs });
      if (errs.length === 0) showToast(t(`${K}.messages.valid`));
    } catch (err) {
      failToast(err);
    }
    setBusy(null);
  }

  async function publish() {
    if (!doc) return;
    setBusy('publish');
    try {
      const resp = await api(`${base}/publish`, { method: 'POST', body: JSON.stringify({ doc }), timeoutMs: 45_000, retries: 0 });
      showToast(t(`${K}.messages.published`, { rev: resp?.data?.revision }));
      setValidation(null);
      await load({ keepEdits: false });
    } catch (err) {
      // The server validated again and found problems: show them where they point.
      const errs = err?.details?.errors;
      if (Array.isArray(errs) && errs.length) setValidation({ forText: canon(doc), errors: errs });
      failToast(err);
    }
    setBusy(null);
  }

  async function saveDraft() {
    if (!doc) return;
    setBusy('draft');
    try {
      await apiPut(`${base}/draft`, { doc });
      showToast(t(`${K}.messages.draftSaved`));
      await load({ keepEdits: true });
    } catch (err) { failToast(err); }
    setBusy(null);
  }

  async function discardDraft() {
    setBusy('draft');
    try {
      await apiDelete(`${base}/draft`);
      showToast(t(`${K}.messages.draftDiscarded`));
      setValidation(null);
      await load({ keepEdits: false });
    } catch (err) { failToast(err); }
    setBusy(null);
  }

  function restore(revision) {
    confirm(t(`${K}.messages.restoreConfirm`, { rev: revision }), async () => {
      setBusy('restore');
      try {
        const resp = await api(`${base}/restore`, { method: 'POST', body: JSON.stringify({ revision }), timeoutMs: 45_000, retries: 0 });
        showToast(t(`${K}.messages.published`, { rev: resp?.data?.revision }));
        setValidation(null);
        await load({ keepEdits: false });
      } catch (err) { failToast(err); }
      setBusy(null);
    });
  }

  async function tryOnce() {
    if (!doc || !tryPrompt.trim()) return;
    setTryRun({ id: null, status: 'starting', result: null, error: null });
    try {
      const started = await apiPost(`${base}/try`, { doc, prompt: tryPrompt.trim() });
      const id = started?.data?.try_id;
      const deadline = Date.now() + (started?.data?.timeout_ms || 300_000) + 10_000;
      setTryRun({ id, status: 'running', result: null, error: null });
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, TRY_POLL_MS));
        const poll = await apiGet(`${base}/try/${encodeURIComponent(id)}`).catch(err => { swallowed('tab-crew: try poll', err); return null; });
        const d = poll?.data;
        if (!d) continue;
        if (d.status === 'done' || d.status === 'failed') {
          setTryRun({ id, status: d.status, result: d.result, error: d.error });
          if (d.status === 'failed') showToast(t(`${K}.messages.tryFailed`, { msg: d.error?.message || '' }), true);
          return;
        }
      }
      setTryRun({ id, status: 'failed', result: null, error: { code: 'TIMEOUT', message: t(`${K}.messages.tryTimedOut`) } });
    } catch (err) {
      setTryRun({ id: null, status: 'failed', result: null, error: { code: err?.code || 'ERROR', message: err?.message || String(err) } });
      failToast(err);
    }
  }

  if (loading) return html`<div class="pf-agd-empty">…</div>`;
  if (loadError) return html`<div class="pf-agd-empty">${loadError}</div>`;

  const validated = status === 'validated';
  // The live definition passed the validator when it was published, so a trial of it needs no
  // second green light; only an edited text does.
  const canTry = validated || status === 'published';
  const busyAny = busy !== null || tryRun?.status === 'running' || tryRun?.status === 'starting';

  return html`
    <div class="pf-agd-crew" onClick=${(e) => e.stopPropagation()}>
      <${ConfirmUI} />
      <div class="pf-agd-crew-head">
        <div>
          <div class="pf-agd-section-title">${t(`${K}.title`)}</div>
          <div class="section-desc">${t(`${K}.intro`)}</div>
        </div>
        <div class="pf-agd-crew-status">
          <span class="pf-agd-badge pf-agd-crew-state pf-agd-crew-state--${status}">${t(`${K}.state.${status}`)}</span>
          <span class="pf-agd-badge ${online ? 'pf-agd-badge--active' : 'pf-agd-badge--inactive'}" title=${online ? '' : t(`${K}.offlineHint`)}>${t(online ? `${K}.online` : `${K}.offline`)}</span>
        </div>
      </div>

      ${published && html`
        <div class="pf-agd-crew-live">
          <div>${published.revision > 0
            ? t(`${K}.liveRevision`, { rev: published.revision, when: timeAgo(published.publishedAt) })
            : t(`${K}.liveUnnumbered`, { when: timeAgo(published.publishedAt) })}</div>
          <div class="pf-agd-help-text">${runtimeLine(runtime, published)}</div>
        </div>
      `}
      ${!online && html`<div class="pf-agd-warning-text pf-agd-crew-offline">${t(`${K}.offlineHint`)}</div>`}

      ${status === 'empty' ? html`
        <div class="pf-agd-crew-templates">
          <div class="pf-agd-section-title">${t(`${K}.templates.title`)}</div>
          <div class="pf-agd-help-text">${t(`${K}.templates.hint`)}</div>
          <div class="pf-agd-crew-template-grid">
            ${CREW_TEMPLATES.map(tp => html`
              <button key=${tp.id} type="button" class="pf-agd-crew-template" onClick=${() => pickTemplate(tp.id)}>
                <div class="pf-agd-crew-template-name">${t(tp.nameKey)}</div>
                <div class="pf-agd-crew-template-desc">${t(tp.descKey)}</div>
              </button>
            `)}
            <button type="button" class="pf-agd-crew-template" onClick=${() => { setView('json'); edit({ agent_name: agentName, agents: [], tasks: [] }); }}>
              <div class="pf-agd-crew-template-name">${t(`${K}.templates.pasteJson`)}</div>
              <div class="pf-agd-crew-template-desc">${t(`${K}.limitNote`)}</div>
            </button>
          </div>
        </div>
      ` : html`
        <div class="pf-agd-crew-toolbar">
          <div class="pf-agd-subtab-bar pf-agd-crew-views">
            <button type="button" class="pf-agd-subtab ${view === 'form' ? 'pf-agd-subtab-active' : ''}" onClick=${() => setView('form')}>${t(`${K}.actions.form`)}</button>
            <button type="button" class="pf-agd-subtab ${view === 'json' ? 'pf-agd-subtab-active' : ''}" onClick=${() => { setJsonText(JSON.stringify(doc, null, 2)); setView('json'); }}>${t(`${K}.actions.json`)}</button>
          </div>
          <div class="pf-agd-crew-actions">
            <button type="button" class="btn-primary btn-sm" disabled=${busyAny || !online} onClick=${validate}>
              ${busy === 'validate' ? t(`${K}.actions.validating`) : t(`${K}.actions.validate`)}
            </button>
            <button type="button" class="btn-outline btn-sm" disabled=${busyAny || !validated || !online} onClick=${publish}>
              ${busy === 'publish' ? t(`${K}.actions.publishing`) : t(`${K}.actions.publish`)}
            </button>
            <button type="button" class="btn-ghost btn-sm" disabled=${busyAny} onClick=${saveDraft}>${t(`${K}.actions.saveDraft`)}</button>
            ${state?.draft && html`<button type="button" class="btn-ghost btn-sm" disabled=${busyAny} onClick=${discardDraft}>${t(`${K}.actions.discardDraft`)}</button>`}
            ${!published && html`<button type="button" class="btn-ghost btn-sm" disabled=${busyAny} onClick=${() => { setValidation(null); setDoc(null); }}>${t(`${K}.actions.changeTemplate`)}</button>`}
          </div>
        </div>
        ${status === 'draft' && html`<div class="pf-agd-help-text pf-agd-crew-note">${t(`${K}.needsValidation`)}${state?.draft || published ? ' ' + t(`${K}.unpublishedEdits`) : ''}</div>`}
        ${status === 'invalid' && html`
          <div class="pf-agd-crew-problems">
            <div class="pf-agd-crew-problems-title">${t(`${K}.messages.problems`, { n: validation.errors.length })}</div>
            <${ErrorLines} lines=${errors.general} />
          </div>
        `}
        <div class="pf-agd-help-text pf-agd-crew-limit">${t(`${K}.limitNote`)}</div>

        ${view === 'json' ? html`
          <div class="pf-agd-crew-jsonview">
            <textarea class="input-field pf-agd-crew-json pf-agd-crew-json--full" rows="24" value=${jsonText}
              onInput=${e => setJsonText(e.target.value)} onBlur=${applyJson} spellcheck="false"></textarea>
            ${jsonError && html`<div class="pf-agd-crew-parse-error">${t(`${K}.messages.jsonInvalid`, { err: jsonError })}</div>`}
          </div>
        ` : html`
          <${IdentitySection} doc=${doc} onChange=${edit} errors=${errors} />
          <${CrewSection} doc=${doc} onChange=${edit} errors=${errors} />
          <${RunSection} doc=${doc} onChange=${edit} errors=${errors} />
          <${ContractSection} doc=${doc} onChange=${edit} errors=${errors} />
        `}

        <section class="pf-agd-crew-section pf-agd-crew-try">
          <div class="pf-agd-section-title">${t(`${K}.actions.tryRun`)}</div>
          <div class="pf-agd-help-text">${t(`${K}.actions.tryNoTrace`)}</div>
          <div class="pf-agd-crew-try-row">
            <input type="text" class="input-field input-sm" placeholder=${t(`${K}.actions.tryPrompt`)} value=${tryPrompt}
              onInput=${e => setTryPrompt(e.target.value)} disabled=${!canTry || !online} />
            <button type="button" class="btn-outline btn-sm" disabled=${busyAny || !canTry || !online || !tryPrompt.trim()} onClick=${tryOnce}>
              ${tryRun?.status === 'running' || tryRun?.status === 'starting' ? t(`${K}.actions.tryRunning`) : t(`${K}.actions.tryRun`)}
            </button>
          </div>
          ${tryRun && (tryRun.status === 'done' || tryRun.status === 'failed') && html`
            <div class="pf-agd-crew-try-result ${tryRun.status === 'failed' ? 'pf-agd-crew-try-result--failed' : ''}">
              <div class="pf-agd-crew-sub">${t(`${K}.actions.tryTitle`)}</div>
              <pre class="pf-agd-crew-try-output">${tryOutput(tryRun)}</pre>
            </div>
          `}
        </section>
      `}

      ${Array.isArray(state?.versions) && state.versions.length > 0 && html`
        <section class="pf-agd-crew-section">
          <div class="pf-agd-section-title">${t(`${K}.versions.title`)}</div>
          <div class="pf-agd-help-text">${t(`${K}.versions.hint`, { n: state.version_window })}</div>
          <ul class="pf-agd-crew-versions">
            ${state.versions.map(v => html`
              <li key=${v.revision}>
                <span>${t(`${K}.versions.byAt`, { rev: v.revision, when: v.publishedAt ? timeAgo(v.publishedAt) : '' })}</span>
                ${published?.revision === v.revision
                  ? html`<span class="pf-agd-badge pf-agd-badge--active">${t(`${K}.versions.live`)}</span>`
                  : html`<button type="button" class="btn-ghost btn-sm" disabled=${busyAny || !online} onClick=${() => restore(v.revision)}>${t(`${K}.actions.restore`)}</button>`}
              </li>
            `)}
          </ul>
        </section>
      `}
    </div>
  `;
}

/**
 * The runtime's own report of what it loaded, or that it has not reported. A revision number is
 * the node route's; a definition published from the crewaimeat CLI carries none, and a runtime
 * that loaded one reports no number either, so the line falls back to WHEN it loaded rather than
 * printing a timestamp where a number is expected.
 */
function runtimeLine(runtime, published) {
  if (!runtime || typeof runtime.loadedAt !== 'string') return t(`${K}.runtimeNotReported`);
  const numbered = typeof runtime.revision === 'number' && runtime.revision > 0;
  const rev = numbered ? runtime.revision : '?';
  const when = timeAgo(runtime.loadedAt);
  const errs = Array.isArray(runtime.errors) ? runtime.errors : [];
  if (runtime.ok === false || errs.length) return t(`${K}.runtimeLoadedProblems`, { rev, when, n: errs.length });
  if (numbered && published.revision > 0 && runtime.revision < published.revision) {
    return t(`${K}.runtimeStale`, { rev: runtime.revision, live: published.revision });
  }
  return numbered ? t(`${K}.runtimeLoaded`, { rev, when }) : t(`${K}.runtimeLoadedAt`, { when });
}

function tryOutput(run) {
  if (run.status === 'failed') return run.error?.message || '';
  const r = run.result;
  if (r && typeof r === 'object' && typeof r.output === 'string') return r.output;
  return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
}
