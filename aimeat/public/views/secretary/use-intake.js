/**
 * @file secretary/use-intake.js
 * @description Intake hook for the Secretary view: the active context's workspace list, the
 *   save-a-note composer (Draft band → file into a workspace), the Ask-band inbox decision cards
 *   (post a prompt → owner answers → apply the stashed action), AND (P2-E, plan §22 Phase-4) the
 *   cross-context auto-router: a note is classified against ALL contexts (cheap word-overlap, biased
 *   by recorded corrections); a high-confidence match to a non-active context AUTO-ROUTES the note
 *   into that context's organism, a low-confidence match yields an Ask card, and when the owner moves
 *   a note to a different context that correction is recorded to bias future cheap routing. Extracted
 *   from views/secretary.js to keep the view under the file-size limit. See secretary-routing.js
 *   (pure routing helpers) + docs/plans/2026-06-24-secretary-p2-fix-prompt.md (P2-E).
 * @structure useIntake({ active, contexts, config, persistConfig, owner, showToast }) -> { wsList, note composer, decision cards, routing }
 * @usage const intake = useIntake({...}); noteCard(intake) / decisionsCard(intake)
 * @version-history
 *   v0.3.0 — 2026-06-24 — P3-A: doc/image intake — handleAttach uploads a file to the active
 *     context's storage, runs a vision summary for images (owner key), classifies the target
 *     workspace, and files a `…w.{wsId}.files.{id}` record so it's discoverable. P3-B: applyDecision
 *     now auto-logs a decision contract for the owner's file-note choice (learning loop).
 *   v0.2.0 — 2026-06-24 — G4: load corrections via the list endpoint to avoid a first-load console 404.
 *   v0.1.0 — 2026-06-24 — P2: extract intake from views/secretary.js + add cross-context auto-routing (P2-E).
 */
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { api, apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';
import { listMessages } from '/js/services/agent-messages.js';
import { routeIntake, learnCorrection } from '/js/services/secretary-routing.js';
import { uploadFile, blobToDataUrl } from '/js/services/organisms.js';
import { buildDecisionRecord } from '/js/services/secretary-helpers.js';

const CORRECTIONS_KEY = 'secretary.routing.corrections';

/** Cheap word-overlap pick of the workspace whose name best matches the text. */
function suggestWorkspace(text, wsList) {
  if (wsList.length === 0) return '';
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4));
  let best = wsList[0];
  let bestScore = -1;
  for (const w of wsList) {
    const hay = String(w.name).toLowerCase();
    let s = 0;
    for (const word of words) if (hay.includes(word)) s++;
    if (s > bestScore) { bestScore = s; best = w; }
  }
  return best.id;
}

