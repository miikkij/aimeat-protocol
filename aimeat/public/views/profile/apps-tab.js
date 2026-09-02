/**
 * @file apps-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Apps: the person's published apps as a page about their state, not a
 *   card per app. What waits for them (drafts and the apps acting in their name), what the apps
 *   are missing as seven numbers that open the launcher on exactly those rows, the six that
 *   changed last, the agents and skills around them, and how a new one starts. Holds the state,
 *   the loads and the handlers; renders the poster face (apps/page.js, apps/build.js). Live:
 *   re-fetches on the aimeat-live-update event for apps and skills.
 * @structure AppsTab — state, loads, handlers, the ctx bag, render
 * @usage Registered in views/profile.js TABS as id 'apps'.
 * @version-history
 *   v2.0.0 — 2026-09-02 — The poster face (design canvas "AIMEAT Sovellukset-sivu", direction A).
 *     The card per app is gone: on the production node that was 155 cards, 61 screens and 166
 *     requests on open (the list twice, one skill fetch per card). Skills are read once through the
 *     owner's skill list and their bindings; the datamap, access code, park, delete, details and
 *     skill attach live in the launcher, which had them already; the crew-definition editor moved
 *     to the agents section; the gallery of every app on the node left this page, the launcher's
 *     Community view is that list. Drafts can be published, discarded and read as a line diff
 *     here; app grants can be read and revoked here.
 *   v1.8.0 — 2026-08-24 — Live update, both halves.
 *   v1.7.0 — 2026-07-17 — Agent-Bundled Apps Slice 2: the Deploy panel.
 *   v1.6.0 — 2026-07-16 — Agent-Bundled Apps: the "ships an agent" badge and Deploy/Undeploy.
 *   v1.5.0 — 2026-07-06 — Bound skills per card.
 *   v1.4.0 — 2026-06-26 — "Edit details" per card.
 *   v1.3.0 — 2026-06-24 — The operator-hidden badge.
 *   v1.2.0 — 2026-06-20 — Park/Unpark.
 *   v1.1.0 — 2026-03-19 — Launch button.
 *   v1.0.0 — 2026-03-17 — Refactor: CSS utility classes.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { listApps, uploadApp, patchApp } from '/js/services/apps.js';
import * as skillsService from '/js/services/skills.js';
import { apiGet, apiGetText, apiPost, apiDelete } from '/js/api.js';
import { recordRecent } from '/js/recents.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { a, appRef, nameOf, computeKunto, lineDiff } from './apps/frame.js';
import { buildAgentAuthoringPrompt } from './apps/build.js';
import { renderPage } from './apps/page.js';

export default function AppsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [apps, setApps] = useState(null);          // the owner's apps, null while loading
  const [community, setCommunity] = useState(0);   // other people's apps on this node
  const [communityOwners, setCommunityOwners] = useState(0);
  const [bound, setBound] = useState({});          // "owner/filename" → the skills bound to it
  const [grants, setGrants] = useState([]);
  const [buildPrompt, setBuildPrompt] = useState('');
  const [busy, setBusy] = useState(null);          // the row or job in flight
  const [diff, setDiff] = useState(null);          // { ref, state, result } for the one open draft
  const [openScopes, setOpenScopes] = useState(null);
  const [agentEditorOpen, setAgentEditorOpen] = useState(false);
  const [agentPick, setAgentPick] = useState('');
  const [agentJson, setAgentJson] = useState('[]');

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);

  /* ── loads ── */

  // onStats is not guaranteed memoized by the parent; read it through a ref so the load keys on
  // the session alone. With it in the deps the list was fetched twice on every open.
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const load = useCallback(async () => {
    // Three reads, kept apart: a failure on the skills or the grants must not blank the list.
    try {
      const list = await listApps();
      const own = list.filter((x) => x.owner === session.owner);
      const others = list.filter((x) => x.owner !== session.owner);
      setApps(own);
      setCommunity(others.length);
      setCommunityOwners(new Set(others.map((x) => x.owner)).size);
      onStatsRef.current?.({ apps: own.length });
    } catch (err) { swallowed('apps-tab', err); setApps([]); }
    try {
      // One read for every app: the owner's skills carry their bindings, so the page never asks
      // per app (155 requests on the production node before this).
      const mine = await skillsService.listScope('user');
      const map = {};
      for (const s of mine || []) {
        const b = s.metadata?.binding || s.binding || '';
        if (!b.startsWith('app:')) continue;
        const ref = b.slice(4);
        (map[ref] = map[ref] || []).push(s);
      }
      setBound(map);
    } catch (err) { swallowed('apps-tab: skills', err); setBound({}); }
    try {
      const res = await apiGet('/v1/app-grants');
      setGrants(res?.data?.grants || []);
    } catch (err) { swallowed('apps-tab: grants', err); setGrants([]); }
  }, [session]);

  useEffect(() => { if (session) load(); }, [session, load]);
  const liveRef = useRef(null);
  liveRef.current = () => { if (session) load(); };
  useEffect(() => onLiveUpdate(['apps', 'skills'], () => liveRef.current()), []);

  useEffect(() => {
    // The build prompt is read once so the copy button has its text at the click: a clipboard
    // write that waits for a fetch loses the gesture in most browsers.
    apiGet('/v1/prompts/build-app')
      .then((res) => setBuildPrompt(res?.data?.prompt || ''))
      .catch((err) => swallowed('apps-tab: build prompt', err));
  }, []);

  /* ── drafts ── */

  function publishDraft(app) {
    const ref = appRef(app);
    confirm(a('publishConfirm', { name: nameOf(app) }), async () => {
      setBusy(ref);
      try {
        await apiPost(`/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}/publish-draft`, {});
        showToast?.(a('draftPublishedToast', { name: nameOf(app) }));
        if (diff?.ref === ref) setDiff(null);
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(null); }
    });
  }

  function discardDraft(app) {
    const ref = appRef(app);
    confirm(a('discardConfirm', { name: nameOf(app) }), async () => {
      setBusy(ref);
      try {
        await apiDelete(`/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}/draft`);
        showToast?.(a('draftDiscardedToast', { name: nameOf(app) }));
        if (diff?.ref === ref) setDiff(null);
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(null); }
    }, { danger: true });
  }

  async function toggleDiff(app) {
    const ref = appRef(app);
    if (diff?.ref === ref) { setDiff(null); return; }
    setDiff({ ref, state: 'loading' });
    try {
      const path = `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}`;
      const [draftRes, live] = await Promise.all([apiGet(`${path}/draft`), apiGetText(path)]);
      const bytes = Uint8Array.from(atob(draftRes?.data?.content || ''), (c) => c.charCodeAt(0));
      const draftText = new TextDecoder().decode(bytes);
      setDiff({ ref, state: 'ready', result: lineDiff(live, draftText) });
    } catch (err) { swallowed('apps-tab: diff', err); setDiff({ ref, state: 'failed' }); }
  }

  /* ── grants ── */

  function revokeGrant(g) {
    confirm(a('revokeConfirm', { name: g.app_name || g.app }), async () => {
      setBusy(g.grant_id);
      try {
        await apiDelete(`/v1/app-grants/${encodeURIComponent(g.grant_id)}`);
        showToast?.(a('revokedToast', { name: g.app_name || g.app }));
        if (openScopes === g.grant_id) setOpenScopes(null);
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(null); }
    }, { danger: true });
  }

  /* ── the finished file ── */

  async function upload({ file, description, screenshot, accessCode }) {
    if (!file) { showToast?.(a('fileRequired'), true); return false; }
    if (!description || !description.trim()) { showToast?.(a('descRequired'), true); return false; }
    const readFile = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(/** @type {string} */ (r.result).split(',')[1]); r.readAsDataURL(f); });
    setBusy('upload');
    try {
      const opts = { description: description.trim() };
      if (accessCode) opts.accessCode = accessCode;
      if (screenshot) { opts.screenshotBase64 = await readFile(screenshot); opts.screenshotMimeType = screenshot.type || 'image/png'; }
      const resp = await uploadApp(file.name, await readFile(file), file.type || 'text/html', opts);
      if (resp?.ok === false) throw new Error(resp?.error?.message || a('uploadFailed'));
      showToast?.(a('uploaded'));
      await load();
      return true;
    } catch (e) { fail(e, a('uploadFailed')); return false; }
    finally { setBusy(null); }
  }

  /* ── the crew-definition editor ── */

  function pickAgentApp(filename) {
    setAgentPick(filename);
    const app = (apps || []).find((x) => x.filename === filename);
    setAgentJson(JSON.stringify(app?.manifest?.cortex?.agents ?? [], null, 2));
  }

  function agentPromptFor(app) {
    let current;
    try { current = JSON.parse(agentJson); } catch { current = app.manifest?.cortex?.agents ?? []; }   // eslint-disable-line aimeat/no-silent-catch -- invalid JSON in the editor is expected mid-typing
    return buildAgentAuthoringPrompt(app, current);
  }

  async function saveAgents(app) {
    let parsed;
    try { parsed = JSON.parse(agentJson.trim() || '[]'); }
    catch (err) { showToast?.(a('agentJsonInvalid') + ': ' + err.message, true); return; }
    if (!Array.isArray(parsed)) { showToast?.(a('agentJsonNotArray'), true); return; }
    setBusy('agents');
    try {
      const resp = await patchApp(app.filename, { cortex: { agents: parsed } });
      if (resp?.ok === false) throw new Error(resp?.error?.message || t('profile.error'));
      showToast?.(parsed.length ? a('agentEditSaved') : a('agentEditCleared'));
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(null); }
  }

  /* ── the chat road for what is already published ── */

  function managePrompt() {
    const names = (apps || []).slice(0, 15).map((x) => `${nameOf(x)} (${appRef(x)})`).join('\n- ');
    return `Help me look after my AIMEAT apps through the MCP tools. My apps (first ${Math.min(15, (apps || []).length)} of ${(apps || []).length}):
- ${names || '(none yet)'}

What you can do here, all through the tools: aimeat_app_list and aimeat_app_get read an app; aimeat_app_publish updates it; aimeat_app_draft_* edit the next version without touching the live one; aimeat_app_versions lists what shipped; aimeat_app_screenshot sets the picture; aimeat_app_seo_set decides whether search engines see it; aimeat_app_legal_set writes its legal pages; aimeat_app_marks_set sets the served chrome; aimeat_app_audit reads its log.

Start by asking me which app and what I want changed. Fill a data map (aimeat_datamap_set) or declare AI use when an app has neither, and say what you did.`;
  }

  const recordOpen = (app) => recordRecent({ type: 'app', id: appRef(app), label: nameOf(app), data: { owner: app.owner, filename: app.filename } });

  const ctx = {
    session, apps, community, communityOwners, bound, grants, buildPrompt, busy, diff, openScopes,
    kunto: computeKunto(apps || [], bound), ConfirmUI, showToast,
    publishDraft, discardDraft, toggleDiff, revokeGrant, toggleScopes: (g) => setOpenScopes(openScopes === g.grant_id ? null : g.grant_id),
    upload, recordOpen, managePrompt,
    agentEditorOpen, setAgentEditorOpen, agentPick, pickAgentApp, agentJson, setAgentJson, agentPromptFor, saveAgents,
  };
  return renderPage(ctx);
}
