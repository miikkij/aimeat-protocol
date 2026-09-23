/**
 * @file track-response-modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Track a response" modal, shared by the Inbox tab and the Notebook. The INTENT is
 *   formed entirely by AI (the records triage): on open it asks the caller's own model which organism
 *   → workspace → RECORD TYPE best fits this message (chosen generically from what each workspace
 *   actually offers — not hard-coded), drafts a title + content, and (on create) builds the record
 *   value to conform to that type's ACTUAL schema + derives the completion condition. On submit the
 *   record is written DRAFT→PUBLISH through the proper workspace flow and bound to a Tracked Response.
 *   A secondary "park to notebook" action stores the message (with its source link + reply intent) for
 *   later processing instead of placing it now. No AI key → no feature.
 * @structure TrackResponseModal({ open, msg, onClose, onDone, showToast, defaultMode, allowPark })
 * @usage import { TrackResponseModal } from '/views/profile/track-response-modal.js';
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared set: the site's Dialog with its actions, the
 *     choices and the draft as Fields, the thinking step as Text. The emoji left the park button.
 *     The triage, the fill and the publish flow are unchanged.
 *   v1.0.1 — 2026-09-13 — Each phase's actions sit in the dialog's footer.
 *   v1.0.0 — 2026-06-21 — Extracted from inbox-tab.js so the Notebook can reuse it; + park-to-notebook.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Dialog, Action, Field, Stack, Text } from '/components/poster-parts.js';
import { Spinner } from './shared.js';
import * as tracked from '/js/services/tracked-responses.js';
import { parkMessageToNotebook } from '/js/services/notebook.js';
import { writeDraft, publishDraft, wsRoot } from '/js/services/organisms.js';
import { NB_STEPS, firstLine } from './notebook-helpers.js';

export function TrackResponseModal({ open, msg, onClose, onDone, showToast, defaultMode = 'approve', allowPark = true }) {
  const [phase, setPhase] = useState('classify');   // 'classify' | 'review' | 'error'
  const [aiErr, setAiErr] = useState(null);
  const [orgs, setOrgs] = useState([]);             // AI triage context: organisms → workspaces → recordTypes
  const [orgId, setOrgId] = useState('');
  const [wsId, setWsId] = useState('');
  const [namespace, setNamespace] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [replyMode, setReplyMode] = useState(defaultMode);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const sugRef = useRef({ workspaceId: '', namespace: '' });   // AI's suggested ws + record type (preselect)

  // On open: AI triage forms the FULL intent (organism + workspace + record TYPE + title + content).
  // Dropdown options come from the AI's context; the suggestion preselects everything. No AI key →
  // error phase (placement unavailable — but you can still park to the notebook).
  useEffect(() => {
    if (!open || !msg) return undefined;
    let cancelled = false;
    setPhase('classify'); setAiErr(null); setStep(0); setBusy(false); setReplyMode(defaultMode);
    setOrgs([]); setOrgId(''); setWsId(''); setNamespace('');
    const timer = setInterval(() => setStep(s => (s + 1) % NB_STEPS.length), 2200);
    (async () => {
      try {
        const result = await tracked.triageMessage(msg.body);
        if (cancelled) return;
        const sug = result?.suggestion || {};
        const ctxOrgs = result?.context?.organisms || [];
        setOrgs(ctxOrgs);
        sugRef.current = { workspaceId: sug.workspaceId || '', namespace: sug.namespace || '' };
        setTitle((sug.title || firstLine(msg.body) || '').slice(0, 120));
        setContent(sug.markdown || msg.body || '');
        setOrgId(ctxOrgs.some(o => o.id === sug.organismId) ? sug.organismId : (ctxOrgs[0]?.id || ''));
        setPhase('review');
      } catch (e) {
        if (cancelled) return;
        setAiErr({ message: e?.message || '', code: e?.code }); setPhase('error');
      } finally { clearInterval(timer); }
    })();
    return () => { cancelled = true; clearInterval(timer); };
    // defaultMode only seeds the initial replyMode; this effect runs the expensive AI triage and must
    // re-run only when the modal opens / the message changes, never when defaultMode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, msg]);

  const org = orgs.find(o => o.id === orgId);
  // Memoized so it is a stable dependency for the record-type effect below (else a fresh [] each render).
  const workspaces = useMemo(() => org?.workspaces || [], [org]);
  const recTypes = workspaces.find(w => w.id === wsId)?.recordTypes || [];

  // Organism chosen → preselect the AI's suggested workspace when valid.
  useEffect(() => {
    if (!org) { setWsId(''); return; }
    const sug = sugRef.current;
    if (!org.workspaces.some(w => w.id === wsId)) {
      setWsId(org.workspaces.some(w => w.id === sug.workspaceId) ? sug.workspaceId : (org.workspaces[0]?.id || ''));
    }
  }, [orgId, orgs, org, wsId]);

  // Workspace chosen → preselect the AI's suggested record type when valid.
  useEffect(() => {
    const types = workspaces.find(w => w.id === wsId)?.recordTypes || [];
    if (!types.length) { setNamespace(''); return; }
    if (types.some(tp => tp.namespace === namespace)) return;
    const sug = sugRef.current;
    setNamespace(types.some(tp => tp.namespace === sug.namespace) ? sug.namespace : types[0].namespace);
  }, [wsId, orgs, namespace, workspaces]);

  const close = () => { if (!busy) onClose?.(); };

  const submit = async () => {
    if (busy || !msg) return;
    if (!orgId || !wsId || !namespace) { showToast?.(t('inbox.trackPickTarget'), true); return; }
    setBusy(true);
    try {
      const recordId = 'rec-' + Math.random().toString(36).slice(2, 10);
      // Schema-aware fill: the AI builds the value to conform to THIS record type's actual schema (any
      // shape) + derives the schema-correct completion condition + inject field. Validated server-side.
      const fill = await tracked.fillRecord({ organismId: orgId, ws: wsId, namespace, recordId, message: msg.body, title, content });
      if (!fill?.value) throw new Error(t('inbox.trackFailed'));
      // Proper workspace flow: write a DRAFT then PUBLISH (activity feed + right owner + publish gate).
      const wr = await writeDraft(orgId, wsId, namespace, recordId, fill.value);
      if (wr?.ok === false) throw new Error(wr.error?.message || t('inbox.trackFailed'));
      const pub = await publishDraft(orgId, wsId, namespace, recordId);
      const gated = pub?.ok === false || pub?.data?.gated === true || /gate|approv/i.test(pub?.error?.code || '');
      const watchKey = `${wsRoot(orgId, wsId)}.${namespace}.${recordId}.latest`;
      await tracked.createTrackedResponse({
        messageId: msg.id,
        title: title.trim() || undefined,
        watch: { key: watchKey, condition: fill.condition },
        response: { mode: replyMode, inject: fill.inject?.field ? { from: 'watch.value', field: fill.inject.field } : undefined },
        references: { organismId: orgId, workspaceId: wsId, records: [{ namespace, id: recordId }] },
      });
      showToast?.(gated ? t('inbox.trackCreatedGated') : t('inbox.trackCreated'));
      onDone?.(); onClose?.();
    } catch (e) {
      showToast?.(e?.message || t('inbox.trackFailed'), true);
    }
    setBusy(false);
  };

  // Park to the notebook for later — keeps the source link + reply intent; processed later from there.
  const park = async () => {
    if (busy || !msg) return;
    setBusy(true);
    try {
      await parkMessageToNotebook(msg, { title: title || firstLine(msg.body), content: content || msg.body, mode: replyMode });
      showToast?.(t('inbox.trackParked'));
      onDone?.(); onClose?.();
    } catch (e) {
      showToast?.(e?.message || t('inbox.trackFailed'), true);
    }
    setBusy(false);
  };

  const parkBtn = allowPark ? html`<${Action} disabled=${busy} onClick=${park}>${t('inbox.trackPark')}<//>` : null;

  const footer = phase === 'error' ? html`
      <${Action} kind="text" disabled=${busy} onClick=${onClose}>${t('common.cancel')}<//>
      ${parkBtn}
      <${Action} disabled=${busy} onClick=${() => { window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'mcp' } })); onClose?.(); }}>${t('inbox.trackConfigureAi')}<//>`
    : phase === 'review' ? html`
      <${Action} kind="text" disabled=${busy} onClick=${close}>${t('common.cancel')}<//>
      ${parkBtn}
      <${Action} kind="primary" disabled=${busy || !namespace} onClick=${submit}>
        ${busy ? t('inbox.trackCreating') : t('inbox.trackCreate')}
      <//>`
    : null;
  const opts = (list, value, label) => list.map(x => ({ value: x[value], label: x[label] || x[value] }));

  return html`
    <${Dialog} open=${open} onClose=${close} title=${t('inbox.trackResponse')} actions=${footer}>
      ${phase === 'classify' ? html`
        <${Stack} align="center">
          <${Spinner} />
          <${Text}>${t('inbox.trackAiThinking')}<//>
          <${Text} kind="caption" tone="muted">${t(NB_STEPS[step]) || ''}<//>
        <//>` : null}

      ${phase === 'error' ? html`
        <${Stack}>
          <${Text}>${t('inbox.trackNeedsAi')}<//>
          ${aiErr?.message ? html`<${Text} tone="danger">${aiErr.message}<//>` : null}
        <//>` : null}

      ${phase === 'review' ? html`
        <${Stack}>
          <${Text} tone="muted">${t('inbox.trackHintAi')}<//>
          <${Field} type="select" label=${t('inbox.trackOrganism')} value=${orgId}
            options=${opts(orgs, 'id', 'name')} onChange=${(e) => { setOrgId(e.target.value); setWsId(''); }} />
          <${Field} type="select" label=${t('inbox.trackWorkspace')} value=${wsId} disabled=${!orgId}
            options=${[{ value: '', label: t('inbox.trackChoose') }, ...opts(workspaces, 'id', 'name')]} onChange=${(e) => setWsId(e.target.value)} />
          <${Field} type="select" label=${t('inbox.trackType')} value=${namespace} disabled=${!recTypes.length}
            options=${recTypes.length === 0 ? [{ value: '', label: t('inbox.trackNoTypes') }] : opts(recTypes, 'namespace', 'name')}
            onChange=${(e) => setNamespace(e.target.value)} />
          <${Field} label=${t('inbox.trackTitle')} value=${title} onInput=${(e) => setTitle(e.target.value)} />
          <${Field} type="textarea" rows=${4} label=${t('inbox.trackContent')} value=${content} onInput=${(e) => setContent(e.target.value)} />
          <${Field} type="select" label=${t('inbox.trackReplyMode')} value=${replyMode} onChange=${(e) => setReplyMode(e.target.value)}
            options=${[{ value: 'approve', label: t('inbox.trackModeApprove') }, { value: 'auto', label: t('inbox.trackModeAuto') }]} />
          <${Text} kind="caption" tone="muted">${t('inbox.trackFillNote')}<//>
        <//>` : null}
    <//>`;
}