export function useIntake({ active, contexts, config, persistConfig, owner, showToast, onNoteFiled }) {
  const [noteText, setNoteText] = useState('');
  const [noteWsId, setNoteWsId] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [wsList, setWsList] = useState([]);              // [{id,name}] of the active context's organism
  const [attaching, setAttaching] = useState(false);    // P3-A: a file upload+intake is in flight
  const [attachResult, setAttachResult] = useState(null); // P3-A: { name, wsName, kind } of the last filed file
  const [decisionAnswers, setDecisionAnswers] = useState({}); // promptId -> chosen answer text (from inbox)
  const [corrections, setCorrections] = useState({});   // P2-E learned routing signal (word -> contextId)

  const activeOrgId = active && active.organismId;

  // Load the active context's workspaces (id+name) so notes can be filed into one.
  useEffect(() => {
    if (!activeOrgId) { setWsList([]); return; }
    let cancelled = false;
    apiGet(`/v1/organisms/${encodeURIComponent(activeOrgId)}/workspaces`)
      .then((r) => {
        if (cancelled) return;
        const list = (r && r.data && r.data.workspaces) || [];
        setWsList(list.map((w) => ({ id: w.id, name: w.name || w.id })));
      })
      .catch(() => { if (!cancelled) setWsList([]); });
    setNoteWsId('');
    return () => { cancelled = true; };
  }, [activeOrgId]);

  // Load the learned routing corrections once (P2-E). Use the LIST endpoint (not a direct GET of the
  // key) so a not-yet-written corrections record returns an empty list (200) instead of a console 404 (G4).
  useEffect(() => {
    let cancelled = false;
    apiGet(`/v1/memory?prefix=${encodeURIComponent(CORRECTIONS_KEY)}&_=${Date.now()}`)
      .then((r) => {
        if (cancelled) return;
        const items = (r && r.data && r.data.items) || [];
        const rec = items.find((it) => it.key === CORRECTIONS_KEY);
        setCorrections((rec && rec.value && rec.value.map) || {});
      })
      .catch(() => { if (!cancelled) setCorrections({}); });
    return () => { cancelled = true; };
  }, [owner]);

  const suggestedWsId = useMemo(() => suggestWorkspace(noteText, wsList), [noteText, wsList]);
  const effectiveWsId = noteWsId || suggestedWsId;

  // P2-E: which context does this note belong to? Cheap classify across ALL contexts (corrections-biased).
  const route = useMemo(() => {
    const r = routeIntake(noteText, contexts, active && active.id, corrections);
    if (!r) return null;
    const target = contexts.find((c) => c.id === r.contextId);
    return { ...r, name: target ? target.name : '' };
  }, [noteText, contexts, active, corrections]);

  // ── Pending Ask-band decisions the Secretary posted to the inbox, awaiting the owner's answer ──
  const pendingDecisions = useMemo(() => (config && config.pendingDecisions) || {}, [config]);
  const pendingIds = useMemo(() => Object.keys(pendingDecisions), [pendingDecisions]);
  const pendingKey = pendingIds.join(',');
  useEffect(() => {
    if (pendingKey === '') { setDecisionAnswers({}); return; }
    let cancelled = false;
    listMessages('secretary', { perPage: 100, direction: 'inbound' })
      .then((r) => {
        if (cancelled) return;
        const msgs = (r && r.data && r.data.messages) || [];
        const map = {};
        for (const m of msgs) {
          const pa = m.metadata && (m.metadata.promptAnswer || m.metadata.prompt_answer);
          const pid = pa && (pa.promptId || pa.prompt_id);
          if (pid) map[pid] = pa.choice;
        }
        setDecisionAnswers(map);
      })
      .catch(() => { if (!cancelled) setDecisionAnswers({}); });
    return () => { cancelled = true; };
  }, [pendingKey]);

  /** Write a note record into a given organism+workspace. Returns the chosen workspace name. */
  const fileNoteInto = useCallback(async (organismId, wsId, wsName, body) => {
    const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const title = body.split('\n')[0].slice(0, 80);
    await apiPost('/v1/memory', {
      key: `organism.${organismId}.w.${wsId}.notes.${id}`,
      value: { id, title, body, createdAt: new Date().toISOString(), via: 'secretary' },
      visibility: 'private',
    });
    return wsName;
  }, []);

  /** Record a correction (owner filed a note into a different context than routing guessed) — P2-E. */
  const recordCorrection = useCallback(async (body, toContextId) => {
    const next = learnCorrection(corrections, body, toContextId);
    setCorrections(next);
    await apiPost('/v1/memory', { key: CORRECTIONS_KEY, value: { map: next }, visibility: 'private' }).catch(() => {});
  }, [corrections]);

  /** File a note into the active context's self-organism (the chosen workspace) — Draft band. */
  const saveNote = useCallback(async () => {
    const body = noteText.trim();
    if (!body || !activeOrgId || !effectiveWsId) return;
    setNoteSaving(true);
    try {
      const ws = wsList.find((w) => w.id === effectiveWsId);
      await fileNoteInto(activeOrgId, effectiveWsId, ws ? ws.name : '', body);
      showToast(`${t('secretary.noteSaved')} ${ws ? ws.name : ''}`.trim());
      setNoteText(''); setNoteWsId('');
      // Slice 4: let the Secretary propose a trigger if this note implies a recurrence/deadline (best-effort).
      if (onNoteFiled) onNoteFiled(body);
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    } finally {
      setNoteSaving(false);
    }
  }, [noteText, activeOrgId, effectiveWsId, wsList, fileNoteInto, showToast, onNoteFiled]);

  /** P3-A: attach a document or image to the active context. Uploads the file to storage, runs a
   *  vision summary for images (owner's key, best-effort), classifies the target workspace from the
   *  filename + summary, and files a `…w.{wsId}.files.{id}` record so the attachment is discoverable
   *  alongside notes. Respects the active context. Vision/upload failures surface as a toast; a vision
   *  failure still files the document (the summary is just omitted). */
  const handleAttach = useCallback(async (file) => {
    if (!file || !activeOrgId || wsList.length === 0) return;
    setAttaching(true);
    setAttachResult(null);
    try {
      const isImage = String(file.type || '').startsWith('image/');
      // (1) Upload the raw bytes to the active context's private storage.
      const { key, url, mime } = await uploadFile(activeOrgId, file);
      // (2) Images: ask a vision-capable model (owner's key) for a short structured summary so the
      //     attachment is searchable by content, not just filename. Best-effort — never blocks filing.
      let summary = '';
      if (isImage) {
        try {
          const dataUrl = await blobToDataUrl(file);
          const r = await api('/v1/ai/complete', {
            method: 'POST',
            body: JSON.stringify({
              prompt: t('secretary.attachVisionPrompt'),
              systemPrompt: t('secretary.attachVisionSystem'),
              images: [dataUrl],
              app_id: 'secretary-intake',
            }),
            timeoutMs: 1_800_000, retries: 0,
          });
          summary = (r && r.data && r.data.content) ? String(r.data.content).trim() : '';
        } catch (e) {
          showToast(`${t('secretary.attachVisionFailed')}: ${e.message}`, true);
        }
      }
      // (3) Classify the workspace from the filename + any extracted summary (cheap word overlap).
      const titleBase = (file.name || (isImage ? 'Image' : 'Document')).slice(0, 80);
      const classifyText = `${titleBase} ${summary}`.trim();
      const wsId = suggestWorkspace(classifyText, wsList) || wsList[0].id;
      const ws = wsList.find((w) => w.id === wsId);
      // (4) File a discoverable record. `body` carries title + summary so FTS indexes the content.
      const id = 'file-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const body = [titleBase, summary].filter(Boolean).join('\n\n');
      await apiPost('/v1/memory', {
        key: `organism.${activeOrgId}.w.${wsId}.files.${id}`,
        value: {
          id, type: 'file', kind: isImage ? 'image' : 'document', title: titleBase,
          storageKey: key, storageUrl: url, mimeType: mime, summary, body,
          createdAt: new Date().toISOString(), via: 'secretary',
        },
        visibility: 'private',
      });
      const wsName = ws ? ws.name : '';
      setAttachResult({ name: titleBase, wsName, kind: isImage ? 'image' : 'document' });
      showToast(`${t('secretary.attachFiled')} ${wsName}`.trim());
    } catch (e) {
      showToast(`${t('secretary.attachError')}: ${e.message}`, true);
    } finally {
      setAttaching(false);
    }
  }, [activeOrgId, wsList, showToast]);

  /** P2-E: AUTO-ROUTE a note into the best-matching OTHER context's organism (high confidence). */
  const autoRouteNote = useCallback(async () => {
    const body = noteText.trim();
    if (!body || !route || route.confidence !== 'high' || !route.contextId) return;
    const target = contexts.find((c) => c.id === route.contextId);
    if (!target || !target.organismId) return;
    setNoteSaving(true);
    try {
      const r = await apiGet(`/v1/organisms/${encodeURIComponent(target.organismId)}/workspaces`).catch(() => null);
      const list = (r && r.data && r.data.workspaces) || [];
      const wsId = suggestWorkspace(body, list.map((w) => ({ id: w.id, name: w.name || w.id }))) || (list[0] && list[0].id);
      const ws = list.find((w) => w.id === wsId);
      if (!ws) throw new Error(t('secretary.noteError'));
      await fileNoteInto(target.organismId, ws.id, ws.name || ws.id, body);
      await recordCorrection(body, target.id);
      showToast(`${t('secretary.routedTo')} ${target.name} → ${ws.name || ws.id}`);
      setNoteText(''); setNoteWsId('');
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    } finally {
      setNoteSaving(false);
    }
  }, [noteText, route, contexts, fileNoteInto, recordCorrection, showToast]);

  /** Ask band: post a decision card to the owner's inbox and stash the pending action. */
  const askDecision = useCallback(async () => {
    const body = noteText.trim();
    if (!body || !activeOrgId || wsList.length < 2) return;
    setNoteSaving(true);
    try {
      const promptId = 'notews-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const options = wsList.slice(0, 8).map((w) => w.name);
      await apiPost('/v1/agents/secretary/messages', {
        content: `${t('secretary.askWhereContent')} "${body.slice(0, 80)}"`,
        direction: 'outbound',
        metadata: { prompt: { prompt_id: promptId, question: t('secretary.askWhereQ'), options, allow_other: false } },
      });
      const base = config || {};
      const pending = { ...(base.pendingDecisions || {}), [promptId]: { type: 'file-note', body, organismId: activeOrgId, question: t('secretary.askWhereQ'), createdAt: new Date().toISOString() } };
      await persistConfig({ ...base, pendingDecisions: pending });
      showToast(t('secretary.askedInInbox'));
      setNoteText(''); setNoteWsId('');
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    } finally {
      setNoteSaving(false);
    }
  }, [noteText, activeOrgId, wsList, config, persistConfig, showToast]);

  /** The owner answered a decision card in the inbox → carry out the stashed action + clear it. */
  const applyDecision = useCallback(async (promptId) => {
    const dec = pendingDecisions[promptId];
    const choice = decisionAnswers[promptId];
    if (!dec || !choice) return;
    try {
      let toastTarget = choice;
      if (dec.type === 'tick-note') {
        if (/^yes/i.test(String(choice))) {
          const fr = await apiGet('/v1/memory/secretary.feed').catch(() => null);
          const items = (fr && fr.data && fr.data.value && Array.isArray(fr.data.value.items)) ? fr.data.value.items : [];
          const entry = { id: 'f-' + Date.now().toString(36), ts: new Date().toISOString(), kind: 'act', contextId: dec.contextId || '', contextName: dec.contextName || '', text: dec.text || '' };
          await apiPost('/v1/memory', { key: 'secretary.feed', value: { items: [entry, ...items].slice(0, 50) }, visibility: 'private' });
        }
      } else {
        const wr = await apiGet(`/v1/organisms/${encodeURIComponent(dec.organismId)}/workspaces`).catch(() => null);
        const list = (wr && wr.data && wr.data.workspaces) || [];
        const ws = list.find((w) => String(w.name || '').toLowerCase() === String(choice).toLowerCase());
        if (ws) {
          toastTarget = await fileNoteInto(dec.organismId, ws.id, ws.name, dec.body);
        }
        // P3-B: the owner made a real choice (where to file) → log it as a decision contract so the
        // learning loop later scores it. Don't duplicate if this card already produced one.
        if (!dec.decisionLogged) {
          const noteSnippet = String(dec.body || '').replace(/\s+/g, ' ').slice(0, 60);
          const rec = buildDecisionRecord({
            decision: `${t('secretary.askWhereQ')} "${noteSnippet}"`,
            options: list.map((w) => w.name).filter(Boolean),
            chosen: String(choice),
            rationale: t('secretary.decisionAutoRationale'),
            expectedOutcome: t('secretary.decisionAutoExpectedFile'),
            revisitDays: 7,
            active,
          });
          await apiPost('/v1/memory', { key: `secretary.decision.${rec.id}`, value: rec, visibility: 'private', tags: ['secretary', 'decision', 'open', (active && active.id) || ''] }).catch(() => {});
        }
      }
      const base = config || {};
      const next = { ...(base.pendingDecisions || {}) };
      delete next[promptId];
      await persistConfig({ ...base, pendingDecisions: next });
      showToast(`${t('secretary.noteSaved')} ${toastTarget}`.trim());
      // Nudge the learning-loop card (and others) to re-read the newly written decision.
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    }
  }, [pendingDecisions, decisionAnswers, config, persistConfig, fileNoteInto, active, showToast]);

  const dismissDecision = useCallback(async (promptId) => {
    const base = config || {};
    const next = { ...(base.pendingDecisions || {}) };
    delete next[promptId];
    await persistConfig({ ...base, pendingDecisions: next });
  }, [config, persistConfig]);

  return {
    wsList, suggestedWsId, effectiveWsId,
    noteText, setNoteText, noteWsId, setNoteWsId, noteSaving,
    saveNote, askDecision, route, autoRouteNote,
    attaching, attachResult, handleAttach,
    pendingIds, pendingDecisions, decisionAnswers, applyDecision, dismissDecision,
  };
}
