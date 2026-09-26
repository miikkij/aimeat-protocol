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
 *   v1.19.1 -- 2026-09-26 -- The try output scrolls after 400px again, as main's
 *     .pf-agd-crew-try-output did (Code scroll="large"; fix pass).
 *   v1.19.0 -- 2026-09-26 -- Onto the components: the head is SubHeading with the two Status marks
 *     (Mark), the live line the section Card, the offline note and the problems the Attention note
 *     (Note aside), the start tiles the boxed Choice, the form/JSON switch Tabs (kind view), the
 *     actions Loud and Action in Actions, the JSON field a TextArea in the typewriter face again (main
 *     drew it mono; the branch had lost it), the try row a TextField with its action, its answer the
 *     scrolling Code block, the try and versions parts the Split, the versions the List. The page
 *     writes no class; the tab still stops a press from reaching the agent card.
 *   v1.18.0 -- 2026-09-26 -- A try's answer is the Code block (css/components/code-block.css), a failed try's error the Form message's error tone (a unification: Jouni's decision "Code block").
 *   v1.17.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- A part of the crew form under its hairline is the split (.og-split), a unification: the line Workflows and Boards draw.
 *   v1.14.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside) in its own words; a working agent's line of figures is the Hint, a unification: Jouni's decision Attention note.
 *   v1.13.0 -- 2026-09-25 -- The crew templates are the Choice (poster.css .poster-choice), as a new agent's shapes are, a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-25 -- A list of things, one per row, is the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- What a press did, said where it was pressed, is the Form message (css/components/form-message.css, its error cut when refused); a place keeps only its margin, a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.5.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Card } from '/components/Card.js';
import { Choice } from '/components/Choice.js';
import { Tabs, TabPanel } from '/components/Tabs.js';
import { TextField, TextArea } from '/components/TextField.js';
import { SubHeading } from '/components/SubHeading.js';
import { Row as Line, Stack, Split, Space } from '/components/Layout.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { CREW_TEMPLATES, buildTemplate } from './crew-templates.js';
import CrewLlmPicker from './crew-llm-picker.js';
import { anchorErrors, ErrorLines, IdentitySection, CrewSection, RunSection, ContractSection } from './crew-editor.js';

