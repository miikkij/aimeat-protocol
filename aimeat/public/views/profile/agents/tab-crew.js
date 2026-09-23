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
 *   2026-09-22 -- Discard draft carries the danger tone.
 *   2026-09-22 -- Composed from the shared parts (Section, ListRow, Chip, Action, Field, Surface, Text)
 *     instead of the agents-crew sheet's own classes, so the tab follows the one component set.
 *   2026-09-20 -- Loads what the tool picker's Decisions group needs: the rules made for agents, and
 *     whether a TypeSafe key exists for this agent.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
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
import { Section, Stack, Columns, ListRow, Chip, Action, Field, Surface, Text } from '/components/poster-parts.js';
import { CREW_TEMPLATES, buildTemplate } from './crew-templates.js';
import CrewLlmPicker from './crew-llm-picker.js';
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
  const [menu, setMenu] = useState(null);             // GET /crew/menu — the runtime's own answer
  const [decideTools, setDecideTools] = useState(null); // { rules, available, enabled } for the tool picker
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

  // WHAT THE RUNTIME OFFERS, and which model is chosen for this agent. Its own call, because it can
  // be slow (it asks the agent over the tunnel) and the definition must render without waiting for
  // it; a failure leaves `menu` null and the served tool list takes over.
  const loadMenu = useCallback(async () => {
    try {
      const resp = await apiGet(`${base}/menu`);
      setMenu(resp?.data ?? null);
    } catch (err) { swallowed('tab-crew: menu', err); setMenu(null); }
  }, [base]);

  // THE DECISION ROWS of the tool picker: `decide` and one `decide:<rule>` per rule the owner made
  // for agents. Whether they can be ticked depends on a key existing somewhere in the order (this
  // agent's own, the owner's, the node's); when none does, the rows are disabled and say why.
  const loadDecide = useCallback(async () => {
    try {
      const [rules, settings, mine] = await Promise.all([
        apiGet('/v1/ai/decide/rules'), apiGet('/v1/ai/decide/settings'),
        apiGet(`/v1/agents/${encodeURIComponent(agentName)}/ai-keys`),
      ]);
      const s = settings?.data ?? {};
      setDecideTools({
        rules: (rules?.data?.rules ?? []).filter(r => r.use !== 'app').map(r => ({ id: r.id, title: r.title, decides: r.decides })),
        available: !!s.enabled && (!!s.available || !!mine?.data?.decide?.has_key),
        enabled: !!s.enabled,
      });
    } catch (err) { swallowed('tab-crew: decide tools', err); setDecideTools(null); }
  }, [agentName]);

  useEffect(() => { load({ keepEdits: false }); }, [load]);
  useEffect(() => { loadMenu(); }, [loadMenu]);
  useEffect(() => { loadDecide(); }, [loadDecide]);

  useEffect(() => {
    const handler = () => { load({ keepEdits: true }); loadDecide(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load, loadDecide]);

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

  if (loading) return html`<${Text} tone="muted">…<//>`;
  if (loadError) return html`<${Text} tone="muted">${loadError}<//>`;

  const validated = status === 'validated';
  // The live definition passed the validator when it was published, so a trial of it needs no
  // second green light; only an edited text does.
  const canTry = validated || status === 'published';
  const busyAny = busy !== null || tryRun?.status === 'running' || tryRun?.status === 'starting';

  return html`
    <div onClick=${(e) => e.stopPropagation()}>
      <${ConfirmUI} />
      <${Stack}>
        <${Section} size="small" density="compact" title=${t(`${K}.title`)} description=${t(`${K}.intro`)}>
          <${Stack} density="compact">
            <${Stack} direction="wrap" density="compact">
              <${Chip} tone=${status === 'published' || status === 'validated' ? 'sun' : 'plain'}>${t(`${K}.state.${status}`)}<//>
              <${Chip} tone=${online ? 'plain' : 'muted'} title=${online ? '' : t(`${K}.offlineHint`)}>${t(online ? `${K}.online` : `${K}.offline`)}<//>
            <//>
            ${published && html`
              <${ListRow} density="compact" detailKind="text"
                name=${published.revision > 0
                  ? t(`${K}.liveRevision`, { rev: published.revision, when: timeAgo(published.publishedAt) })
                  : t(`${K}.liveUnnumbered`, { when: timeAgo(published.publishedAt) })}
                detail=${runtimeLine(runtime, published)} />
            `}
            ${!online && html`<${Text} tone="coral">${t(`${K}.offlineHint`)}<//>`}
          <//>
        <//>

        ${/* Which model this agent thinks with. Above the definition because it is one line and it
              decides how everything below it will actually be carried out. */''}
        <${CrewLlmPicker} agentName=${agentName} menu=${menu} showToast=${showToast} onSaved=${loadMenu} />

        ${status === 'empty' ? html`
          <${Section} size="small" density="compact" title=${t(`${K}.templates.title`)} description=${t(`${K}.templates.hint`)}>
            <${Columns} density="compact" collapse="600">
              ${CREW_TEMPLATES.map(tp => html`
                <${ListRow} key=${tp.id} detailKind="text" name=${t(tp.nameKey)} detail=${t(tp.descKey)}
                  onOpen=${() => pickTemplate(tp.id)} />
              `)}
              <${ListRow} detailKind="text" name=${t(`${K}.templates.pasteJson`)} detail=${t(`${K}.limitNote`)}
                onOpen=${() => { setView('json'); edit({ agent_name: agentName, agents: [], tasks: [] }); }} />
            <//>
          <//>
        ` : html`
          <${Stack} direction="wrap" align="between" density="compact">
            <${Stack} direction="horizontal" density="compact">
              <${Action} kind="tab" selected=${view === 'form'} onClick=${() => setView('form')}>${t(`${K}.actions.form`)}<//>
              <${Action} kind="tab" selected=${view === 'json'} onClick=${() => { setJsonText(JSON.stringify(doc, null, 2)); setView('json'); }}>${t(`${K}.actions.json`)}<//>
            <//>
            <${Stack} direction="wrap" align="center" density="compact">
              <${Action} kind="primary" disabled=${busyAny || !online} onClick=${validate}>
                ${busy === 'validate' ? t(`${K}.actions.validating`) : t(`${K}.actions.validate`)}
              <//>
              <${Action} disabled=${busyAny || !validated || !online} onClick=${publish}>
                ${busy === 'publish' ? t(`${K}.actions.publishing`) : t(`${K}.actions.publish`)}
              <//>
              <${Action} kind="text" disabled=${busyAny} onClick=${saveDraft}>${t(`${K}.actions.saveDraft`)}<//>
              ${state?.draft && html`<${Action} kind="text" tone="danger" disabled=${busyAny} onClick=${discardDraft}>${t(`${K}.actions.discardDraft`)}<//>`}
              ${!published && html`<${Action} kind="text" disabled=${busyAny} onClick=${() => { setValidation(null); setDoc(null); }}>${t(`${K}.actions.changeTemplate`)}<//>`}
            <//>
          <//>
          ${status === 'draft' && html`<${Text} tone="muted">${t(`${K}.needsValidation`)}${state?.draft || published ? ' ' + t(`${K}.unpublishedEdits`) : ''}<//>`}
          ${status === 'invalid' && html`
            <${Surface} kind="aside" tone="danger" density="compact">
              <${Stack} density="compact">
                <${Text} kind="label">${t(`${K}.messages.problems`, { n: validation.errors.length })}<//>
                <${ErrorLines} lines=${errors.general} />
              <//>
            <//>
          `}
          <${Text} kind="caption" tone="muted">${t(`${K}.limitNote`)}<//>

          ${view === 'json' ? html`
            <${Field} type="textarea" rows=${24} value=${jsonText} spellCheck=${false}
              onInput=${e => setJsonText(e.target.value)} onChange=${applyJson}
              error=${jsonError ? t(`${K}.messages.jsonInvalid`, { err: jsonError }) : undefined} />
          ` : html`
            <${IdentitySection} doc=${doc} onChange=${edit} errors=${errors} />
            <${CrewSection} doc=${doc} onChange=${edit} errors=${errors} runtimeTools=${menu?.tools} decideTools=${decideTools} />
            <${RunSection} doc=${doc} onChange=${edit} errors=${errors} />
            <${ContractSection} doc=${doc} onChange=${edit} errors=${errors} />
          `}

          <${Section} size="small" density="compact" title=${t(`${K}.actions.tryRun`)} description=${t(`${K}.actions.tryNoTrace`)}>
            <${Stack} density="compact">
              <${Columns} layout="leading" density="compact" collapse="560">
                <${Field} placeholder=${t(`${K}.actions.tryPrompt`)} value=${tryPrompt}
                  onInput=${e => setTryPrompt(e.target.value)} disabled=${!canTry || !online} />
                <${Stack} direction="horizontal" density="compact">
                  <${Action} disabled=${busyAny || !canTry || !online || !tryPrompt.trim()} onClick=${tryOnce}>
                    ${tryRun?.status === 'running' || tryRun?.status === 'starting' ? t(`${K}.actions.tryRunning`) : t(`${K}.actions.tryRun`)}
                  <//>
                <//>
              <//>
              ${tryRun && (tryRun.status === 'done' || tryRun.status === 'failed') && html`
                <${Text} kind="label">${t(`${K}.actions.tryTitle`)}<//>
                <${Surface} kind="code" tone=${tryRun.status === 'failed' ? 'danger' : 'plain'}>${tryOutput(tryRun)}<//>
              `}
            <//>
          <//>
        `}

        ${Array.isArray(state?.versions) && state.versions.length > 0 && html`
          <${Section} size="small" density="compact" title=${t(`${K}.versions.title`)}
            description=${t(`${K}.versions.hint`, { n: state.version_window })}>
            ${state.versions.map(v => html`
              <${ListRow} key=${v.revision} density="compact" detailKind="text"
                name=${t(`${K}.versions.byAt`, { rev: v.revision, when: v.publishedAt ? timeAgo(v.publishedAt) : '' })}
                value=${published?.revision === v.revision ? html`<${Chip} tone="sun">${t(`${K}.versions.live`)}<//>` : null}
                actions=${published?.revision === v.revision ? null
                  : html`<${Action} kind="text" disabled=${busyAny || !online} onClick=${() => restore(v.revision)}>${t(`${K}.actions.restore`)}<//>`} />
            `)}
          <//>
        `}
      <//>
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
