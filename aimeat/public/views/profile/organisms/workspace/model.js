/**
 * @file public/views/profile/organisms/workspace/model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure derived-state + view-model builders for the organism workspace: the merged
 *   draft/published record & document lists, the public-sharing helpers, the activity-title
 *   resolver, and the grouped-tab model (groups, active tab/space/group, tab pickers). Plus the
 *   breadcrumb builder. No hooks — just computation over the loaded workspace + component state,
 *   assembled once per render by the parent Workspace. Extracted from workspace.js to satisfy
 *   max-file-lines with no behaviour change.
 * @structure buildBreadcrumb, buildWorkspaceModel
 * @usage import { buildWorkspaceModel } from '/views/profile/organisms/workspace/model.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — copyShareLink removed — the share panel uses a shared <CopyButton>. Its "Copy failed" branch
 *       is not a loss: it only fired when navigator.clipboard rejected, exactly the case the shared
 *       helper handles by falling back to execCommand and succeeding.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { cap, PRIMARY_FIELD } from './helpers.js';

// Same breadcrumb pattern as the organism home: Organisms / {org} / {workspace} — both ancestors
// are links, so the list is one click away from inside a workspace too.
export function buildBreadcrumb(ctx) {
  const { onBack, onBackToList, org, showSettings, guardWsDirty, setShowSettings, wsName, ws } = ctx;
  return html`
    <div class="pj-org-breadcrumb">
      <button class="pj-org-crumb-link" onClick=${onBackToList || onBack}>${t('organisms.title') || 'Organisms'}</button>
      <span class="pj-org-crumb-sep">/</span>
      <button class="pj-org-crumb-link" onClick=${onBack}>${(org.name || org.id || '')}</button>
      <span class="pj-org-crumb-sep">/</span>
      ${showSettings ? html`
        <button class="pj-org-crumb-link" onClick=${() => guardWsDirty(() => setShowSettings(false))}>${(wsName || ws?.manifest?.name || '…')}</button>
        <span class="pj-org-crumb-sep">/</span>
        <span>${t('organisms.settings') || 'Settings'}</span>
      ` : html`<span>${(wsName || ws?.manifest?.name || '…')}</span>`}
    </div>`;
}

// Build the whole derived view-model for a loaded workspace. `loadShare` stays in the parent (it is
// referenced by an earlier lazy-load effect); everything else that derives from ws/state lives here.
export function buildWorkspaceModel(ctx) {
  const {
    ws, share, setShare, setShareBusy, orgId, wsId, showToast, tab, showSettings, approvals, wsT,
    guardWsDirty, setShowSettings, setTab, markSeen, setPendingScroll, copyAccessPrompt, copyContractPrompt,
  } = ctx;

  // Memory-backed spaces render normally (missing backing counts as memory — the shared service
  // predicate mirrors the server's). Every OTHER declared space still renders, as a notice card — a
  // space the manifest declares must never silently vanish from the view (that's how published
  // documents once became unfindable: writes succeeded, every list surface skipped the space).
  const allTypes = ws.manifest?.objectTypes || [];
  const types = allTypes.filter(orgService.isMemorySpace);
  const isDocSpace = orgService.isDocSpace;
  const draftsFor = (name) => (ws.drafts && ws.drafts[name]) || [];
  const objectsFor = (name) => (ws.objects && ws.objects[name]) || [];
  // One entry per id, draft (working copy) taking precedence over its published version —
  // the index must show the draft badge even when a published `.latest` also exists.
  const mergedDocs = (ot) => {
    const byId = new Map();
    for (const d of objectsFor(ot.name)) byId.set(d.id, { ...d, _draft: false, _published: true });
    for (const d of draftsFor(ot.name)) {
      const pub = byId.get(d.id);   // kept on `_pub` for the view's Draft/Published toggle
      byId.set(d.id, { ...d, _draft: true, _published: !!pub, _pub: pub || null });
    }
    return [...byId.values()];
  };
  const mergedRecords = (ot) => {
    const byId = new Map();
    for (const o of objectsFor(ot.name)) byId.set(o.id, { ...o, _draft: false });
    for (const d of draftsFor(ot.name)) byId.set(d.id, { ...d, _draft: true });
    return [...byId.values()];
  };

  // ── Public sharing (meta.share) — what published document-space pages anyone can read via the
  // no-login viewer. Independent of the access roles. Lazy-loaded the first time the panel opens. ──
  const docTypes = types.filter(isDocSpace);
  const patchShare = async (patch) => {
    setShareBusy(true);
    try { setShare(await orgService.setWorkspaceShare(orgId, wsId, patch)); }
    catch (e) { showToast((e && e.message) || (t('organisms.shareFailed') || 'Failed to update sharing')); }
    finally { setShareBusy(false); }
  };
  // Effective public state of one doc — mirrors the backend: doc override → space flag → workspace flag.
  const isDocPublic = (typeName, id) => {
    if (!share) return false;
    const dk = `${typeName}/${id}`;
    if (Object.prototype.hasOwnProperty.call(share.docs || {}, dk)) return !!share.docs[dk];
    if (Object.prototype.hasOwnProperty.call(share.spaces || {}, typeName)) return !!share.spaces[typeName];
    return !!share.public;
  };
  const anythingPublic = () => !!share && (!!share.public
    || Object.values(share.spaces || {}).some(Boolean) || Object.values(share.docs || {}).some(Boolean));
  // Resolve an activity-feed event's instance id to a human title (document title / record primary
  // field), so the feed reads "published · Techstack-matriisi" instead of "published · doc-76qchtb".
  // Falls back to the id when the item isn't in the loaded set (deleted, or not readable).
  const instanceTitle = (typeName, id) => {
    const rec = [...objectsFor(typeName), ...draftsFor(typeName)].find(x => x.id === id);
    if (!rec) return id;
    return rec.title || rec.label || rec.summary || rec.name || rec[PRIMARY_FIELD[typeName]] || id;
  };

  // ── Grouped tabs. The flat row got unwieldy as workspaces grew many spaces, so the nav is now
  // organised into groups (in this order): "Workspace related" (the static panels), "Records" and
  // "Document spaces" (memory-backed object types with no contract), then ONE group per contract —
  // each contract is a self-contained unit, so its spaces travel together. A space declaring a
  // `contract` id appears ONLY in that contract's group (never duplicated under Records/Documents).
  // Space labels are capitalized so the row reads uniformly next to the fixed tabs.
  const spaceCount = (name) => new Set([...draftsFor(name), ...objectsFor(name)].map(d => d.id)).size;
  // What a space is for — shown under its title when opened, so a bare "Gap" record reads in context.
  // Manifest i18n "type.<name>.desc" wins; the objectType's own `description` is the fallback.
  const spaceDesc = (ot) => wsT('type.' + ot.name + '.desc') || (typeof ot.description === 'string' ? ot.description : '');
  const spaceTab = (ot) => ({
    id: 'space:' + ot.name, ot, label: cap(wsT('type.' + ot.name) || ot.name),
    count: orgService.isMemorySpace(ot) ? spaceCount(ot.name) : null,
  });

  // Distinct contract ids in first-seen manifest order; the rest split by mode.
  const contractIds = [];
  for (const ot of allTypes) { if (ot.contract && !contractIds.includes(ot.contract)) contractIds.push(ot.contract); }
  const noContract = allTypes.filter(ot => !ot.contract);
  const recordTypes = noContract.filter(ot => !isDocSpace(ot));
  const docSpaceTypes = noContract.filter(ot => isDocSpace(ot));

  const relatedMembers = [
    { id: 'overview', label: t('organisms.tabOverview') || 'Overview', count: null },
    { id: 'activity', label: t('organisms.activity') || 'Activity', count: null },
    { id: 'people', label: t('organisms.tabPeople') || 'People', count: null },
    { id: 'share', label: t('organisms.share') || 'Share', count: null },
    { id: 'sources', label: t('organisms.sources') || 'Sources', count: null },
    { id: 'skills', label: t('skills.wsTabLabel') || 'Skills', count: null },
    { id: 'review', label: t('organisms.tabReview') || 'Review', count: approvals.length || null },
  ];
  const stackedGroup = (id, label, desc, spaces) => ({
    id, kind: 'stacked', label, desc, spaces, members: spaces.map(spaceTab),
    count: spaces.reduce((n, ot) => n + (orgService.isMemorySpace(ot) ? spaceCount(ot.name) : 0), 0) || null,
  });
  const groups = [{ id: 'related', kind: 'related', label: t('organisms.groupRelated') || 'Workspace', members: relatedMembers }];
  if (recordTypes.length) groups.push(stackedGroup('group:records', t('organisms.groupRecords') || 'Records', t('organisms.groupRecordsDesc') || '', recordTypes));
  if (docSpaceTypes.length) groups.push(stackedGroup('group:documents', t('organisms.groupDocs') || 'Document spaces', t('organisms.groupDocsDesc') || '', docSpaceTypes));
  for (const cid of contractIds) {
    groups.push(stackedGroup('group:contract:' + cid, cid,
      (t('organisms.groupContractDesc') || 'Spaces provided by the {id} contract.').replace('{id}', cid),
      allTypes.filter(ot => ot.contract === cid)));
  }

  // Valid ids: overview + the static panels, a focused single space ("space:<name>"), or a stacked group.
  const validTabIds = new Set(['overview', ...relatedMembers.map(m => m.id), ...allTypes.map(ot => 'space:' + ot.name), ...groups.filter(g => g.kind === 'stacked').map(g => g.id)]);
  // Settings REPLACES the tab content: while it is open no tab is active (the previous state — a
  // highlighted tab above settings content — lied about what the user was looking at).
  const activeTab = showSettings ? '' : (validTabIds.has(tab) ? tab : 'overview');
  const activeSpace = activeTab.startsWith('space:') ? allTypes.find(ot => ot.name === activeTab.slice(6)) : null;
  const activeGroup = activeTab.startsWith('group:') ? groups.find(g => g.id === activeTab) : null;
  // Opening a tab clears its unseen badge (the seen mark persists across sessions).
  const pickTab = (id) => guardWsDirty(() => { setShowSettings(false); setTab(id); markSeen(id); });
  // A stacked group opens at its top; clicking one of its spaces opens it scrolled to that section.
  const openGroup = (id) => pickTab(id);
  const scrollToSpace = (gid, name) => guardWsDirty(() => { setShowSettings(false); setTab(gid); setPendingScroll(name); markSeen(gid); });

  // Static one-line descriptions for the related panels that don't already carry their own.
  const REL_DESC = {
    overview: t('organisms.descOverview') || '',
    activity: t('organisms.descActivity') || '',
    sources: t('organisms.descSources') || '',
    review: t('organisms.descReview') || '',
  };

  // Menu items are VERBS (a click copies to the clipboard; the toast confirms). The contract-agent
  // builder is a different category from the two copy actions, so a divider separates it.
  const agentMenuItems = [
    { label: t('organisms.copyChatPrompt') || 'Copy chat prompt', icon: '💬', onClick: () => copyAccessPrompt('human') },
    { label: t('organisms.copyCodingPrompt') || 'Copy coding agent prompt', icon: '⌨', onClick: () => copyAccessPrompt('agent') },
    { divider: true },
    { label: t('organisms.contractPrompt') || 'Create contract agent', icon: '⚙️', onClick: copyContractPrompt },
  ];

  return {
    allTypes, types, isDocSpace, draftsFor, objectsFor, mergedDocs, mergedRecords, docTypes,
    patchShare, isDocPublic, anythingPublic, instanceTitle, spaceDesc, groups,
    activeTab, activeSpace, activeGroup, pickTab, openGroup, scrollToSpace, REL_DESC, agentMenuItems,
  };
}