const html = htm.bind(h);
const K = 'profile.agents.detail.crew';
const TRY_POLL_MS = 2000;
/** The start tile that opens the JSON editor instead of a template. */
const PASTE_JSON = '__paste_json__';

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

  if (loading) return html`<${Note} kind="quiet">…<//>`;
  if (loadError) return html`<${Note} kind="quiet">${loadError}<//>`;

  const validated = status === 'validated';
  // The live definition passed the validator when it was published, so a trial of it needs no
  // second green light; only an edited text does.
  const canTry = validated || status === 'published';
  const busyAny = busy !== null || tryRun?.status === 'running' || tryRun?.status === 'starting';
  const stateTone = status === 'published' || status === 'validated' ? 'fine' : status === 'invalid' ? 'danger' : status === 'draft' ? 'attention' : 'off';
  const trying = tryRun?.status === 'running' || tryRun?.status === 'starting';
  const pickStart = (id) => {
    if (id !== PASTE_JSON) { pickTemplate(id); return; }
    setView('json');
    edit({ agent_name: agentName, agents: [], tasks: [] });
  };

  // The wrapper keeps a press inside the tab from reaching the agent card around it.
  return html`
    <div onClick=${(e) => e.stopPropagation()}>
      <${Stack} gap="large">
        <${ConfirmUI} />
        <${Line} justify="between" align="start" wrap gap="large">
          <div><${SubHeading} desc=${t(`${K}.intro`)}>${t(`${K}.title`)}<//></div>
          <${Line} gap="tight">
            <${Mark} kind="status" tone=${stateTone}>${t(`${K}.state.${status}`)}<//>
            <${Mark} kind="status" tone=${online ? 'fine' : 'off'} title=${online ? undefined : t(`${K}.offlineHint`)}>${t(online ? `${K}.online` : `${K}.offline`)}<//>
          <//>
        <//>

        ${published && html`
          <${Card} tone="section">
            ${published.revision > 0
              ? t(`${K}.liveRevision`, { rev: published.revision, when: timeAgo(published.publishedAt) })
              : t(`${K}.liveUnnumbered`, { when: timeAgo(published.publishedAt) })}
            <${Note}>${runtimeLine(runtime, published)}<//>
          <//>
        `}
        ${!online && html`<${Note} kind="aside" size="small">${t(`${K}.offlineHint`)}<//>`}

        ${/* Which model this agent thinks with. Above the definition because it is one line and it
              decides how everything below it will actually be carried out. */''}
        <${CrewLlmPicker} agentName=${agentName} menu=${menu} showToast=${showToast} onSaved=${loadMenu} />

        ${status === 'empty' ? html`
          <div>
            <${SubHeading}>${t(`${K}.templates.title`)}<//>
            <${Note}>${t(`${K}.templates.hint`)}<//>
            <${Choice} boxed ariaLabel=${t(`${K}.templates.title`)} value=${null} onChange=${pickStart}
              options=${[
                ...CREW_TEMPLATES.map(tp => ({ value: tp.id, label: t(tp.nameKey), hint: t(tp.descKey) })),
                { value: PASTE_JSON, label: t(`${K}.templates.pasteJson`), hint: t(`${K}.limitNote`) },
              ]} />
          </div>
        ` : html`
          <${Line} justify="between" wrap gap="medium">
            <${Tabs} kind="view" value=${view}
              onSelect=${(v) => { if (v === 'json') setJsonText(JSON.stringify(doc, null, 2)); setView(v); }}
              items=${[{ value: 'form', label: t(`${K}.actions.form`) }, { value: 'json', label: t(`${K}.actions.json`) }]} />
            <${Actions}>
              <${Loud} control disabled=${busyAny || !online} onClick=${validate}>
                ${busy === 'validate' ? t(`${K}.actions.validating`) : t(`${K}.actions.validate`)}
              <//>
              <${Action} small disabled=${busyAny || !validated || !online} onClick=${publish}>
                ${busy === 'publish' ? t(`${K}.actions.publishing`) : t(`${K}.actions.publish`)}
              <//>
              <${Action} small disabled=${busyAny} onClick=${saveDraft}>${t(`${K}.actions.saveDraft`)}<//>
              ${state?.draft && html`<${Action} small disabled=${busyAny} onClick=${discardDraft}>${t(`${K}.actions.discardDraft`)}<//>`}
              ${!published && html`<${Action} small disabled=${busyAny} onClick=${() => { setValidation(null); setDoc(null); }}>${t(`${K}.actions.changeTemplate`)}<//>`}
            <//>
          <//>
          ${status === 'draft' && html`<${Note}>${t(`${K}.needsValidation`)}${state?.draft || published ? ' ' + t(`${K}.unpublishedEdits`) : ''}<//>`}
          ${status === 'invalid' && html`
            <${Note} kind="aside" size="small">
              <${Note} kind="message" error>${t(`${K}.messages.problems`, { n: validation.errors.length })}<//>
              <${ErrorLines} lines=${errors.general} />
            <//>
          `}
          <${Note}>${t(`${K}.limitNote`)}<//>

          <${TabPanel} value=${view}>${view === 'json' ? html`
            <div>
              <${TextArea} code rows=${24} value=${jsonText} ariaLabel=${t(`${K}.actions.json`)}
                onInput=${setJsonText} onBlur=${applyJson} />
              ${jsonError && html`<${Note} kind="message" error>${t(`${K}.messages.jsonInvalid`, { err: jsonError })}<//>`}
            </div>
          ` : html`
            <${IdentitySection} doc=${doc} onChange=${edit} errors=${errors} />
            <${CrewSection} doc=${doc} onChange=${edit} errors=${errors} runtimeTools=${menu?.tools} decideTools=${decideTools} />
            <${RunSection} doc=${doc} onChange=${edit} errors=${errors} />
            <${ContractSection} doc=${doc} onChange=${edit} errors=${errors} />
          `}<//>

          <${Split} above="none">
            <${SubHeading}>${t(`${K}.actions.tryRun`)}<//>
            <${Note}>${t(`${K}.actions.tryNoTrace`)}<//>
            <${TextField} placeholder=${t(`${K}.actions.tryPrompt`)} ariaLabel=${t(`${K}.actions.tryPrompt`)} value=${tryPrompt}
              onInput=${setTryPrompt} disabled=${!canTry || !online}
              actions=${html`<${Action} small disabled=${busyAny || !canTry || !online || !tryPrompt.trim()} onClick=${tryOnce}>
                ${trying ? t(`${K}.actions.tryRunning`) : t(`${K}.actions.tryRun`)}
              <//>`} />
            ${tryRun && (tryRun.status === 'done' || tryRun.status === 'failed') && html`
              <${Space} above="medium">
                <${SubHeading}>${t(`${K}.actions.tryTitle`)}<//>
                ${tryRun.status === 'failed'
                  ? html`<${Note} kind="message" error>${tryOutput(tryRun)}<//>`
                  : html`<${Code} block scroll="large">${tryOutput(tryRun)}<//>`}
              <//>
            `}
          <//>
        `}

        ${Array.isArray(state?.versions) && state.versions.length > 0 && html`
          <${Split} above="none">
            <${SubHeading}>${t(`${K}.versions.title`)}<//>
            <${Note}>${t(`${K}.versions.hint`, { n: state.version_window })}<//>
            <${List} cols="name-doors" keepCols apart>
              ${state.versions.map(v => html`
                <${Row} key=${v.revision}>
                  <${Name}>${t(`${K}.versions.byAt`, { rev: v.revision, when: v.publishedAt ? timeAgo(v.publishedAt) : '' })}<//>
                  <${Doors}>${published?.revision === v.revision
                    ? html`<${Mark} kind="status" tone="fine">${t(`${K}.versions.live`)}<//>`
                    : html`<${Action} small row disabled=${busyAny || !online} onClick=${() => restore(v.revision)}>${t(`${K}.actions.restore`)}<//>`}<//>
                <//>
              `)}
            <//>
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
