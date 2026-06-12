/**
 * @file organisms-tab.js
 * @description Profile tab for managing organisms (groups, communities, teams).
 *   Allows creating, editing, joining, leaving, and deleting organisms.
 *   Displays user's organisms and a public discovery section.
 * @structure
 *   - OrganismsTab — main exported component
 *   - renderEditForm — inline edit form for an organism
 *   - renderOrgCard — card component for a single organism
 * @usage
 *   import OrganismsTab from '/views/profile/organisms-tab.js';
 *   <OrganismsTab session={session} showToast={showToast} onStats={onStats} />
 * @version-history
 *   v1.0.0 — 2026-03-17 — Remove all inline style attributes; use CSS utility classes
 *   v1.1.0 — 2026-06-08 — Doc index merges draft+published per id (draft badge no longer hidden by a
 *     published version); editor hydrates private /v1/storage images to auth'd blob URLs; new
 *     DocumentView with a Draft/Published comparison toggle.
 *   v1.2.0 — 2026-06-08 — DocumentView resolves storage images in the markdown text (re-render-safe,
 *     fixes broken image after toggling versions); saving a draft opens it (no more empty state);
 *     open workspace + document persist to sessionStorage so an F5 returns to where you were.
 *   v1.3.0 — 2026-06-08 — Per-image visibility panel in the editor (badge + toggle + "make all
 *     public"); save rewrites each image URL to match its visibility (public → /v1/pub/<ghii>/<key>
 *     so other viewers can load it, private → /v1/storage/<key> owner-only).
 *   v1.4.0 — 2026-06-08 — SourcesPanel: attach memory/storage/knowledge references (own or external/
 *     discover) the workspace draws on; pointers only, stored at organism.{id}.meta.sources.
 *   v1.5.0 — 2026-06-08 — UI pass to reuse core primitives + readability: doc view shows Created/
 *     Last-saved/Published (KeyValueRow + dt); canonical .seg replaces per-view version/picker tabs;
 *     VisibilityPill + EmptyState + SearchBar + fmtBytes reused; "move…" dropdown dropped (drag-and-
 *     drop only); recognizable upload button; tree/detail/panels recolored (white cards on the gray
 *     section so a selected item's accent actually stands out); "File visibility" rename.
 *   v1.6.0 — 2026-06-08 — Multi-workspace: an organism opens to a WorkspaceList (registry at
 *     organism.{id}.meta.workspaces); each workspace is independent (data under …w.{wsId}.*), with
 *     New/open/delete + F5 restore of openWs. wsId threaded through Workspace + SourcesPanel. Also:
 *     split genBusy/applyBusy so Generate and Validate&apply spin independently.
 *   v1.7.0 — 2026-06-08 — Records are viewable/editable (not just publishable): a draft has Edit
 *     (SchemaForm pre-filled, gated on schema load so it seeds) + click-to-expand field view
 *     (KeyValueRow); published records expand too. "+ Space" surfaced in the workspace bar (was
 *     Settings-only) with an inline document/records add form.
 *   v1.8.0 — 2026-06-08 — "AI access prompt" buttons (For chat / For coding agent) copy a ready
 *     prompt teaching an AI how to access + use THIS workspace (full schema inlined) — bridges the
 *     MCP discovery gap. See orgService.buildAccessPrompt.
 *   v1.9.0 — 2026-06-08 — Two deterministic Mermaid charts (vendored renderer, lazy-loaded): an
 *     organism Overview (members/agents/workspaces+structure/knowledge/federation-consent) at the
 *     top of the workspace list, and the manifest-defined edit→publish→version flow as the first
 *     item inside a workspace. Built from stable data — orgService.buildOrganismOverviewMermaid /
 *     buildEditFlowMermaid.
 *   v1.10.0 — 2026-06-08 — Per-workspace access control in WorkspaceList: discovers all org
 *     workspaces (not just own), shows access status, a "Request access" button for locked ones, and
 *     a request inbox (approve/deny/revoke) on workspaces you created.
 *   v1.11.0 — 2026-06-09 — Workspace backup: Export (⬇ on each owned card, downloads a ZIP) + Import
 *     (⬆ in the bar, uploads a ZIP → new workspace) buttons.
 *   v1.12.0 — 2026-06-09 — Organism-level backup: "Export organism" (whole org ZIP) in the org view +
 *     "Import organism" (→ new org) in the My Organisms header.
 *   v1.13.0 — 2026-06-09 — Workspace header restyle: parent-organism breadcrumb so you always see
 *     which organism the workspace is in; status badge moved inline with the name; the action row
 *     became a tinted .pj-toolbar (consistent buttons + vertical separators, review-gate pushed
 *     apart); "+ Space" relabelled "+ Document space"; horizontal dividers split header / charts /
 *     manifest panels; section-head add-actions sit next to their title and lift off the panel.
 *   v1.14.0 — 2026-06-09 — ParticipantsPanel "Manage who can work here" (creator-only): add a member by
 *     name with a role (viewer/contributor), switch roles, remove; approve/deny pending requests. New
 *     "Create contract agent" AI-prompt button (orgService.buildContractAgentPrompt) copies a full
 *     contract-agent build prompt for THIS workspace. See docs/agent-workspace-contracts.md.
 *   v1.15.0 — 2026-06-10 — Organisms list renew, phase 1: compact one-line rows (avatar, name, type,
 *     members/agents/date) with drag-and-drop manual ordering + a sort menu (My order / Name / Newest,
 *     persisted to user memory key organisms.ui); management actions move into a "…" kebab menu. New
 *     OrganismHome page (breadcrumb header + Export/Settings + Workspaces/Members/Agents/Board tabs)
 *     between the list and a workspace — Members/Agents tabs host the former in-card OrgMemberManager
 *     sections, Settings hosts the edit form + metadata + danger zone, Board links to the Boards tab.
 *     Nothing removed: every former card action has a new home (list "…" menu, home header, or a tab).
 *   v1.16.0 — 2026-06-10 — Row button "Open workspace" → "Open"; new 📁 workspace-count stat next to
 *     the members counter (lazy discoverWorkspaces per own org) so empty organisms are obvious.
 *   v1.17.0 — 2026-06-10 — No space silently vanishes: non-memory-backed spaces (backing 'tasks', or
 *     a legacy unsupported value like 'knowledge') render as a notice card instead of being filtered
 *     out — published content disappearing without a trace is how the invisible-documents bug hid for
 *     a month. Missing backing counts as memory; kind:'document' without mode renders as a doc space.
 *   v1.18.0 — 2026-06-10 — Workspace renew, phase 2: manifest-driven tabs — one tab per declared
 *     space (record/doc/unsupported-backing, manifest order, item counts) + fixed Review (approvals
 *     queue + publish-gate toggle, with a banner when items wait) / Activity (heatmap + decisions) /
 *     People (ParticipantsPanel) + a "+" pseudo-tab for add-space. Header gains a "For agents" menu
 *     (the 3 AI prompts) and Settings absorbs share / sources / edit-flow chart alongside the
 *     manifest form, spaces, restructure and danger zone. Old toolbar removed; nothing hidden —
 *     every former panel lives in a tab, the header menu, or Settings.
 *   v1.19.0 — 2026-06-10 — Organism-home tab contents redesigned (user feedback round): Agents tab
 *     gets OrgAgentsPanel — picker of own agents (free-text GAII behind "Advanced"), activity
 *     context per row. Workspaces tab: list first (map behind a 🗺 toggle), enriched rows
 *     (record/doc counts, last event, review pill), delete moved into the "…" menu, compact content
 *     search above the list. Members tab flipped: roster rows first (role badge, access line,
 *     joined date, "…" menu), "+ Invite" toggle, pending requests only when present + tab pill.
 *     Board tab: embedded preview (latest posts + composer) instead of a bare UUID + link. Red
 *     intra-tab titles dropped (the tab IS the title).
 *   v1.20.0 — 2026-06-10 — Organism Settings form redesigned: every field has a persistent label,
 *     grouped Identity / Access (with per-choice gray hints for join policy + visibility), interests
 *     as a TagInput (chips), read-only metadata collapsed to one line (Created · Creator · Board+copy;
 *     members/max moved to the Members tab), Save disabled until dirty (doubles as the unsaved
 *     indicator) + discard guard on settings-close/breadcrumb. Danger zone is its own red box with
 *     typed-name confirmation that states exactly what gets deleted (counted workspaces/records/docs).
 *   v1.20.1 — 2026-06-10 — Workspace breadcrumb unified with the organism home's: Organisms / {org} /
 *     {workspace} (registry name), both ancestors clickable — the list is one click away from inside
 *     a workspace (new onBackToList). Old "← Workspaces / 🧬 org" button row removed.
 *   v1.20.2 — 2026-06-10 — Fix: settings form opened EMPTY when the home mounted from an {id}-only
 *     stub (F5 before the list loaded) — the form now re-syncs whenever fresher org data arrives, as
 *     long as the user hasn't touched the fields. Workspace rows gain a clickable 👥 participants
 *     counter that expands an inline people list (like the access-request inbox).
 *   v1.21.0 — 2026-06-10 — Workspace settings adopts the organism-settings form pattern: meta line
 *     (template/last-saved), Identity + Agent policy groups, an autonomy hint, dirty-gated "Save
 *     changes" (no longer closes the panel) + reset-Cancel + discard guard on the ⚙ toggle (the
 *     populate effect only re-seeds untouched fields, so live updates never clobber typing). Spaces/
 *     Public-sharing headings restyled to group labels. Workspace-row counts get real singular/
 *     plural forms ("1 tietue", "{n} tietuetta").
 *   v1.22.0 — 2026-06-10 — SchemaForm usability: new records pre-fill `id` (editable, hinted) and
 *     requester-style fields (x-default:"currentUser" or requested_by/created_by/author names) with
 *     the signed-in GHII; Save draft is always clickable and a failed attempt outlines the still-empty
 *     required fields + lists them; readOnly (agent-filled) properties are hidden from the form and
 *     excluded from required; per-field hints from manifest i18n / schema description. Generated
 *     manifests can carry translations at manifest.i18n.{lang} ("{ns}.{field}", "{ns}.{field}.hint",
 *     "type.{name}") — used for form labels, record read-view labels, space tab + section titles.
 *   v1.23.0 — 2026-06-10 — Sources and Share are fixed workspace TABS (every workspace has them) —
 *     both had sunk into Settings, which read as "dropped entirely". Share lazy-loads on first tab
 *     open; Settings keeps form/spaces/chart/restructure/danger only. Fixed double-escaping: htm/
 *     preact already escapes text nodes, so every ${'${'}escHtml(...)} printed literal &amp; — all 75
 *     wrappers removed (titles like "Design & Architecture" now render correctly).
 *   v1.24.0 — 2026-06-10 — Members tab lists each member's agents (🤖 line, from the enriched members
 *     route) — same-owner agents inherit the membership implicitly, so "who can act here" is now
 *     visible instead of an unlisted-access audit gap.
 *   v1.25.0 — 2026-06-10 — Settings no longer lies about the tab state: it REPLACES the tab content
 *     (no tab highlighted while open; clicking a tab closes it via the dirty guard; breadcrumb gains
 *     "/ Settings") in BOTH the workspace and the organism home. Workspace settings reordered:
 *     savable form bounded in its own card (Identity + Agent policy + Save), Spaces gets an
 *     immediate-actions hint, Process group title for the edit-flow chart + restructure, dividers
 *     between groups, danger zone last with nothing after it. Autonomy options show meanings
 *     ("L3 — balanced"). "For agents" menu → "Agent access" with verb items ("Copy chat prompt",
 *     "Copy coding agent prompt") and a divider before "Create contract agent" (KebabMenu supports
 *     { divider: true }). Space tab labels capitalized to match the fixed tabs.
 *   v1.25.1 — 2026-06-10 — Manual space adding is DOCUMENT-ONLY (the "+" tab panel and the Settings
 *     add form lost their document/records selects): a hand-added record type would have no usable
 *     schema — record types are designed with AI via Settings → Process (restructure). The panel
 *     text says so.
 *   v1.25.2 — 2026-06-10 — Settings Cancel works again: it discards changes AND closes the panel
 *     (both organism + workspace settings) — the dirty-only reset variant did nothing visible on a
 *     clean form, which read as a dead button.
 *   v1.26.0 — 2026-06-10 — Contract-agent discovery: agents tagged 'workspace-contract' (+ optional
 *     'contract.<id>' names) surface to their OWNER — a 📜 block in the workspace People panel and a
 *     📜 badge/marker in the organism Agents tab picker + rows. Tag convention: docs/agent-workspace-
 *     contracts.md §7b; helpers offersWorkspaceContract/contractNamesOf in /js/services/agents.js.
 *   v1.27.0 — 2026-06-10 — One-click contract adoption: each contract chip gets an "Adopt <id>"
 *     button that queues the agreed adopt-contract TASK for the agent (scope[kind]=adopt-contract +
 *     organism_id/ws/contract, status:'queued' — the create default is draft and a draft never
 *     auto-activates; §7c) — the agent joins/provisions its own spaces and the task completion is
 *     the ack. An agent already working in THIS workspace (per the participants data) shows a
 *     "✓ active here" badge instead of Adopt. Convention agreed with the crewaimeat side 2026-06-10.
 *   v1.28.0 — 2026-06-12 — Overview landing tab: the whole workspace on one vertical scroll — a
 *     "what happened here" strip (last 8 activity events, humanized + clickable) above every
 *     manifest space stacked in order (records: compact rows max 5 + "Show all N →"; documents:
 *     title + first-line preview; empty space: one row with an Add button; non-memory backing:
 *     one notice row). Overview is ALWAYS the landing view (tab persistence dropped — it hid
 *     content). Mobile: sections collapse as accordions and documents expand INLINE (view+edit,
 *     no popout window). Per-tab unseen badges (gray, never red) from localStorage seen marks vs
 *     activity events — cleared when the tab opens, surviving across sessions; first visit seeds
 *     a baseline so history is never "unseen"; own non-agent edits don't count.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { Spinner, VisibilityPill } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { EmptyState } from '/components/EmptyState.js';
import { KeyValueRow } from '/components/KeyValueRow.js';
import { SearchBar } from '/components/SearchBar.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import * as knowledgeService from '/js/services/knowledge.js';
import { listAgents, offersWorkspaceContract, contractNamesOf, adoptContractTask } from '/js/services/agents.js';
import { getGhii } from '/js/services/auth.js';
import { listPosts, createPost } from '/js/services/boards.js';
import { OpenRouterSettings } from './generator-settings.js';
import { copyToClipboard } from '/js/utils.js';
import { dt, fmtBytes } from '/js/format.js';
import { recordRecent } from '/js/recents.js';
import { Markdown, slugifyHeading } from '/components/Markdown.js';
import { Mermaid } from '/components/Mermaid.js';

/** Date-only, formatted in the APP locale (browser locale may differ — fi must show 10.6.2026, not 6/10/2026). */
function fmtDate(s) {
  return new Date(s).toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : undefined);
}

/** Relative time for list metadata ("2 h ago" / "2 h sitten"); falls back to a locale date past 7 days. */
function relTime(s) {
  const ts = new Date(s).getTime();
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return (t('organisms.relMin') || '{n} min ago').replace('{n}', String(mins));
  const hours = Math.round(mins / 60);
  if (hours < 24) return (t('organisms.relHours') || '{n} h ago').replace('{n}', String(hours));
  const days = Math.round(hours / 24);
  if (days <= 7) return (t('organisms.relDays') || '{n} d ago').replace('{n}', String(days));
  return fmtDate(s);
}

/** Two-letter monogram for the list/home avatar (initials of the first two words, else first two chars). */
function orgInitials(name) {
  const s = String(name || '?').trim();
  const words = s.split(/\s+/).filter(Boolean);
  const ini = words.length >= 2 ? words[0][0] + words[1][0] : s.slice(0, 2);
  return ini.charAt(0).toUpperCase() + (ini.charAt(1) || '').toLowerCase();
}

/** "…" actions menu — items: { label, icon?, danger?, onClick } (falsy items are skipped). Closes on
 * outside click. Default trigger is a ⋮ icon button; pass trigger/btnClass for a labelled button. */
function KebabMenu({ items, label, trigger, btnClass }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  const visible = (items || []).filter(Boolean);
  if (visible.length === 0) return null;
  return html`
    <div class="pj-menu" ref=${ref}>
      <button class=${btnClass || 'pj-icon-btn pj-menu-btn'} title=${label} aria-haspopup="menu" aria-expanded=${open}
        onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>${trigger || '⋮'}</button>
      ${open ? html`
        <div class="pj-menu-pop" role="menu" onClick=${(e) => e.stopPropagation()}>
          ${visible.map((it, i) => it.divider
            ? html`<div class="pj-menu-sep" key=${'sep' + i}></div>`
            : html`
            <button class="pj-menu-item ${it.danger ? 'pj-menu-item-danger' : ''}" role="menuitem" key=${it.label}
              onClick=${() => { setOpen(false); it.onClick?.(); }}>${it.icon ? `${it.icon} ` : ''}${it.label}</button>`)}
        </div>` : null}
    </div>`;
}

/** Tag chips + inline input — Enter/comma adds, × or Backspace-on-empty removes, blur commits.
 *  Shows immediately how the value parses (vs. a raw "comma separated" text field). */
function TagInput({ tags, onChange, placeholder }) {
  const [val, setVal] = useState('');
  const add = () => { const v = val.trim().replace(/,+$/, ''); if (v && !tags.includes(v)) onChange([...tags, v]); setVal(''); };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !val && tags.length) onChange(tags.slice(0, -1));
  };
  return html`
    <div class="pj-taginput">
      ${tags.map(tag => html`
        <span class="file-tag pj-tag" key=${tag}>${(tag)}
          <button class="pj-tag-x" title="×" onClick=${() => onChange(tags.filter(x => x !== tag))}>×</button>
        </span>`)}
      <input class="pj-taginput-field" value=${val} placeholder=${placeholder || 'Add…'}
        onInput=${(e) => setVal(e.target.value)} onKeyDown=${onKey} onBlur=${add} />
    </div>`;
}

/** Download a whole-organism ZIP backup (used from the list "…" menu and the home header). */
async function exportOrganismZip(org, showToast) {
  try {
    const jwt = window.AIMEAT?.auth?.getSession?.()?.jwt || '';
    const res = await fetch(`/v1/organisms/${encodeURIComponent(org.id)}/export`, { headers: { Authorization: 'Bearer ' + jwt } });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `organism-${String(org.name || org.id).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { showToast((e && e.message) || 'Export failed'); }
}

/**
 * Content search inside an organism — case-insensitive substring over the records + documents of
 * every workspace the member can read. Backend: GET /v1/organisms/:id/search. Rendered in the
 * expanded card for members; opening a hit takes the user to that workspace.
 */
function OrgSearch({ orgId, onOpenWorkspace }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  const doSearch = async () => {
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(true);
    try {
      const r = await orgService.searchOrganism(orgId, query);
      setResults(r?.data?.results || []);
    } catch { setResults([]); }
    finally { setBusy(false); }
  };

  return html`
    <div class="pj-orgsearch">
      <div class="flex-row-wrap">
        <input class="input-field input-sm pj-orgsearch-input" placeholder=${t('organisms.searchPlaceholder') || 'Find records & documents…'} value=${q}
          onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') doSearch(); }} />
        <button class="btn-outline btn-sm" disabled=${busy || q.trim().length < 2} onClick=${doSearch}>${t('organisms.search') || 'Search'}</button>
      </div>
      ${results !== null && results.length === 0 ? html`<div class="section-desc">${t('organisms.searchNoResults') || 'No matches.'}</div>` : null}
      ${(results || []).map(r => html`
        <div class="pj-access-row card-clickable" key=${r.ws + '/' + r.space + '/' + r.id} role="button" onClick=${() => onOpenWorkspace?.(r.ws)}>
          <span>
            <b>${(r.title)}</b>
            <span class="pj-mini"> — ${(r.wsName || r.ws)} · ${(r.space)}</span>
            <div class="pj-mini">${(r.snippet)}</div>
          </span>
        </div>
      `)}
    </div>
  `;
}

/**
 * Banner listing the caller's pending organism invitations (status `invited`) across all
 * organisms, with Accept / Decline. Invited organisms are not in the member's active list, so
 * this is how an invitee discovers them. Backend: GET /v1/organisms/invitations/mine.
 */
function IncomingInvitations({ showToast, onChanged }) {
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await orgService.listMyInvitations().catch(() => null);
    setInvites(r?.data?.invitations || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const h = () => liveRef.current();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, []);
  const act = async (id, accept) => {
    setBusy(true);
    try {
      const r = accept ? await orgService.acceptInvitation(id) : await orgService.declineInvitation(id);
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.inviteActionFailed') || 'Failed'));
      else showToast(accept ? (t('organisms.invitationAccepted') || 'Joined') : (t('organisms.invitationDeclined') || 'Declined'));
      await load(); onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.inviteActionFailed') || 'Failed')); }
    finally { setBusy(false); }
  };
  if (!invites.length) return null;
  return html`
    <div class="card">
      <div class="section-title">${t('organisms.youAreInvited') || 'You’re invited'}</div>
      ${invites.map(({ membership, organism }) => html`
        <div class="pj-access-row" key=${organism.id}>
          <span><b>${(organism.name)}</b>${membership.invitedBy ? html` <span class="pj-mini">— ${(t('organisms.invitedByLabel') || 'invited by {who}').replace('{who}', (membership.invitedBy))}</span>` : null}</span>
          <span class="flex-row-wrap">
            <button class="btn-success btn-sm" disabled=${busy} onClick=${() => act(organism.id, true)}>${t('organisms.acceptInvite') || 'Accept'}</button>
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => act(organism.id, false)}>${t('organisms.declineInvite') || 'Decline'}</button>
          </span>
        </div>
      `)}
    </div>
  `;
}

/**
 * Organism member panel. For creator/admin (`canManage`) it is a full manager: approve/reject
 * join requests, invite by name, remove/block members, lift bans, transfer ownership (creator
 * only), and attach/detach agents. For a regular member it renders a read-only roster + agent
 * list (#6). Backend: /:id/{join-requests,invitations,members,transfer,agents}. Refreshes the
 * parent list via onChanged so member counts stay current.
 */
/**
 * Agents tab — attached agents listed first; "+ Attach agent" opens a picker of the user's OWN
 * agents (the node knows them — no GAII syntax needed), with free-text attach-by-ID behind an
 * "Advanced" link for cross-node agents. Each row shows where the agent has acted (aggregated
 * from the accessible workspaces' activity feeds) or, for own agents, when it was last active.
 */
function OrgAgentsPanel({ org, ghii, canManage, showToast, onChanged }) {
  const orgId = org.id;
  const attached = org.agentGaiis || [];
  const [mine, setMine] = useState(null);            // own agents (picker) — null = loading
  const [pick, setPick] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [acted, setActed] = useState({});            // agent name → { count, lastAt, ws: Set }

  useEffect(() => {
    listAgents(ghii).then(a => setMine((a || []).filter(x => !String(x.name || '').startsWith('session-')))).catch(() => setMine([]));
  }, [ghii]);

  // Best-effort activity context: which workspaces each agent has touched, and when last.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wss = (await orgService.discoverWorkspaces(orgId)).filter(w => w.access !== 'none');
        const map = {};
        await Promise.all(wss.map(async (w) => {
          const a = await orgService.getWorkspaceActivity(orgId, w.id);
          for (const e of (a.events || [])) {
            if (!e.agent) continue;
            const m = map[e.agent] || (map[e.agent] = { count: 0, lastAt: '', ws: new Set() });
            m.count++; m.ws.add(w.name || w.id);
            if (!m.lastAt || e.at > m.lastAt) m.lastAt = e.at;
          }
        }));
        if (!cancelled) setActed(map);
      } catch { /* context is optional */ }
    })();
    return () => { cancelled = true; };
  }, [orgId, attached.length]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.agentFailed') || 'Failed'));
      else { if (okMsg) showToast(okMsg); onChanged?.(); }
    } catch (e) { showToast((e && e.message) || (t('organisms.agentFailed') || 'Failed')); }
    finally { setBusy(false); }
  };
  const attach = (g) => {
    const id = (g || '').trim();
    if (!id) return;
    setPick(''); setAgentId(''); setShowAttach(false);
    run(() => orgService.attachAgent(orgId, id), t('organisms.agentAttached') || 'Agent attached');
  };
  const detach = (g) => run(() => orgService.detachAgent(orgId, g), t('organisms.agentDetached') || 'Agent detached');

  const attachedSet = new Set(attached);
  const pickable = (mine || []).filter(a => a.gaii && !attachedSet.has(a.gaii));
  const parseGaii = (g) => { const m = /^([^#]+)#([^@]+)@(.+)$/.exec(g) || []; return { name: m[1] || g, owner: m[2] || '', node: m[3] || '' }; };
  const ownByGaii = new Map((mine || []).map(a => [a.gaii, a]));

  return html`
    <div class="card-detail">
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.agentsDesc') || 'An attached agent works in this organism with its owner’s member rights — it shows up in workspace participants and activity.'}</div>
        <button class="btn-primary btn-sm" onClick=${() => setShowAttach(s => !s)}>${'+ '}${t('organisms.attachAgent') || 'Attach agent'}</button>
      </div>

      ${showAttach ? html`
        <div class="pj-attach">
          ${mine === null ? html`<${Spinner} />` : (pickable.length > 0 ? html`
            <div class="flex-row-wrap">
              <select class="input-field input-sm" value=${pick} onChange=${e => setPick(e.target.value)}>
                <option value="">${t('organisms.pickAgent') || 'Choose one of your agents…'}</option>
                ${pickable.map(a => html`<option value=${a.gaii} key=${a.gaii}>${(a.display_name || a.name) + (offersWorkspaceContract(a) ? ` · 📜 ${t('organisms.contractTag') || 'contract'}` : '')}</option>`)}
              </select>
              <button class="btn-outline btn-sm" disabled=${busy || !pick} onClick=${() => attach(pick)}>${t('organisms.attach') || 'Attach'}</button>
            </div>` : html`
            <div class="section-desc">${t('organisms.noOwnAgentsLeft') || 'All your agents are already attached (or you have none yet).'}</div>`)}
          <button class="pj-linklike" onClick=${() => setShowAdvanced(s => !s)}>${t('organisms.advancedAttach') || 'Advanced: attach by ID'}</button>
          ${showAdvanced ? html`
            <div class="flex-row-wrap">
              <input class="input-field input-sm" placeholder=${t('organisms.agentGaiiPlaceholder') || 'agent#owner@node'} value=${agentId}
                onInput=${(e) => setAgentId(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') attach(agentId); }} />
              <button class="btn-outline btn-sm" disabled=${busy || !agentId.trim()} onClick=${() => attach(agentId)}>${t('organisms.attach') || 'Attach'}</button>
            </div>` : null}
        </div>` : null}

      ${attached.length === 0 ? html`<${EmptyState} icon="🤖" text=${t('organisms.noAgents') || 'No agents attached.'} />` : null}
      ${attached.map(g => {
        const p = parseGaii(g);
        const own = ownByGaii.get(g);
        const act = acted[p.name];
        return html`
          <div class="pj-org-row" key=${'ag-' + g}>
            <div class="pj-org-avatar" aria-hidden="true">${'🤖'}</div>
            <div class="pj-org-main pj-org-main-static">
              <div class="pj-org-titlerow">
                <span class="pj-org-name">${(own?.display_name || p.name)}</span>
                ${p.node ? html`<span class="badge badge-info">${(p.node)}</span>` : null}
                ${own && offersWorkspaceContract(own) ? html`<span class="badge badge-success" title=${(t('organisms.contractAgentHint') || 'Advertises a workspace contract') + (contractNamesOf(own).length ? `: ${contractNamesOf(own).join(', ')}` : '')}>${'📜 '}${t('organisms.contractTag') || 'contract'}</span>` : null}
              </div>
              <div class="pj-org-desc" title=${g}>
                <span class="mono">${(p.owner ? `${p.name}#${p.owner}` : g)}</span>
                ${act ? html` · ${t('organisms.agentActedIn') || 'active in'} ${([...act.ws].join(', '))} (${act.count}) · ${relTime(act.lastAt)}`
                  : (own?.last_seen ? html` · ${t('organisms.lastActive') || 'last active'} ${relTime(own.last_seen)}` : null)}
              </div>
            </div>
            ${(canManage || g.includes('#' + ghii + '@'))
              ? html`<button class="btn-outline btn-sm" disabled=${busy} onClick=${() => detach(g)}>${t('organisms.detach') || 'Detach'}</button>`
              : null}
          </div>`;
      })}
    </div>`;
}

/**
 * Members tab — roster first (avatar rows with role badge, per-workspace access line, joined date,
 * "…" menu for make-creator/remove/block), "+ Invite" toggles a compact invite row, and pending
 * join requests render as highlighted rows only when there are any. Agents live in OrgAgentsPanel.
 */
function OrgMemberManager({ org, ghii, canManage, isCreator, showToast, confirm, onChanged, show }) {
  const orgId = org.id;
  const [requests, setRequests] = useState(null);
  const [members, setMembers] = useState(null);
  const [banned, setBanned] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteName, setInviteName] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wsAccess, setWsAccess] = useState(null);   // bare owner name → [{ ws, role }] (best effort)

  const load = useCallback(async () => {
    const tasks = [orgService.listMembers(orgId).catch(() => null)];
    if (canManage) {
      tasks.push(
        orgService.listJoinRequests(orgId).catch(() => null),
        orgService.listMembers(orgId, 'banned').catch(() => null),
        orgService.listInvitations(orgId).catch(() => null),
      );
    }
    const [mb, rq, bn, inv] = await Promise.all(tasks);
    setMembers(mb?.data?.members || []);
    if (canManage) {
      setRequests(rq?.data?.join_requests || []);
      setBanned(bn?.data?.members || []);
      setInvitations(inv?.data?.invitations || []);
    }
  }, [orgId, canManage]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // Per-member workspace access (best effort): workspace creators from discovery + access lists of
  // the workspaces the viewer created. Keyed by bare owner name (memberships use bare names too).
  useEffect(() => {
    if (show !== 'members') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const wss = await orgService.discoverWorkspaces(orgId);
        const map = {};
        const add = (who, wsName, role) => {
          const bare = String(who || '').split('@')[0];
          if (!bare) return;
          const list = map[bare] || (map[bare] = []);
          if (!list.some(x => x.ws === wsName)) list.push({ ws: wsName, role });
        };
        for (const w of wss) if (w.created_by) add(w.created_by, w.name || w.id, 'owner');
        await Promise.all(wss.filter(w => w.access === 'owner').map(async (w) => {
          const acc = await orgService.getWorkspaceAccess(orgId, w.id).catch(() => null);
          for (const m of (acc?.members || [])) add(m.owner, w.name || w.id, m.role);
        }));
        if (!cancelled) setWsAccess(map);
      } catch { /* the access line is optional */ }
    })();
    return () => { cancelled = true; };
  }, [orgId, show]);

  const run = async (fn, okMsg, failKey) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.ok === false) showToast(r?.error?.message || (t(failKey) || 'Failed'));
      else if (okMsg) showToast(okMsg);
      await load(); onChanged?.();
    } catch (e) { showToast((e && e.message) || (t(failKey) || 'Failed')); }
    finally { setBusy(false); }
  };

  const review = (rid, decision) => run(
    () => orgService.reviewJoinRequest(orgId, rid, decision),
    decision === 'approved' ? (t('organisms.joinApproved') || 'Request approved') : (t('organisms.joinRejected') || 'Request declined'),
    'organisms.reviewFailed');

  const invite = () => {
    const name = inviteName.trim();
    if (!name) return;
    setInviteName('');
    run(() => orgService.inviteMember(orgId, name), (t('organisms.invitationSent') || 'Invitation sent'), 'organisms.inviteFailed');
  };

  const remove = (memberGhii, ban) => confirm(
    (ban ? (t('organisms.confirmBlockMember') || 'Block {member} and remove them from this organism?') : (t('organisms.confirmRemoveMember') || 'Revoke {member}’s access to this organism?')).replace('{member}', memberGhii),
    () => run(() => orgService.removeMember(orgId, memberGhii, ban), ban ? (t('organisms.memberBlocked') || 'Member blocked') : (t('organisms.memberRemoved') || 'Member removed'), 'organisms.removeFailed'),
    { danger: true });

  const unban = (memberGhii) => run(() => orgService.unbanMember(orgId, memberGhii), (t('organisms.banLifted') || 'Block lifted'), 'organisms.removeFailed');

  const transfer = (toGhii) => confirm(
    (t('organisms.confirmTransfer') || 'Make {member} the creator? You will become an admin.').replace('{member}', toGhii),
    () => run(() => orgService.transferOwnership(orgId, toGhii), (t('organisms.ownershipTransferred') || 'Ownership transferred'), 'organisms.transferFailed'),
    { danger: true });

  const pending = (requests || []).filter(r => r.status === 'pending');
  const showMembers = show !== 'agents';

  // "Access: Marketing (contributor)" line — creator shows "all workspaces" (mirrors reality:
  // the organism creator governs every workspace it owns; per-ws data may be partial for others).
  const accessLine = (m) => {
    if (m.role === 'creator') return t('organisms.accessAll') || 'all workspaces';
    const list = wsAccess?.[String(m.ghii || '').split('@')[0]] || [];
    if (!list.length) return '';
    return list.map(x => `${x.ws} (${x.role})`).join(', ');
  };

  return html`
    <div class="card-detail">
      ${showMembers ? html`
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.membersDesc') || 'Members can join workspaces; their agents inherit the role.'}
          ${' '}<span class="pj-members-cap">${(members || []).length}/${org.maxMembers || 500}</span></div>
        ${canManage ? html`<button class="btn-primary btn-sm" onClick=${() => setShowInvite(s => !s)}>${'+ '}${t('organisms.invite') || 'Invite'}</button>` : null}
      </div>

      ${canManage && showInvite ? html`
        <div class="flex-row-wrap pj-invite-row">
          <input class="input-field input-sm" autofocus placeholder=${t('organisms.inviteePlaceholder') || 'owner name'} value=${inviteName}
            onInput=${(e) => setInviteName(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') invite(); }} />
          <button class="btn-outline btn-sm" disabled=${busy || !inviteName.trim()} onClick=${invite}>${t('organisms.invite') || 'Invite'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => setShowInvite(false)}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>` : null}
      ${canManage && invitations.length > 0 ? html`
        <div class="section-desc">${t('organisms.outstandingInvites') || 'Awaiting acceptance'}: ${invitations.map(m => (m.ghii)).join(', ')}</div>
      ` : null}

      ${canManage && pending.length > 0 ? pending.map(r => html`
        <div class="pj-org-row pj-req-row" key=${r.id}>
          <div class="pj-org-avatar" aria-hidden="true">${'🙋'}</div>
          <div class="pj-org-main pj-org-main-static">
            <div class="pj-org-titlerow">
              <span class="pj-org-name">${(r.ghii)}</span>
              <span class="pj-org-desc">${t('organisms.wantsToJoin') || 'wants to join'}${r.createdAt ? ` · ${relTime(r.createdAt)}` : ''}</span>
            </div>
            ${r.message ? html`<div class="pj-org-desc">${(r.message)}</div>` : null}
          </div>
          <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => review(r.id, 'rejected')}>${t('organisms.decline') || 'Decline'}</button>
          <button class="btn-success btn-sm" disabled=${busy} onClick=${() => review(r.id, 'approved')}>${t('organisms.approve') || 'Approve'}</button>
        </div>
      `) : null}

      <div class="pj-org-list">
        ${(members || []).map(m => {
          const acc = accessLine(m);
          const menuItems = (canManage && m.role !== 'creator' && m.ghii !== ghii) ? [
            isCreator && { label: t('organisms.makeCreator') || 'Make creator', icon: '👑', onClick: () => transfer(m.ghii) },
            { label: t('organisms.remove') || 'Remove', danger: true, onClick: () => remove(m.ghii, false) },
            { label: t('organisms.block') || 'Block', danger: true, onClick: () => remove(m.ghii, true) },
          ] : [];
          return html`
            <div class="pj-org-row" key=${m.ghii}>
              <div class="pj-org-avatar" aria-hidden="true">${orgInitials(m.ghii)}</div>
              <div class="pj-org-main pj-org-main-static">
                <div class="pj-org-titlerow">
                  <span class="pj-org-name">${(m.ghii)}</span>
                  <span class="badge ${m.role === 'creator' ? 'badge-success' : 'badge-info'}">${(m.role || 'member')}</span>
                </div>
                ${(acc || m.joinedAt) ? html`
                  <div class="pj-org-desc">
                    ${acc ? `${t('organisms.accessLabel') || 'Access'}: ${acc}` : ''}${acc && m.joinedAt ? ' · ' : ''}${m.joinedAt ? (t('organisms.joinedDate') || 'joined {date}').replace('{date}', fmtDate(m.joinedAt)) : ''}
                  </div>` : null}
                ${(m.agents || []).length ? html`
                  <div class="pj-org-desc" title=${t('organisms.memberAgentsHint') || "This member's agents — they inherit the membership and can act in this organism"}>
                    ${'🤖 '}${t('organisms.memberAgents') || 'Agents'}: ${m.agents.map(a => a.name || a.gaii).join(', ')}
                  </div>` : null}
              </div>
              ${menuItems.length ? html`<${KebabMenu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}
            </div>`;
        })}
      </div>

      ${canManage && banned.length > 0 ? html`
        <div class="detail-label">${t('organisms.blockedMembers') || 'Blocked'}</div>
        ${banned.map(m => html`
          <div class="pj-access-row" key=${'ban-' + m.ghii}>
            <span>${(m.ghii)}</span>
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => unban(m.ghii)}>${t('organisms.unblock') || 'Unblock'}</button>
          </div>
        `)}
      ` : null}
      ` : null}
    </div>
  `;
}

export default function OrganismsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myOrganisms, setMyOrganisms] = useState(null);
  const [publicOrganisms, setPublicOrganisms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  // organism whose workspaces are open, then the specific workspace within it — both restored from
  // sessionStorage so an F5 returns to where you were. openId set + openWs null = the workspace LIST.
  const [openId, setOpenId] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openId') || null; } catch (e) { return null; } });
  const [openWs, setOpenWs] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openWs') || null; } catch (e) { return null; } });
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // List ordering: 'custom' (drag-and-drop, persisted) | 'name' | 'newest'. Persisted together with
  // the manual order in the user-memory key `organisms.ui` so it follows the user across devices.
  const [sortMode, setSortMode] = useState('custom');
  const [customOrder, setCustomOrder] = useState([]);
  const [openSettings, setOpenSettings] = useState(false); // open OrganismHome with the Settings panel showing
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  /* ── Create form state ── */
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState('community');
  const [formPolicy, setFormPolicy] = useState('open');
  const [formVisibility, setFormVisibility] = useState('public');
  const [formInterests, setFormInterests] = useState('');

  const ghii = session?.owner || '';
  const [wsCounts, setWsCounts] = useState({});   // orgId → workspace count (own orgs)

  const loadData = useCallback(async () => {
    try {
      const [myResp, pubResp] = await Promise.all([
        ghii ? orgService.listOrganisms({ member: ghii }) : Promise.resolve({ data: { organisms: [] } }),
        orgService.listOrganisms({ visibility: 'public' }),
      ]);
      const mine = myResp?.data?.organisms || [];
      const mineIds = new Set(mine.map(o => o.id));
      const discover = (pubResp?.data?.organisms || []).filter(o => !mineIds.has(o.id));
      setMyOrganisms(mine);
      setPublicOrganisms(discover);
      onStats?.({ organisms: mine.length });
      // Workspace counts for the 📁 row stat (member-gated endpoint, so own orgs only).
      Promise.all(mine.map(async (o) => [o.id, (await orgService.discoverWorkspaces(o.id)).length]))
        .then(entries => setWsCounts(Object.fromEntries(entries)))
        .catch(() => {});
    } catch {
      setMyOrganisms([]);
      setPublicOrganisms([]);
    }
  }, [ghii, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // ── List-order preferences (user memory key `organisms.ui`: { order: [ids], sort: mode }) ──
  const UI_PREFS_KEY = 'organisms.ui';
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const r = await memoryService.getMemory(UI_PREFS_KEY);
        const v = r?.data?.value;
        if (v && typeof v === 'object') {
          if (Array.isArray(v.order)) setCustomOrder(v.order.filter(x => typeof x === 'string'));
          if (['custom', 'name', 'newest'].includes(v.sort)) setSortMode(v.sort);
        }
      } catch { /* no saved prefs yet */ }
    })();
  }, [session]);
  const savePrefs = useCallback((order, sort) => {
    memoryService.createMemory(UI_PREFS_KEY, { order, sort }, 'private').catch(() => {});
  }, []);

  // Stable sort keeps server order for ids missing from the saved manual order (appended at the end).
  const sortedMine = useMemo(() => {
    const arr = [...(myOrganisms || [])];
    if (sortMode === 'name') arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    else if (sortMode === 'newest') arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    else if (customOrder.length) {
      const pos = new Map(customOrder.map((id, i) => [id, i]));
      arr.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : Infinity) - (pos.has(b.id) ? pos.get(b.id) : Infinity));
    }
    return arr;
  }, [myOrganisms, sortMode, customOrder]);

  // Drop on a row: move the dragged row to the target's position; switches to manual order and saves.
  const onDropRow = (targetId) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    const ids = sortedMine.map(o => o.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setCustomOrder(ids);
    setSortMode('custom');
    savePrefs(ids, 'custom');
  };

  // Import a whole organism from a ZIP backup → creates a new organism + opens it.
  const orgFileRef = useRef(null);
  const [importingOrg, setImportingOrg] = useState(false);
  const doImportOrg = async (file) => {
    if (!file) return;
    setImportingOrg(true);
    try {
      const jwt = window.AIMEAT?.auth?.getSession?.()?.jwt || '';
      const res = await fetch('/v1/organisms/import', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/zip' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Import failed');
      showToast(t('organisms.orgImported') || 'Organism imported');
      await loadData();
      if (body.data?.organism_id) setOpenId(body.data.organism_id);
    } catch (e) { showToast((e && e.message) || 'Import failed'); }
    finally { setImportingOrg(false); }
  };

  // Persist the open organism + workspace (F5 restore), and drop a restored id the user can no longer open.
  useEffect(() => {
    try { if (openId) sessionStorage.setItem('aimeat.ws.openId', openId); else sessionStorage.removeItem('aimeat.ws.openId'); } catch (e) { /* noop */ }
  }, [openId]);
  useEffect(() => {
    try { if (openWs) sessionStorage.setItem('aimeat.ws.openWs', openWs); else sessionStorage.removeItem('aimeat.ws.openWs'); } catch (e) { /* noop */ }
  }, [openWs]);
  useEffect(() => {
    if (openId && myOrganisms && !myOrganisms.some(o => o.id === openId)) { setOpenId(null); setOpenWs(null); }
  }, [openId, myOrganisms]);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      showToast(t('organisms.nameRequired') || 'Name is required');
      return;
    }
    setCreating(true);
    try {
      const interests = formInterests.split(',').map(s => s.trim()).filter(Boolean);
      const result = await orgService.createOrganism({
        name: formName.trim(),
        description: formDesc.trim(),
        type: formType,
        join_policy: formPolicy,
        visibility: formVisibility,
        interests,
      });
      if (result?.data?.organism) {
        showToast(t('organisms.created') || 'Organism created!');
        setShowCreate(false);
        setFormName(''); setFormDesc(''); setFormInterests('');
        loadData();
      } else {
        showToast(result?.error?.message || (t('organisms.createError') || 'Failed to create'));
      }
    } catch {
      showToast(t('organisms.createError') || 'Failed to create');
    } finally { setCreating(false); }
  }, [formName, formDesc, formType, formPolicy, formVisibility, formInterests, showToast, loadData]);

  const handleJoin = useCallback(async (id) => {
    try {
      const result = await orgService.joinOrganism(id);
      if (result?.data?.status === 'joined') {
        showToast(t('organisms.joined') || 'Joined!');
      } else if (result?.data?.status === 'pending') {
        showToast(t('organisms.joinPending') || 'Join request sent — waiting for approval');
      } else {
        showToast(result?.error?.message || 'Could not join');
      }
      loadData();
    } catch {
      showToast(t('organisms.joinError') || 'Failed to join');
    }
  }, [showToast, loadData]);

  const handleLeave = useCallback(async (id, name) => {
    confirm(t('organisms.confirmLeave')?.replace('{name}', name) || `Leave "${name}"?`, async () => {
      try {
        await orgService.leaveOrganism(id);
        showToast(t('organisms.left') || 'Left organism');
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch {
        showToast(t('organisms.leaveError') || 'Failed to leave');
      }
    }, { danger: true });
  }, [showToast, loadData]);

  const handleDelete = useCallback(async (id, name) => {
    confirm(t('organisms.confirmDelete')?.replace('{name}', name) || `Delete "${name}"? This cannot be undone.`, async () => {
      try {
        await orgService.deleteOrganism(id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        setExpanded(null);
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch {
        showToast(t('organisms.deleteError') || 'Failed to delete');
      }
    }, { danger: true });
  }, [showToast, loadData]);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  // Discover rows expand in place (non-members can't open the home page, so the detail
  // grid + interests they could previously see in the expanded card stay reachable here).
  const renderDiscoverDetail = (org) => {
    const policyLabel = {
      open: t('organisms.policyOpen') || 'Open',
      approval_required: t('organisms.policyApproval') || 'Approval',
      invite_only: t('organisms.policyInvite') || 'Invite Only',
    }[org.joinPolicy] || org.joinPolicy;
    return html`
      <div class="pj-org-detail" onClick=${(e) => e.stopPropagation()}>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">${t('organisms.creator') || 'Creator'}</span>
            <span class="detail-value">${(org.creatorGhii)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">${t('organisms.memberCount') || 'Members'}</span>
            <span class="detail-value">${(org.members || []).length} / ${org.maxMembers || 500}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">${t('organisms.policyLabel') || 'Join policy'}</span>
            <span class="detail-value">${policyLabel}</span>
          </div>
          ${org.createdAt ? html`
            <div class="detail-item">
              <span class="detail-label">${t('organisms.createdAt') || 'Created'}</span>
              <span class="detail-value">${fmtDate(org.createdAt)}</span>
            </div>
          ` : null}
        </div>
        ${(org.interests || []).length > 0 ? html`
          <div class="flex-row-wrap">
            ${org.interests.map(tag => html`<span class="file-tag" key=${tag}>${(tag)}</span>`)}
          </div>` : null}
      </div>`;
  };

  // Compact one-line row: avatar \u00B7 name + type + lock \u00B7 description \u00B7 members/agents/date \u00B7
  // primary action \u00B7 "\u2026" menu. Management (settings, leave, delete) lives in the menu / home page.
  const renderOrgRow = (org, isMine) => {
    const isCreator = org.creatorGhii === ghii;
    const isAdmin = org.admins?.includes(ghii);
    const isMember = org.members?.includes(ghii);
    const canEdit = isCreator || isAdmin;
    const typeLabel = t(`organisms.types.${org.type}`) || org.type;
    const isExpanded = !isMine && expanded === org.id;
    const visLabel = org.visibility === 'private' ? (t('organisms.visPrivate') || 'Private') : (t('organisms.visListed') || 'Listed');
    const openHome = (withSettings) => { setOpenSettings(!!withSettings); setOpenWs(null); setOpenId(org.id); };
    const activate = () => (isMine || isMember) ? openHome(false) : toggleExpand(org.id);

    const menuItems = isMine ? [
      canEdit && { label: t('organisms.settings') || 'Settings', icon: '\u2699', onClick: () => openHome(true) },
      { label: t('organisms.exportOrg') || 'Export organism', icon: '\u2B07', onClick: () => exportOrganismZip(org, showToast) },
      !isCreator && { label: t('organisms.leave') || 'Leave', danger: true, onClick: () => handleLeave(org.id, org.name) },
      isCreator && { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => handleDelete(org.id, org.name) },
    ] : [];

    return html`
      <div class="pj-org-row ${dragOverId === org.id ? 'pj-org-drag-over' : ''}" key=${org.id}
        draggable=${isMine}
        onDragStart=${isMine ? ((e) => { dragIdRef.current = org.id; e.dataTransfer.effectAllowed = 'move'; }) : undefined}
        onDragOver=${isMine ? ((e) => { e.preventDefault(); setDragOverId(org.id); }) : undefined}
        onDragLeave=${isMine ? (() => setDragOverId(d => (d === org.id ? null : d))) : undefined}
        onDrop=${isMine ? (() => onDropRow(org.id)) : undefined}
        onDragEnd=${isMine ? (() => { dragIdRef.current = null; setDragOverId(null); }) : undefined}>
        <div class="pj-org-avatar" aria-hidden="true">${orgInitials(org.name)}</div>
        <div class="pj-org-main" role="button" tabindex="0" onClick=${activate}
          onKeyDown=${(e) => { if (e.key === 'Enter') activate(); }}>
          <div class="pj-org-titlerow">
            <span class="pj-org-name">${(org.name)}</span>
            <span class="badge badge-info">${typeLabel}</span>
            ${org.visibility !== 'public' ? html`<span class="pj-org-lock" title=${visLabel}>${'\uD83D\uDD12'}</span>` : null}
          </div>
          ${org.description ? html`<div class="pj-org-desc">${(org.description)}</div>` : null}
        </div>
        <div class="pj-org-stats">
          ${isMine && wsCounts[org.id] !== undefined ? html`
            <span class="pj-org-stat" title=${t('organisms.tabWorkspaces') || 'Workspaces'}>${'\uD83D\uDCC1'} ${wsCounts[org.id]}</span>` : null}
          <span class="pj-org-stat" title=${t('organisms.members') || 'Members'}>${'\uD83D\uDC65'} ${(org.members || []).length}</span>
          <span class="pj-org-stat" title=${t('organisms.attachedAgents') || 'Attached agents'}>${'\uD83E\uDD16'} ${(org.agentGaiis || []).length}</span>
          ${org.createdAt ? html`<span class="pj-org-stat pj-org-date" title=${t('organisms.createdAt') || 'Created'}>${fmtDate(org.createdAt)}</span>` : null}
        </div>
        ${(isMine || isMember)
          ? html`<button class="btn-outline btn-sm pj-org-openbtn" onClick=${() => openHome(false)}>${t('organisms.open') || 'Open'}</button>`
          : html`<button class="btn-outline btn-sm pj-org-openbtn" onClick=${() => handleJoin(org.id)}>${t('organisms.join') || 'Join'}</button>`}
        ${isMine ? html`<${KebabMenu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}
        ${isExpanded ? renderDiscoverDetail(org) : null}
      </div>
    `;
  };

  if (openId) {
    const org = [...(myOrganisms || []), ...publicOrganisms].find(o => o.id === openId) || { id: openId };
    // openWs chosen → that workspace; otherwise the organism's HOME page (tabs incl. workspaces).
    if (openWs) {
      return html`<${Workspace} org=${org} wsId=${openWs} session=${session} showToast=${showToast}
        onBack=${() => { setOpenWs(null); }}
        onBackToList=${() => { setOpenWs(null); setOpenId(null); setOpenSettings(false); loadData(); }} />`;
    }
    return html`
      <${OrganismHome} org=${org} ghii=${ghii} showToast=${showToast}
        initialSettings=${openSettings}
        onOpenWs=${(wsId) => setOpenWs(wsId)}
        onBack=${() => { setOpenId(null); setOpenSettings(false); loadData(); }}
        onChanged=${loadData}
        onLeave=${() => handleLeave(org.id, org.name)} />
      <${ConfirmUI} />`;
  }

  if (!myOrganisms) return html`<${Spinner} text=${t('organisms.loading') || 'Loading organisms...'} />`;

  return html`
    <div class="section-title">${t('organisms.title') || 'Organisms'}</div>
    <div class="section-desc">${t('organisms.desc') || 'Organisms are groups — communities, teams, clubs, or projects. Create one or join existing ones to share knowledge, coordinate work, and build together.'}</div>

    <!-- Create form (opened from the topbar button) -->
    <div class="mb-1">
      ${!showCreate ? null : html`
        <div class="create-form">
          <h4 class="card-h3 mb-half">${t('organisms.createTitle') || 'Create New Organism'}</h4>
          <div class="flex-col">
            <input type="text" placeholder=${t('organisms.namePlaceholder') || 'Name'} value=${formName} onInput=${(e) => setFormName(e.target.value)}
              class="input-field input-sm" />
            <textarea placeholder=${t('organisms.descPlaceholder') || 'Description'} value=${formDesc} onInput=${(e) => setFormDesc(e.target.value)} rows="2"
              class="input-field input-sm" />
            <input type="text" placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} value=${formInterests} onInput=${(e) => setFormInterests(e.target.value)}
              class="input-field input-sm" />
            <div class="flex-row-wrap">
              <select value=${formType} onChange=${(e) => setFormType(e.target.value)}
                class="input-field input-sm">
                <option value="community">${t('organisms.types.community') || 'Community'}</option>
                <option value="team">${t('organisms.types.team') || 'Team'}</option>
                <option value="club">${t('organisms.types.club') || 'Club'}</option>
                <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
                <option value="project">${t('organisms.types.project') || 'Project'}</option>
              </select>
              <select value=${formPolicy} onChange=${(e) => setFormPolicy(e.target.value)}
                class="input-field input-sm">
                <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
                <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
                <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
              </select>
              <select value=${formVisibility} onChange=${(e) => setFormVisibility(e.target.value)}
                class="input-field input-sm">
                <option value="public">${t('organisms.visPublic') || 'Public'}</option>
                <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
                <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
              </select>
            </div>
            <div class="form-actions">
              <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating}>
                ${creating ? '...' : (t('organisms.create') || 'Create')}
              </button>
              <button class="btn-ghost btn-sm" onClick=${() => setShowCreate(false)}>
                ${t('organisms.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      `}
    </div>

    <!-- Incoming invitations -->
    <${IncomingInvitations} showToast=${showToast} onChanged=${loadData} />

    <!-- My Organisms -->
    <input type="file" accept=".zip,application/zip" ref=${orgFileRef} style="display:none" onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImportOrg(f); }} />
    <div class="pj-ws-topbar">
      <div class="section-title">${t('organisms.myOrganisms') || 'My Organisms'}</div>
      <div class="pj-org-topbar-actions">
        ${myOrganisms.length > 1 ? html`
          <select class="input-field input-sm pj-org-sort" title=${t('organisms.sortTitle') || 'Sort'} value=${sortMode}
            onChange=${(e) => { const m = e.target.value; setSortMode(m); savePrefs(customOrder, m); }}>
            <option value="custom">${t('organisms.sortCustom') || 'My order'}</option>
            <option value="name">${t('organisms.sortName') || 'Name A–Z'}</option>
            <option value="newest">${t('organisms.sortNewest') || 'Newest first'}</option>
          </select>` : null}
        <button class="btn-outline btn-sm" disabled=${importingOrg} title=${t('organisms.importOrgHint') || 'Restore an organism from a .zip backup'} onClick=${() => orgFileRef.current && orgFileRef.current.click()}>${'⬆ '}${t('organisms.importOrg') || 'Import'}</button>
        <button class="btn-primary btn-sm" onClick=${() => setShowCreate(true)}>${'+ '}${t('organisms.createNew') || 'Create Organism'}</button>
      </div>
    </div>
    ${myOrganisms.length === 0
      ? html`<div class="empty">${t('organisms.empty') || 'You are not part of any organisms yet.'}</div>`
      : html`
        <div class="pj-org-list">${sortedMine.map(org => renderOrgRow(org, true))}</div>
        ${sortMode === 'custom' && sortedMine.length > 1 ? html`
          <div class="pj-org-hint">${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}</div>` : null}
      `
    }

    <!-- Discover -->
    ${publicOrganisms.length > 0 && html`
      <div class="section-title section-title-spaced">${t('organisms.discover') || 'Discover'}</div>
      <div class="pj-org-list">${publicOrganisms.map(org => renderOrgRow(org, false))}</div>
    `}
    <${ConfirmUI} />
  `;
}

/* Board tab — embedded preview of the organism's discussion board: latest posts + a composer,
 * with "Open in Boards" for the full view. The raw board UUID hides behind a copy icon. */
function BoardPreview({ boardId, showToast }) {
  const [posts, setPosts] = useState(null);   // null = loading
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listPosts(boardId).then(p => setPosts(Array.isArray(p) ? p : [])).catch(() => setPosts([]));
  }, [boardId]);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const h = () => liveRef.current();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, []);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const r = await createPost(boardId, body);
      if (r?.ok === false) showToast(r?.error?.message || 'Failed to post');
      else { setText(''); load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to post'); }
    finally { setBusy(false); }
  };
  const copyId = async () => {
    const ok = await copyToClipboard(boardId);
    showToast(ok ? (t('organisms.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  const ts = (p) => p.created_at || p.createdAt || p.at || '';
  const latest = [...(posts || [])].sort((a, b) => String(ts(b)).localeCompare(String(ts(a)))).slice(0, 5);

  return html`
    <div class="card-detail">
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.boardPreviewDesc') || 'Latest messages on this organism’s board.'}</div>
        <button class="pj-icon-btn" title=${(t('organisms.copyId') || 'Copy ID') + ': ' + boardId} onClick=${copyId}>${'📋'}</button>
        <button class="btn-outline btn-sm" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'boards' } }))}>
          ${t('organisms.openBoardsTab') || 'Open in Boards'}</button>
      </div>
      ${posts === null ? html`<${Spinner} />`
        : latest.length === 0 ? html`<${EmptyState} icon="💬" text=${t('organisms.boardEmpty') || 'No messages yet — write the first one.'} />`
        : latest.map(p => html`
          <div class="pj-board-post" key=${p.id || ts(p)}>
            <div class="pj-board-post-head">
              <span class="pj-board-author">${(p.author_gaii || p.author || '?')}</span>
              ${ts(p) ? html`<span class="pj-board-time">${relTime(ts(p))}</span>` : null}
            </div>
            <div class="pj-board-body">${(String(p.body || p.content || '').slice(0, 400))}</div>
          </div>`)}
      <div class="flex-row-wrap pj-board-composer">
        <input class="input-field input-sm pj-board-input" placeholder=${t('organisms.writePost') || 'Write a message…'} value=${text}
          onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
        <button class="btn-outline btn-sm" disabled=${busy || !text.trim()} onClick=${send}>${t('organisms.send') || 'Send'}</button>
      </div>
    </div>`;
}

/* ───────────────── Organism home page ─────────────────
 * One home per organism: breadcrumb header (avatar, name, badges, description,
 * Export + Settings) and tabs — Workspaces (the workspace list + content search),
 * Members (invite/approve/roster/blocked), Agents (attach/detach), Board (link to
 * the Boards tab). The Settings panel hosts the edit form, the metadata that used
 * to live in the expanded list card, and the danger zone (leave / delete). */
function OrganismHome({ org, ghii, showToast, initialSettings, onOpenWs, onBack, onChanged, onLeave }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('aimeat.org.tab') || 'workspaces'; } catch { return 'workspaces'; } });
  const [showSettings, setShowSettings] = useState(!!initialSettings);
  const [wsCount, setWsCount] = useState(null);
  const [pendingJoin, setPendingJoin] = useState(0);   // Members tab pill — visible without opening the tab
  useEffect(() => { try { sessionStorage.setItem('aimeat.org.tab', tab); } catch { /* noop */ } }, [tab]);

  const isCreator = org.creatorGhii === ghii;
  const isAdmin = org.admins?.includes(ghii);
  const isMember = org.members?.includes(ghii);
  const canEdit = isCreator || isAdmin;
  const typeLabel = t(`organisms.types.${org.type}`) || org.type;

  useEffect(() => {
    if (!canEdit) return undefined;
    let cancelled = false;
    const fetchIt = () => orgService.listJoinRequests(org.id)
      .then(r => { if (!cancelled) setPendingJoin(((r?.data?.join_requests) || []).filter(x => x.status === 'pending').length); })
      .catch(() => {});
    fetchIt();
    window.addEventListener('aimeat-live-update', fetchIt);
    return () => { cancelled = true; window.removeEventListener('aimeat-live-update', fetchIt); };
  }, [org.id, canEdit]);

  // Feed the home page's "Continue" list (only once the real name is known, not the {id} stub).
  useEffect(() => {
    if (org.name) recordRecent({ type: 'organism', id: org.id, label: org.name, data: { orgId: org.id } });
  }, [org.id, org.name]);

  /* ── Settings: labelled + grouped form (Identity / Access) with live dirty-check, a one-line
   * read-only metadata row, per-choice access hints, and a clearly separated danger zone whose
   * delete needs the organism's name typed and states exactly what gets removed. ── */
  const baseline = useMemo(() => ({
    name: org.name || '', description: org.description || '', type: org.type || 'community',
    join_policy: org.joinPolicy || 'open', visibility: org.visibility || 'public',
    interests: [...(org.interests || [])],
  }), [org]);
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  // Sync the form whenever fresher org data arrives (e.g. the home mounted from an F5 with only a
  // {id} stub before the list loaded) — but ONLY while the user hasn't touched the fields, so a
  // live-update reload never clobbers typing.
  const prevBaselineRef = useRef(baseline);
  useEffect(() => {
    const prev = prevBaselineRef.current;
    const untouched = form.name === prev.name && form.description === prev.description
      && form.type === prev.type && form.join_policy === prev.join_policy
      && form.visibility === prev.visibility && form.interests.join(' ') === prev.interests.join(' ');
    if (untouched) setForm(baseline);
    prevBaselineRef.current = baseline;
  }, [baseline]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = form.name !== baseline.name || form.description !== baseline.description
    || form.type !== baseline.type || form.join_policy !== baseline.join_policy
    || form.visibility !== baseline.visibility
    || form.interests.join(' ') !== baseline.interests.join(' ');
  // Save doubles as the unsaved-changes indicator: enabled ⇔ something actually changed.
  const saveEdit = async () => {
    if (!form.name.trim()) { showToast(t('organisms.nameRequired') || 'Name is required'); return; }
    setSaving(true);
    try {
      const result = await orgService.updateOrganism(org.id, {
        name: form.name.trim(), description: form.description.trim(),
        type: form.type, join_policy: form.join_policy, visibility: form.visibility, interests: form.interests,
      });
      if (result?.ok !== false) { showToast(t('organisms.updated') || 'Organism updated'); onChanged?.(); }
      else showToast(result?.error?.message || (t('organisms.updateError') || 'Failed to update'));
    } catch { showToast(t('organisms.updateError') || 'Failed to update'); }
    finally { setSaving(false); }
  };
  // Leaving a dirty form (closing settings / breadcrumb back) asks before dropping the changes.
  const guardDirty = (fn) => {
    if (showSettings && dirty) confirm(t('organisms.discardChanges') || 'Discard unsaved changes?', () => { setForm(baseline); fn(); }, { danger: true });
    else fn();
  };

  const boardIdShort = org.boardId && org.boardId.length > 20
    ? `${org.boardId.slice(0, 12)}…${org.boardId.slice(-6)}` : (org.boardId || '');
  const copyBoardId = async () => {
    const ok = await copyToClipboard(org.boardId);
    showToast(ok ? (t('organisms.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  // What a delete actually removes (counted from the accessible workspaces when settings opens).
  const [delStats, setDelStats] = useState(null);   // { ws, recs, docs }
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  useEffect(() => {
    if (!showSettings || !isCreator) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const wss = (await orgService.discoverWorkspaces(org.id)).filter(w => w.access !== 'none');
        let recs = 0, docs = 0;
        await Promise.all(wss.map(async (w) => {
          const wsData = await orgService.getWorkspace(org.id, w.id).catch(() => null);
          for (const ot of (wsData?.manifest?.objectTypes || []).filter(orgService.isMemorySpace)) {
            const n = new Set([...(wsData.drafts?.[ot.name] || []), ...(wsData.objects?.[ot.name] || [])].map(d => d.id)).size;
            if (orgService.isDocSpace(ot)) docs += n; else recs += n;
          }
        }));
        if (!cancelled) setDelStats({ ws: wss.length, recs, docs });
      } catch { /* the counts are a courtesy — the generic warning still shows */ }
    })();
    return () => { cancelled = true; };
  }, [org.id, showSettings, isCreator]);
  const delStatsText = delStats
    ? (t('organisms.deleteOrganismStats') || 'Deletes {w} workspaces, {r} records and {d} documents. This cannot be undone.')
        .replace('{w}', String(delStats.ws)).replace('{r}', String(delStats.recs)).replace('{d}', String(delStats.docs))
    : (t('organisms.deleteWarnGeneric') || 'Deletes the organism with all its workspaces and content. This cannot be undone.');
  const doDelete = () => {
    confirm(`${(t('organisms.confirmDeleteName') || 'Delete “{name}”?').replace('{name}', org.name || org.id)} ${delStatsText}`, async () => {
      try {
        await orgService.deleteOrganism(org.id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        onBack(); onChanged?.();
      } catch { showToast(t('organisms.deleteError') || 'Failed to delete'); }
    }, { danger: true, title: t('organisms.deleteOrganismTitle') || 'Delete this organism' });
  };

  const extraAdmins = (org.admins || []).filter(a => a !== org.creatorGhii);
  const visHint = t(`organisms.visHint.${form.visibility}`);
  const policyHint = t(`organisms.policyHint.${form.join_policy}`);
  const hintText = [visHint, policyHint].filter(h => h && !h.startsWith('organisms.')).join(' ');

  const renderSettings = () => html`
    <div class="card-detail pj-org-settings">
      <div class="pj-meta-line">
        ${org.createdAt ? html`<span>${t('organisms.createdAt') || 'Created'} ${fmtDate(org.createdAt)}</span>` : null}
        <span>${t('organisms.creator') || 'Creator'} ${(org.creatorGhii || '-')}</span>
        ${extraAdmins.length > 0 ? html`<span>${t('organisms.admins') || 'Admins'} ${(extraAdmins.join(', '))}</span>` : null}
        ${org.boardId ? html`
          <span>${t('organisms.board') || 'Board'} <span class="mono" title=${(org.boardId)}>${(boardIdShort)}</span>
            <button class="pj-icon-btn" title=${t('organisms.copyId') || 'Copy ID'} onClick=${copyBoardId}>${'📋'}</button>
          </span>` : null}
      </div>

      ${canEdit ? html`
        <div class="pj-form-group">${t('organisms.formIdentity') || 'Identity'}</div>
        <label class="pj-field"><span>${t('organisms.fieldName') || 'Name'}</span>
          <input type="text" class="input-field input-sm" value=${form.name} onInput=${(e) => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label class="pj-field"><span>${t('organisms.fieldDescription') || 'Description'}</span>
          <textarea class="input-field input-sm" rows="2" value=${form.description} onInput=${(e) => setForm(f => ({ ...f, description: e.target.value }))}></textarea></label>
        <div class="pj-field"><span>${t('organisms.fieldInterests') || 'Interests'}</span>
          <${TagInput} tags=${form.interests} onChange=${(tags) => setForm(f => ({ ...f, interests: tags }))} placeholder=${t('organisms.addTag') || 'Add…'} /></div>

        <div class="pj-form-group">${t('organisms.formAccess') || 'Access'}</div>
        <div class="pj-form-row">
          <label class="pj-field"><span>${t('organisms.fieldType') || 'Type'}</span>
            <select class="input-field input-sm" value=${form.type} onChange=${(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="community">${t('organisms.types.community') || 'Community'}</option>
              <option value="team">${t('organisms.types.team') || 'Team'}</option>
              <option value="club">${t('organisms.types.club') || 'Club'}</option>
              <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
              <option value="project">${t('organisms.types.project') || 'Project'}</option>
            </select></label>
          <label class="pj-field"><span>${t('organisms.policyLabel') || 'Join policy'}</span>
            <select class="input-field input-sm" value=${form.join_policy} onChange=${(e) => setForm(f => ({ ...f, join_policy: e.target.value }))}>
              <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
              <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
              <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
            </select></label>
          <label class="pj-field"><span>${t('organisms.fieldVisibility') || 'Visibility'}</span>
            <select class="input-field input-sm" value=${form.visibility} onChange=${(e) => setForm(f => ({ ...f, visibility: e.target.value }))}>
              <option value="public">${t('organisms.visPublic') || 'Public'}</option>
              <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
              <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
            </select></label>
        </div>
        ${hintText ? html`<div class="pj-form-hint">${hintText}</div>` : null}

        <div class="form-actions">
          <button class="btn-primary btn-sm" onClick=${saveEdit} disabled=${saving || !dirty || !form.name.trim()}>
            ${saving ? '...' : (t('organisms.saveChanges') || 'Save changes')}</button>
          <button class="btn-ghost btn-sm" onClick=${() => { setForm(baseline); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      ` : null}
    </div>

    ${(isCreator || isMember) ? html`
      <div class="pj-danger pj-danger-box">
        ${isCreator ? html`
          <div class="pj-danger-row">
            <div class="pj-danger-text">
              <div class="pj-danger-title">${t('organisms.deleteOrganismTitle') || 'Delete this organism'}</div>
              <div class="pj-danger-sub">${delStatsText}</div>
            </div>
            <button class="btn-danger btn-sm" onClick=${() => { setDelOpen(o => !o); setDelName(''); }}>${t('organisms.deleteDots') || 'Delete…'}</button>
          </div>
          ${delOpen ? html`
            <div class="pj-danger-confirm">
              <label class="pj-field"><span>${(t('organisms.confirmTypeName') || 'Type the organism’s name to confirm') + ': ' + (org.name || '')}</span>
                <input type="text" class="input-field input-sm" value=${delName} onInput=${(e) => setDelName(e.target.value)} placeholder=${org.name || ''} /></label>
              <button class="btn-danger btn-sm" disabled=${delName.trim() !== (org.name || '').trim()} onClick=${doDelete}>${t('organisms.delete') || 'Delete'}</button>
            </div>` : null}
        ` : null}
        ${isMember && !isCreator ? html`
          <div class="pj-danger-row">
            <div class="pj-danger-text">
              <div class="pj-danger-title">${t('organisms.leave') || 'Leave'}</div>
            </div>
            <button class="btn-danger btn-sm" onClick=${onLeave}>${t('organisms.leave') || 'Leave'}</button>
          </div>` : null}
      </div>` : null}
  `;

  const reqPill = pendingJoin > 0
    ? (pendingJoin === 1 ? (t('organisms.reqOne') || '1 request') : (t('organisms.reqMany') || '{n} requests').replace('{n}', String(pendingJoin)))
    : null;
  const tabs = [
    { id: 'workspaces', label: t('organisms.tabWorkspaces') || 'Workspaces', count: wsCount },
    { id: 'members', label: t('organisms.tabMembers') || 'Members', count: (org.members || []).length, pill: reqPill },
    { id: 'agents', label: t('organisms.tabAgents') || 'Agents', count: (org.agentGaiis || []).length },
    { id: 'board', label: t('organisms.tabBoard') || 'Board', count: null },
  ];

  // Settings REPLACES the tab content — while it is open no tab is highlighted (a lit tab above
  // settings content lies about what the user is looking at), and the breadcrumb says so.
  const activeHomeTab = showSettings ? '' : tab;
  const pickHomeTab = (id) => guardDirty(() => { setShowSettings(false); setTab(id); });

  return html`
    <div class="pj-ws">
      <div class="pj-org-breadcrumb">
        <button class="pj-org-crumb-link" onClick=${() => guardDirty(onBack)}>${t('organisms.title') || 'Organisms'}</button>
        <span class="pj-org-crumb-sep">/</span>
        ${showSettings ? html`
          <button class="pj-org-crumb-link" onClick=${() => guardDirty(() => setShowSettings(false))}>${(org.name || org.id)}</button>
          <span class="pj-org-crumb-sep">/</span>
          <span>${t('organisms.settings') || 'Settings'}</span>
        ` : html`<span>${(org.name || org.id)}</span>`}
      </div>

      <div class="pj-org-home-head">
        <div class="pj-org-avatar pj-org-avatar-lg" aria-hidden="true">${orgInitials(org.name)}</div>
        <div class="pj-org-home-title">
          <div class="pj-org-titlerow">
            <span class="pj-org-home-name">${(org.name || org.id)}</span>
            <span class="badge badge-info">${typeLabel}</span>
            <span class="badge ${org.visibility === 'public' ? 'badge-success' : 'badge-warn'}">${org.visibility || ''}</span>
          </div>
          ${org.description ? html`<div class="section-desc pj-org-home-desc">${(org.description)}</div>` : null}
        </div>
        <div class="pj-org-home-actions">
          <button class="btn-outline btn-sm" title=${t('organisms.exportOrgHint') || 'Download a ZIP backup of the whole organism (all workspaces)'}
            onClick=${() => exportOrganismZip(org, showToast)}>${'⬇ '}${t('organisms.exportOrg') || 'Export'}</button>
          <button class="btn-outline btn-sm ${showSettings ? 'pj-org-btn-active' : ''}" onClick=${() => guardDirty(() => setShowSettings(s => !s))}>${'⚙ '}${t('organisms.settings') || 'Settings'}</button>
        </div>
      </div>

      <div class="pj-org-tabs" role="tablist">
        ${tabs.map(tb => html`
          <button class="pj-org-tab ${activeHomeTab === tb.id ? 'active' : ''}" role="tab" aria-selected=${activeHomeTab === tb.id} key=${tb.id}
            onClick=${() => pickHomeTab(tb.id)}>
            ${tb.label}${tb.count !== null && tb.count !== undefined ? html`<span class="pj-org-tab-count">${tb.count}</span>` : null}
            ${tb.pill ? html`<span class="pj-tab-pill">${tb.pill}</span>` : null}
          </button>`)}
      </div>

      ${showSettings ? renderSettings() : null}

      ${activeHomeTab === 'workspaces' ? html`
        <${WorkspaceList} org=${org} showToast=${showToast} onOpen=${onOpenWs} onCount=${setWsCount} />
      ` : null}

      ${activeHomeTab === 'members' ? html`
        <${OrgMemberManager} org=${org} ghii=${ghii} canManage=${canEdit} isCreator=${isCreator}
          showToast=${showToast} confirm=${confirm} onChanged=${onChanged} show="members" />` : null}

      ${activeHomeTab === 'agents' ? html`
        <${OrgAgentsPanel} org=${org} ghii=${ghii} canManage=${canEdit} showToast=${showToast} onChanged=${onChanged} />` : null}

      ${activeHomeTab === 'board' ? (org.boardId
        ? html`<${BoardPreview} boardId=${org.boardId} showToast=${showToast} />`
        : html`<div class="card-detail"><div class="section-desc">${t('organisms.noBoard') || 'This organism has no board.'}</div></div>`) : null}

      <${ConfirmUI} />
    </div>`;
}

/* ───────────────── Organism workspace (manifest-driven) ─────────────────
 * Any organism can have a governed workspace. If it has no manifest yet, offer
 * "Set up workspace" (applies the project template). Otherwise render the
 * manifest's object types with the draft → publish → version loop, the publish
 * gate, the approval inbox, and the decision log. */

const PRIMARY_FIELD = { goal: 'title', plan: 'approach', deliverable: 'title', resource: 'label', decision: 'summary' };

/* Workspace list — an organism contains many workspaces (each an independent manifest + data set,
 * namespaced under organism.{id}.w.{wsId}.*). Lists the registry (organism.{id}.meta.workspaces),
 * lets the user create a new one (→ opens its setup/generate screen) or open/delete an existing one. */
/* Rendered embedded in OrganismHome's Workspaces tab (the back/export topbar + organism title
 * moved to the home header). onCount reports the discovered workspace count for the tab badge. */
function WorkspaceList({ org, showToast, onOpen, onCount }) {
  const orgId = org.id;
  const { confirm, ConfirmUI } = useConfirm();
  const [list, setList] = useState(null);   // null = loading
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState('');           // organism dependency-overview chart (mermaid)
  const [showOverview, setShowOverview] = useState(false); // map hidden by default — the list is the content
  const [openReqWs, setOpenReqWs] = useState(null);       // which owned workspace's request-inbox is open
  const [reqInbox, setReqInbox] = useState([]);           // access requests for openReqWs
  const [openPeopleWs, setOpenPeopleWs] = useState(null); // which workspace's inline participants list is open
  const [wsStats, setWsStats] = useState({});             // wsId → { recs, docs, lastEv, hasManifest }
  const [apprByWs, setApprByWs] = useState({});           // wsId → pending review count

  // Discovery: every workspace in the org (membership-gated) with this user's access status. A member
  // sees workspaces they can't yet read (access:'none') so they can request access. Row enrichment
  // (record/doc counts, last event, review counter) loads per workspace afterwards, best effort.
  const load = useCallback(async () => {
    const l = await orgService.discoverWorkspaces(orgId);
    setList(l);
    onCount?.(Array.isArray(l) ? l.length : 0);
    orgService.listApprovals(orgId, 'pending').then(aps => {
      const by = {};
      for (const a of (aps || [])) { const w = a.arguments?.ws; if (w) by[w] = (by[w] || 0) + 1; }
      setApprByWs(by);
    }).catch(() => {});
    for (const w of (l || []).filter(x => x.access !== 'none')) {
      Promise.all([
        orgService.getWorkspace(orgId, w.id).catch(() => null),
        orgService.getWorkspaceActivity(orgId, w.id),
        orgService.getWorkspaceParticipants(orgId, w.id).catch(() => null),
      ]).then(([wsData, act, parts]) => {
        let recs = 0, docs = 0;
        for (const ot of (wsData?.manifest?.objectTypes || []).filter(orgService.isMemorySpace)) {
          const n = new Set([...(wsData.drafts?.[ot.name] || []), ...(wsData.objects?.[ot.name] || [])].map(d => d.id)).size;
          if (orgService.isDocSpace(ot)) docs += n; else recs += n;
        }
        const lastEv = (act?.events || []).reduce((b, e) => (!b || (e.at || '') > (b.at || '') ? e : b), null);
        const owners = [];
        for (const n of (parts?.nodes || [])) for (const o of (n.owners || [])) owners.push({ ...o, node: n.id, isLocalNode: n.isLocal });
        setWsStats(s => ({ ...s, [w.id]: { recs, docs, lastEv, hasManifest: !!wsData?.manifest, owners } }));
      }).catch(() => {});
    }
  }, [orgId, onCount]);
  useEffect(() => { load(); }, [load]);

  const requestAccess = async (w) => {
    setBusy(true);
    try { await orgService.requestWorkspaceAccess(orgId, w.id); showToast((t('organisms.accessRequested') || 'Access requested — {creator} will decide.').replace('{creator}', w.created_by || '')); }
    catch (e) { showToast((e && e.message) || 'Failed to request access'); }
    finally { setBusy(false); }
  };
  const toggleInbox = async (w) => {
    if (openReqWs === w.id) { setOpenReqWs(null); return; }
    setOpenReqWs(w.id); setReqInbox(await orgService.listWorkspaceRequests(orgId, w.id));
  };
  const decide = async (w, requester, decision) => {
    setBusy(true);
    try { await orgService.decideWorkspaceAccess(orgId, w.id, requester, decision); setReqInbox(await orgService.listWorkspaceRequests(orgId, w.id)); }
    catch (e) { showToast((e && e.message) || 'Failed'); }
    finally { setBusy(false); }
  };
  // Rebuild the overview whenever the workspace set changes (deterministic — aggregates members,
  // agents, workspaces + their structure, and knowledge packages).
  useEffect(() => {
    let cancelled = false;
    orgService.buildOrganismOverviewMermaid(orgId).then(c => { if (!cancelled) setOverview(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [orgId, list]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, [load]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const entry = await orgService.createWorkspace(orgId, name);
      setNewName(''); setCreating(false);
      onOpen(entry.id);   // open the new (empty) workspace → its setup / generate screen
    } catch (e) { showToast((e && e.message) || 'Failed to create workspace'); }
    finally { setBusy(false); }
  };

  const remove = (wsId, name) => {
    confirm(
      (t('organisms.deleteWorkspaceConfirm') || 'Delete the workspace “{name}” and all its content? This cannot be undone.').replace('{name}', name),
      async () => {
        setBusy(true);
        try { await orgService.deleteWorkspace(orgId, wsId); await load(); showToast(t('organisms.workspaceDeleted') || 'Workspace deleted'); }
        catch (e) { showToast((e && e.message) || 'Failed to delete'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.deleteWorkspace') || 'Delete workspace' },
    );
  };

  // ── Export (download ZIP backup) + Import (upload a ZIP as a new workspace) ──
  const jwt = () => { try { return window.AIMEAT?.auth?.getSession?.()?.jwt || ''; } catch { return ''; } };
  const fileRef = useRef(null);
  const doExport = async (w) => {
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/export?ws=${encodeURIComponent(w.id)}`, { headers: { Authorization: 'Bearer ' + jwt() } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `workspace-${String(w.name || w.id).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { showToast((e && e.message) || 'Export failed'); }
  };
  const doImport = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/import`, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(), 'Content-Type': 'application/zip' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Import failed');
      showToast(t('organisms.imported') || 'Workspace imported');
      await load();
      if (body.data?.ws) onOpen(body.data.ws);
    } catch (e) { showToast((e && e.message) || 'Import failed'); }
    finally { setBusy(false); }
  };
  // One enriched meta line per row: "{n} records · {n} docs · last: goal/x published 2 h ago".
  const metaLine = (w) => {
    const s = wsStats[w.id];
    if (!s) return w.access === 'owner' ? (t('organisms.yours') || 'yours') : (t('organisms.byCreator') || 'by {creator}').replace('{creator}', w.created_by || '?');
    if (!s.hasManifest) return t('organisms.wsNotSetUp') || 'new — set up when opened';
    const parts = [
      s.recs === 1 ? (t('organisms.recOne') || '1 record') : (t('organisms.recMany') || '{n} records').replace('{n}', String(s.recs)),
      s.docs === 1 ? (t('organisms.docOne') || '1 document') : (t('organisms.docMany') || '{n} documents').replace('{n}', String(s.docs)),
    ];
    if (s.lastEv) {
      const verb = s.lastEv.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited');
      parts.push(`${t('organisms.lastLabel') || 'last:'} ${s.lastEv.type}/${s.lastEv.instance} ${verb} ${relTime(s.lastEv.at)}`);
    } else parts.push(t('organisms.noActivityYet') || 'no activity yet');
    return parts.join(' · ');
  };

  return html`
    <div class="pj-ws-embedded">
      <${ConfirmUI} />
      <input type="file" accept=".zip,application/zip" ref=${fileRef} style="display:none" onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImport(f); }} />
      <div class="section-desc">${t('organisms.workspacesDesc') || 'Workspaces in this organism — each is an independent space with its own documents, records and history.'}</div>

      <div class="pj-ws-bar">
        ${creating ? html`
          <input class="input-field input-sm pj-ws-name-input" autofocus placeholder=${t('organisms.workspaceName') || 'Workspace name'}
            value=${newName} onInput=${e => setNewName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') create(); }} />
          <button class="btn-primary btn-sm" onClick=${create} disabled=${busy || !newName.trim()}>${t('organisms.create') || 'Create'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => { setCreating(false); setNewName(''); }}>${t('organisms.cancel') || 'Cancel'}</button>
        ` : html`
          <button class="btn-primary btn-sm" onClick=${() => setCreating(true)}>${'+ '}${t('organisms.newWorkspace') || 'New workspace'}</button>
          <button class="btn-outline btn-sm" disabled=${busy} title=${t('organisms.importHint') || 'Restore a workspace from a .zip backup'} onClick=${() => fileRef.current && fileRef.current.click()}>${'⬆ '}${t('organisms.import') || 'Import'}</button>
          ${overview ? html`<button class="btn-outline btn-sm ${showOverview ? 'pj-org-btn-active' : ''}" onClick=${() => setShowOverview(s => !s)}>${'🗺 '}${t('organisms.showMap') || 'Map'}</button>` : null}`}
      </div>

      <${OrgSearch} orgId=${orgId} onOpenWorkspace=${(ws) => onOpen(ws)} />

      ${list === null ? html`<${Spinner} />`
        : list.length === 0 ? html`<${EmptyState} icon="🗂️" text=${t('organisms.noWorkspaces') || 'No workspaces yet — create one to get started.'} />`
        : html`
          <div class="pj-org-list">
          ${list.map(w => {
            const locked = w.access === 'none';
            const reviews = apprByWs[w.id] || 0;
            const menuItems = w.access === 'owner' ? [
              { label: t('organisms.requests') || 'Access requests', icon: '👥', onClick: () => toggleInbox(w) },
              { label: t('organisms.export') || 'Export backup (.zip)', icon: '⬇', onClick: () => doExport(w) },
              { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => remove(w.id, w.name || w.id) },
            ] : [];
            return html`
            <div class="pj-org-row" key=${w.id}>
              <div class="pj-org-avatar" aria-hidden="true">${'🗂'}</div>
              <div class="pj-org-main ${locked ? 'pj-org-main-static' : ''}" role=${locked ? undefined : 'button'} tabindex=${locked ? undefined : '0'}
                onClick=${locked ? undefined : (() => onOpen(w.id))}
                onKeyDown=${locked ? undefined : ((e) => { if (e.key === 'Enter') onOpen(w.id); })}>
                <div class="pj-org-titlerow">
                  ${locked ? html`<span class="pj-org-lock">${'🔒'}</span>` : null}
                  <span class="pj-org-name">${(w.name || w.id)}</span>
                  ${reviews > 0 ? html`<span class="pj-tab-pill">${'📨 '}${(t('organisms.toReview') || '{n} to review').replace('{n}', String(reviews))}</span>` : null}
                </div>
                <div class="pj-org-desc">${locked
                  ? (t('organisms.byCreator') || 'by {creator}').replace('{creator}', w.created_by || '?')
                  : metaLine(w)}</div>
              </div>
              <div class="pj-org-stats">
                ${(wsStats[w.id]?.owners || []).length > 0 ? html`
                  <button class="pj-org-stat pj-stat-btn ${openPeopleWs === w.id ? 'active' : ''}" title=${t('organisms.participants') || 'Who works here'}
                    onClick=${(e) => { e.stopPropagation(); setOpenPeopleWs(p => (p === w.id ? null : w.id)); }}>${'👥'} ${wsStats[w.id].owners.length}</button>` : null}
                ${w.created_at ? html`<span class="pj-org-stat pj-org-date" title=${t('organisms.createdAt') || 'Created'}>${fmtDate(w.created_at)}</span>` : null}
              </div>
              ${locked
                ? html`<button class="btn-outline btn-sm pj-org-openbtn" disabled=${busy} onClick=${() => requestAccess(w)}>${t('organisms.requestAccess') || 'Request access'}</button>`
                : html`<button class="btn-outline btn-sm pj-org-openbtn" onClick=${() => onOpen(w.id)}>${t('organisms.open') || 'Open'}</button>`}
              ${menuItems.length ? html`<${KebabMenu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}
              ${openPeopleWs === w.id ? html`
                <div class="pj-org-detail">
                  ${(wsStats[w.id]?.owners || []).map(o => html`
                    <div class="pj-ws-person" key=${'p-' + o.owner}>
                      <span>${'👤 '}<strong>${(o.owner)}</strong></span>
                      ${o.isCreator ? html`<span class="badge badge-success pj-mini">${t('organisms.creatorTag') || 'creator'}</span>` : null}
                      ${o.isSelf ? html`<span class="badge badge-info pj-mini">${t('organisms.you') || 'you'}</span>` : null}
                      ${!o.isLocalNode ? html`<span class="pj-mini">${'🌐 '}${(o.node)}</span>` : null}
                      ${(o.agents || []).length > 0 ? html`<span class="pj-ws-person-agents">${'🤖'} ${(o.agents || []).length}</span>` : null}
                    </div>`)}
                </div>` : null}
              ${openReqWs === w.id ? html`
                <div class="pj-org-detail">
                  ${reqInbox.length === 0 ? html`<div class="pj-ws-inbox-empty">${t('organisms.noRequests') || 'No access requests.'}</div>`
                    : reqInbox.map(r => html`
                      <div class="pj-ws-req" key=${r.requester}>
                        <span class="pj-ws-req-who">${(r.requester)}${r.message ? html` <span class="pj-ws-req-msg">— ${(r.message)}</span>` : null}</span>
                        ${r.status === 'approved'
                          ? html`<span class="pj-ws-req-ok">✓ ${t('organisms.approved') || 'approved'}</span><button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.revoke') || 'Revoke'}</button>`
                          : html`<button class="btn-success btn-sm" disabled=${busy} onClick=${() => decide(w, r.requester, 'approve')}>${t('organisms.approve') || 'Approve'}</button><button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}</button>`}
                      </div>`)}
                </div>` : null}
            </div>`;
          })}
        </div>`}

      ${overview && showOverview ? html`
        <div class="pj-chart">
          <div class="pj-chart-head">
            <span class="pj-chart-title">${'🔗 '}${t('organisms.overview') || 'Overview — who & what uses this organism'}</span>
            <button class="btn-ghost btn-sm" onClick=${() => setShowOverview(false)}>${t('organisms.hide') || 'Hide'}</button>
          </div>
          <${Mermaid} chart=${overview} />
        </div>` : null}
    </div>`;
}

/* Build a GitHub-style contribution calendar from activity events. Each day holds FOUR counters —
 * documents draft/published and records (schema'd) draft/published — so a cell can be drawn as a 2×2
 * quadrant. Returns { cols, monthLabels }: each col is 7 day-slots (Sun→Sat); a future slot is null.
 * Deterministic from the event timestamps. */
function buildHeatmap(byDay, today) {
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const weeks = 53;                                         // always a full year ending today, GitHub-style
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());          // align to the start of a week (Sunday)
  const cols = []; const monthLabels = [];
  let cur = new Date(start); let prevMonth = -1;
  while (cur <= today) {
    monthLabels.push(cur.getMonth() !== prevMonth ? cur.toLocaleString(undefined, { month: 'short' }) : '');
    prevMonth = cur.getMonth();
    const col = [];
    for (let dow = 0; dow < 7; dow++) {
      if (cur > today) { col.push(null); }
      else { col.push({ date: iso(cur), b: byDay.get(iso(cur)) || null }); }
      cur = new Date(cur); cur.setDate(cur.getDate() + 1);
    }
    cols.push(col);
  }
  return { cols, monthLabels };
}
const hmLevel = (n) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
const ZERO_DAY = { dd: 0, dp: 0, rd: 0, rp: 0, total: 0 };

/* One heatmap day = a 2×2 grid: ↖ docs draft, ↗ docs published, ↙ records draft, ↘ records published.
 * Each quadrant's shade is its own count's intensity. */
function hmCell(date, b, key) {
  const c = b || ZERO_DAY;
  const tip = b
    ? `${date} — docs: ${c.dd} draft / ${c.dp} published · records: ${c.rd} draft / ${c.rp} published`
    : `${date} — no activity`;
  return html`<span class="pj-hm-cell" key=${key} title=${tip}>
    <i class="q lvl${hmLevel(c.dd)}"></i><i class="q lvl${hmLevel(c.dp)}"></i>
    <i class="q lvl${hmLevel(c.rd)}"></i><i class="q lvl${hmLevel(c.rp)}"></i>
  </span>`;
}

/* Activity panel — a GitHub-style contribution heatmap of the workspace's history, where every day is
 * split 2×2 into documents vs records × draft vs published (quadrant shade = intensity) — plus the
 * recent activity log (who did what, where, when), which doubles as an audit trail. Built from
 * GET …/workspace/activity (derived from version history). */
function ActivityPanel({ orgId, wsId }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const fetchIt = () => orgService.getWorkspaceActivity(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
    fetchIt();
    window.addEventListener('aimeat-live-update', fetchIt);
    return () => { cancelled = true; window.removeEventListener('aimeat-live-update', fetchIt); };
  }, [orgId, wsId]);
  if (!data || !(data.events || []).length) return null;
  const events = data.events;
  const byDay = new Map();
  for (const e of events) {
    const day = (e.at || '').slice(0, 10); if (!day) continue;
    const b = byDay.get(day) || { dd: 0, dp: 0, rd: 0, rp: 0, total: 0 };
    const doc = e.mode === 'document';
    if (e.action === 'draft') { if (doc) b.dd++; else b.rd++; } else if (doc) b.dp++; else b.rp++;
    b.total++; byDay.set(day, b);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { cols, monthLabels } = buildHeatmap(byDay, today);

  return html`
    <div class="pj-chart">
      <div class="pj-chart-head">
        <span class="pj-chart-title">${'📊 '}${t('organisms.activity') || 'Activity'}<span class="pj-act-count">${data.total} ${t('organisms.events') || 'events'}</span></span>
        <button class="btn-ghost btn-sm" onClick=${() => setShow(s => !s)}>${show ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
      </div>
      ${show ? html`
        <div class="pj-act">
          <div class="pj-hm">
            <div class="pj-hm-monthrow">${monthLabels.map((m, i) => html`<span class="pj-hm-month" key=${i}>${m}</span>`)}</div>
            <div class="pj-hm-body">
              <div class="pj-hm-daycol"><span></span><span>${t('organisms.mon') || 'Mon'}</span><span></span><span>${t('organisms.wed') || 'Wed'}</span><span></span><span>${t('organisms.fri') || 'Fri'}</span><span></span></div>
              <div class="pj-hm-cols">
                ${cols.map((col, ci) => html`<div class="pj-hm-col" key=${ci}>
                  ${col.map((cell, ri) => cell === null
                    ? html`<span class="pj-hm-cell future" key=${ri}></span>`
                    : hmCell(cell.date, cell.b, ri))}
                </div>`)}
              </div>
            </div>
          </div>
          <div class="pj-hm-legend">
            <div class="pj-hm-quadkey">
              <span class="pj-hm-cell"><i class="q lvl1"></i><i class="q lvl3"></i><i class="q lvl2"></i><i class="q lvl4"></i></span>
              <div class="pj-hm-quadlabels">
                <span>${'↖ '}${t('organisms.docsDraft') || 'Docs draft'}</span><span>${'↗ '}${t('organisms.docsPublished') || 'Docs published'}</span>
                <span>${'↙ '}${t('organisms.recordsDraft') || 'Records draft'}</span><span>${'↘ '}${t('organisms.recordsPublished') || 'Records published'}</span>
              </div>
            </div>
            <div class="pj-hm-intensity">
              <span>${t('organisms.less') || 'Less'}</span>
              <i class="q lvl0"></i><i class="q lvl1"></i><i class="q lvl2"></i><i class="q lvl3"></i><i class="q lvl4"></i>
              <span>${t('organisms.more') || 'More'}</span>
            </div>
          </div>
          <div class="pj-act-list">
            ${events.slice(0, 20).map((e, i) => html`<div class="pj-act-item" key=${i}>
              <span class="pj-act-dot ${e.action}"></span>
              <span class="pj-act-time">${dt(e.at)}</span>
              <span class="pj-act-who">${(e.actor)}</span>
              ${e.agent ? html`<span class="pj-act-agent" title=${t('organisms.viaAgent') || 'via this agent'}>${'🤖 '}${(e.agent)}</span>` : null}
              <span class="pj-act-act">${e.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited')}</span>
              <span class="pj-act-what">${(e.mode === 'document' ? '📄' : '🗂')} ${(e.type)}${' / '}${(e.instance)}</span>
            </div>`)}
          </div>
        </div>` : null}
    </div>`;
}

/* Participants panel — who takes part in this workspace, as a node → owner → agents chart plus a
 * listing. Built from the records' identity traces (humans + their agents) + organism membership.
 * The viewer's own agents are named; everyone else's appear as anonymous ghost boxes. */
function ParticipantsPanel({ orgId, wsId, showToast }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState(true);
  const [access, setAccess] = useState(null);     // { requests, members } — only for the workspace creator
  const [grantee, setGrantee] = useState('');
  const [role, setRole] = useState('contributor');
  const [busy, setBusy] = useState(false);
  // The viewer's own agents advertising a workspace contract (tag 'workspace-contract' +
  // optional 'contract.<name>' tags) — surfaced here so a user looking at a workspace sees
  // straight away which of their agents can serve it.
  const [contractAgents, setContractAgents] = useState([]);
  const [adoptBusy, setAdoptBusy] = useState('');   // `${gaii}:${contract}` of the in-flight adopt
  useEffect(() => {
    listAgents().then(a => setContractAgents((a || []).filter(offersWorkspaceContract))).catch(() => {});
  }, []);
  // One-click adoption: queue the agreed adopt-contract task (docs/agent-workspace-contracts.md
  // §7c) — the agent provisions its contract's spaces itself and the task completion is the ack.
  const adopt = async (a, contract) => {
    const key = `${a.gaii}:${contract || ''}`;
    setAdoptBusy(key);
    try {
      const r = await adoptContractTask(a.name, { organismId: orgId, ws: wsId, contract });
      if (r?.ok === false) showToast?.(r?.error?.message || (t('organisms.adoptFailed') || 'Could not queue the adoption task'));
      else showToast?.((t('organisms.adoptQueued') || 'Adoption task queued for {agent} — it provisions the contract and reports back').replace('{agent}', a.display_name || a.name));
    } catch (e) { showToast?.((e && e.message) || (t('organisms.adoptFailed') || 'Could not queue the adoption task')); }
    finally { setAdoptBusy(''); }
  };
  useEffect(() => {
    let cancelled = false;
    const fetchIt = () => orgService.getWorkspaceParticipants(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
    fetchIt();
    window.addEventListener('aimeat-live-update', fetchIt);
    return () => { cancelled = true; window.removeEventListener('aimeat-live-update', fetchIt); };
  }, [orgId, wsId]);
  const isManager = !!(data && (data.nodes || []).some(n => (n.owners || []).some(o => o.isSelf && o.isCreator)));
  const loadAccess = () => orgService.getWorkspaceAccess(orgId, wsId).then(setAccess).catch(() => {});
  useEffect(() => { if (isManager) loadAccess(); }, [isManager, orgId, wsId, data]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !(data.nodes || []).length) return null;
  const owners = [];
  for (const n of data.nodes) for (const o of (n.owners || [])) owners.push({ ...o, node: n.id, isLocalNode: n.isLocal });

  const after = async (p) => { setBusy(true); try { await p; await loadAccess(); } catch (e) { /* the row stays so the user can retry */ } finally { setBusy(false); } };
  const doGrant = (g, r) => { const name = (g || '').trim(); if (name) { after(orgService.grantWorkspaceRole(orgId, wsId, name, r)); setGrantee(''); } };
  const doRevoke = (g) => after(orgService.revokeWorkspaceRole(orgId, wsId, g));
  const doDecide = (requester, decision) => after(orgService.decideWorkspaceAccess(orgId, wsId, requester, decision));
  const pending = (access?.requests || []).filter(r => r.status === 'pending');
  const members = access?.members || [];

  return html`
    <div class="pj-chart">
      <div class="pj-chart-head">
        <span class="pj-chart-title">${'👥 '}${t('organisms.participants') || 'Who works here'}</span>
        <button class="btn-ghost btn-sm" onClick=${() => setShow(s => !s)}>${show ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
      </div>
      ${show ? html`
        <div class="pj-parts">
          ${contractAgents.length ? html`
            <div class="pj-contract-agents">
              <div class="pj-access-title">${'📜 '}${t('organisms.contractAgents') || 'Your contract agents'}</div>
              <div class="section-desc">${t('organisms.contractAgentsDesc') || 'These agents of yours advertise a workspace contract — they can process a workspace like this one. Grant access (below) or attach them in the organism Agents tab.'}</div>
              <div class="pj-part-agents">
                ${contractAgents.map(a => {
                  const names = contractNamesOf(a);
                  // An agent already working in THIS workspace (it appears among the viewer's own
                  // agents in the participants data) gets a ✓ instead of Adopt buttons — offering
                  // adoption for an agent that is already here is noise, and the task would be a
                  // no-op re-provision anyway.
                  const here = owners.some(o => o.isSelf && (o.agents || []).some(ag => ag.isOwn && ag.name === a.name));
                  // One adopt action per advertised contract (a single unnamed one falls back to
                  // the bare marker). The agent does the rest — join, provision, complete the task.
                  const actions = names.length ? names : [''];
                  return html`
                    <span class="pj-part-agent own" key=${a.gaii} title=${a.gaii}>
                      ${'📜 '}${a.display_name || a.name}
                      ${here ? html`<span class="badge badge-success pj-mini" title=${t('organisms.contractActiveHint') || 'This agent already works in this workspace'}>${'✓ '}${t('organisms.contractActive') || 'active here'}</span>`
                        : actions.map(c => html`
                        <button class="btn-outline btn-sm pj-adopt-btn" key=${c} disabled=${adoptBusy === `${a.gaii}:${c}`}
                          title=${t('organisms.adoptHint') || 'Queue a task for this agent to adopt its contract into THIS workspace (it provisions the spaces itself)'}
                          onClick=${() => adopt(a, c)}>
                          ${adoptBusy === `${a.gaii}:${c}` ? '…' : `${t('organisms.adoptContract') || 'Adopt'}${c ? ` ${c}` : ''}`}
                        </button>`)}
                    </span>`;
                })}
              </div>
            </div>` : null}
          <${Mermaid} chart=${orgService.buildParticipantsMermaid(data)} />
          <div class="pj-parts-list">
            ${owners.map((o, i) => html`<div class="pj-part-owner" key=${i}>
              <div class="pj-part-human">
                <span>${'👤 '}<strong>${(o.owner)}</strong></span>
                ${o.isSelf ? html`<span class="badge badge-info pj-mini">${t('organisms.you') || 'you'}</span>` : null}
                ${o.isCreator ? html`<span class="badge badge-success pj-mini">${t('organisms.creatorTag') || 'creator'}</span>` : null}
                ${!o.isMember && !o.isSelf ? html`<span class="badge badge-warn pj-mini">${t('organisms.guest') || 'guest'}</span>` : null}
                ${!o.isLocalNode ? html`<span class="pj-part-node">${'🌐 '}${(o.node)}</span>` : null}
                ${o.contributions ? html`<span class="pj-part-count" title=${t('organisms.contributions') || 'contributions'}>${o.contributions}</span>` : null}
              </div>
              ${(o.agents || []).length ? html`<div class="pj-part-agents">
                ${o.agents.map((a, j) => html`
                  <span class="pj-part-agent ${a.isOwn ? 'own' : 'ghost'}" key=${j}
                    title=${a.isOwn ? '' : (t('organisms.otherAgentHint') || 'Another owner’s agent — you see what it has done here, not its live status')}>
                    ${'🤖 '}${(a.name)}<span class="pj-part-count">${a.contributions}</span>
                  </span>`)}
              </div>` : null}
            </div>`)}
          </div>
          ${isManager ? html`
            <div class="pj-access">
              <div class="pj-access-title">${t('organisms.manageAccess') || 'Manage who can work here'}</div>
              ${pending.map(r => html`<div class="pj-access-row" key=${'req-' + r.requester}>
                <span class="pj-access-who">${'🙋 '}<strong>${(r.requester)}</strong> <span class="pj-access-note">${t('organisms.requestedAccess') || 'requested access'}</span></span>
                <span class="pj-access-actions">
                  <button class="btn-success btn-sm" disabled=${busy} onClick=${() => doDecide(r.requester, 'contributor')}>${t('organisms.addAsContributor') || 'Add as contributor'}</button>
                  <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => doDecide(r.requester, 'viewer')}>${t('organisms.addAsViewer') || 'as viewer'}</button>
                  <button class="btn-danger btn-sm" disabled=${busy} onClick=${() => doDecide(r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}</button>
                </span>
              </div>`)}
              ${members.map(m => html`<div class="pj-access-row" key=${'mem-' + m.owner}>
                <span class="pj-access-who">${'👤 '}<strong>${(m.owner)}</strong> <span class="badge ${m.role === 'contributor' ? 'badge-success' : 'badge-info'} pj-mini">${m.role === 'contributor' ? (t('organisms.roleContributorShort') || 'contributor') : (t('organisms.roleViewerShort') || 'viewer')}</span></span>
                <span class="pj-access-actions">
                  ${m.role === 'viewer'
                    ? html`<button class="btn-outline btn-sm" disabled=${busy} onClick=${() => doGrant(m.owner, 'contributor')}>${t('organisms.makeContributor') || '→ can write'}</button>`
                    : html`<button class="btn-outline btn-sm" disabled=${busy} onClick=${() => doGrant(m.owner, 'viewer')}>${t('organisms.makeViewer') || '→ read only'}</button>`}
                  <button class="btn-danger btn-sm" disabled=${busy} onClick=${() => doRevoke(m.owner)}>${t('organisms.remove') || 'Remove'}</button>
                </span>
              </div>`)}
              <div class="pj-access-add">
                <input class="pj-access-input" placeholder=${t('organisms.addMemberPlaceholder') || 'owner name (or owner@node / agent#owner@node)'} value=${grantee}
                  onInput=${e => setGrantee(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') doGrant(grantee, role); }} />
                <select class="pj-access-role" value=${role} onChange=${e => setRole(e.target.value)}>
                  <option value="contributor">${t('organisms.roleContributor') || 'contributor (read + write)'}</option>
                  <option value="viewer">${t('organisms.roleViewer') || 'viewer (read only)'}</option>
                </select>
                <button class="btn-primary btn-sm" disabled=${busy || !grantee.trim()} onClick=${() => doGrant(grantee, role)}>${'+ '}${t('organisms.addMember') || 'Add'}</button>
              </div>
              <div class="pj-access-hint">${t('organisms.accessHint') || 'Members can be a different account; their agents inherit the role. Viewers read; contributors read + write.'}</div>
            </div>` : null}
        </div>` : null}
    </div>`;
}

/**
 * Comment thread on one workspace object (record or document). Targeted by orgId+ws+space+instanceId.
 * Members read + add comments; an author (or org admin) deletes. Supports an optional quote anchor
 * (comment on a specific passage) and threaded replies (parentId). Backend: /v1/organisms/:id/comments.
 * Agents use the same endpoints via aimeat_workspace_comment(s).
 */
function WorkspaceComments({ orgId, ws, space, instanceId, showToast }) {
  const [comments, setComments] = useState(null);
  const [body, setBody] = useState('');
  const [anchorQuote, setAnchorQuote] = useState('');
  const [replyTo, setReplyTo] = useState(null);   // { id, body } of the comment being replied to
  const [busy, setBusy] = useState(false);
  const me = (() => { try { return window.AIMEAT?.auth?.getSession?.() || {}; } catch { return {}; } })();
  const mine = (author) => author && (author === me.gaii || author === me.ghii);

  const load = useCallback(async () => {
    if (!ws || !space || !instanceId) return;
    const r = await orgService.listComments(orgId, ws, space, instanceId).catch(() => null);
    setComments(r?.data?.comments || []);
  }, [orgId, ws, space, instanceId]);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const h = () => liveRef.current();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, []);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const anchor = anchorQuote.trim() ? { quote: anchorQuote.trim() } : undefined;
      const r = await orgService.addComment(orgId, { ws, space, instanceId, body: text, anchor, parentId: replyTo?.id });
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.commentFailed') || 'Could not post comment'));
      else { setBody(''); setAnchorQuote(''); setReplyTo(null); await load(); }
    } catch (e) { showToast((e && e.message) || (t('organisms.commentFailed') || 'Could not post comment')); }
    finally { setBusy(false); }
  };
  const remove = async (c) => {
    setBusy(true);
    try {
      const r = await orgService.deleteComment(orgId, c.id, ws, space, instanceId);
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.commentDeleteFailed') || 'Could not delete'));
      else await load();
    } catch (e) { showToast((e && e.message) || (t('organisms.commentDeleteFailed') || 'Could not delete')); }
    finally { setBusy(false); }
  };

  const list = comments || [];
  return html`
    <div class="pj-comments">
      <div class="detail-label">${(t('organisms.commentsHeading') || 'Comments') + (list.length ? ` (${list.length})` : '')}</div>
      ${comments === null ? html`<div class="section-desc">…</div>` : null}
      ${comments !== null && list.length === 0 ? html`<div class="section-desc">${t('organisms.noComments') || 'No comments yet.'}</div>` : null}
      ${list.map(c => html`
        <div class="pj-comment ${c.parentId ? 'pj-comment-reply' : ''}" key=${c.id}>
          <div class="pj-comment-head">
            <b>${(c.author || '?')}</b>
            ${c.parentId ? html`<span class="pj-mini"> · ${t('organisms.inReply') || 'reply'}</span>` : null}
            ${c.anchor?.quote ? html`<span class="pj-mini"> · “${(String(c.anchor.quote).slice(0, 80))}”</span>` : null}
            ${c.anchor?.section ? html`<span class="pj-mini"> · §${(c.anchor.section)}</span>` : null}
            <span class="pj-mini"> · ${c.createdAt ? dt(c.createdAt) : ''}</span>
          </div>
          <div class="pj-comment-body">${(c.body || '')}</div>
          <div class="pj-comment-actions">
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => setReplyTo({ id: c.id, body: c.body })}>${t('organisms.reply') || 'Reply'}</button>
            ${mine(c.author) ? html`<button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => remove(c)}>${t('organisms.delete') || 'Delete'}</button>` : null}
          </div>
        </div>
      `)}
      <div class="pj-comment-compose">
        ${replyTo ? html`<div class="pj-mini">${t('organisms.replyingTo') || 'Replying to'}: “${(String(replyTo.body || '').slice(0, 60))}” <button class="btn-ghost btn-sm" onClick=${() => setReplyTo(null)}>${t('organisms.cancel') || 'Cancel'}</button></div>` : null}
        <input class="input-field input-sm" placeholder=${t('organisms.anchorQuotePlaceholder') || 'Optional: quote a passage to anchor the comment'} value=${anchorQuote} onInput=${(e) => setAnchorQuote(e.target.value)} />
        <textarea class="input-field input-sm" rows="2" placeholder=${t('organisms.commentPlaceholder') || 'Add a comment…'} value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
        <button class="btn-primary btn-sm" disabled=${busy || !body.trim()} onClick=${submit}>${t('organisms.postComment') || 'Comment'}</button>
      </div>
    </div>
  `;
}

function Workspace({ org, wsId, showToast, onBack, onBackToList }) {
  const orgId = org.id;
  // Registry name for the breadcrumb (the manifest's name can differ from the workspace's name).
  const [wsName, setWsName] = useState('');
  useEffect(() => {
    let cancelled = false;
    orgService.listWorkspaces(orgId).then(list => {
      if (cancelled) return;
      const name = (list.find(w => w.id === wsId)?.name) || '';
      setWsName(name);
      // Feed the home page's "Continue" list with a real display name.
      recordRecent({ type: 'workspace', id: `${orgId}/${wsId}`, label: name || wsId, sub: org.name || '', data: { orgId, wsId } });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [orgId, wsId]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Pop a document out into its own window (served by doc-solo.js) so several can sit side by side,
  // each independent. The window name is unique per document, so re-clicking focuses the open one.
  const popOut = (typeName, docId) => {
    const u = '/v1/profile?doc=' + encodeURIComponent(`${orgId}:${wsId}:${typeName}:${docId}`);
    window.open(u, 'aimeatdoc_' + orgId + '_' + wsId + '_' + docId, 'width=940,height=1040,menubar=no,toolbar=no,location=no,status=no');
  };
  const { confirm, ConfirmUI } = useConfirm();
  const [ws, setWs] = useState(undefined); // undefined=loading, null=no manifest, object=workspace
  const [approvals, setApprovals] = useState([]);
  const [gateOn, setGateOn] = useState(false);
  const [adding, setAdding] = useState(null);          // objectType name being added
  const [addingSchema, setAddingSchema] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sName, setSName] = useState('');
  const [sSummary, setSSummary] = useState('');
  const [sAutonomy, setSAutonomy] = useState('L3');
  const [genDesc, setGenDesc] = useState('');
  const [genBusy, setGenBusy] = useState(false);     // AI "Generate" in flight
  const [applyBusy, setApplyBusy] = useState(false); // "Validate & apply" (pasted JSON) in flight
  const [hasAiKey, setHasAiKey] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [genErrors, setGenErrors] = useState([]);   // validation errors (JSON present, fixable)
  const [genFail, setGenFail] = useState('');        // generation failure (AI call timed out / errored)
  // { type, mode:'view'|'edit', page } for document-mode types. Restored from sessionStorage on F5
  // so the user returns to the document they were on (only the id is kept; renderDocSpace re-resolves
  // it to the live entry once the workspace loads).
  const docKey = 'aimeat.ws.' + orgId + '.' + wsId + '.activeDoc';
  const [activeDoc, setActiveDoc] = useState(() => {
    try {
      const raw = sessionStorage.getItem(docKey);
      if (raw) { const v = JSON.parse(raw); if (v && v.type && v.id) return { type: v.type, mode: v.mode === 'edit' ? 'edit' : 'view', page: { id: v.id } }; }
    } catch (e) { /* noop */ }
    return null;
  });
  // Active tab — Overview first (ALWAYS the landing view: the whole workspace on one scroll),
  // then one tab per manifest space + fixed Sources/Share/Review/Activity/People. Deliberately
  // NOT persisted: opening a workspace must show the overview, not whatever tab was last open.
  const [tab, setTab] = useState('overview');
  const [sectionsByType, setSectionsByType] = useState({});  // { typeName: [{id,name,parentId,documents:[docId]}] }
  const [editingSec, setEditingSec] = useState(null);        // section id currently being renamed inline
  const draggedDoc = useRef(null);                            // { type, id } of the doc being dragged
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');   // typed-name confirmation for delete
  const [newSpaceName, setNewSpaceName] = useState('');
  const [addingInitial, setAddingInitial] = useState(null);   // record being edited (null = new draft)
  const [addingId, setAddingId] = useState(null);             // its id, preserved so save overwrites
  const [expandedRec, setExpandedRec] = useState({});         // { "type:id": true } — records expanded to view fields
  const [showSpaces, setShowSpaces] = useState(false);        // inline add-space form at the workspace top
  const [showFlow, setShowFlow] = useState(true);             // the manifest-defined edit-flow chart (first item)
  const [share, setShare] = useState(null);                   // { public, spaces, docs } — lazy-loaded when Settings opens
  const [shareBusy, setShareBusy] = useState(false);
  const [wsEvents, setWsEvents] = useState([]);               // activity events — Overview strip + per-tab unseen badges
  const [ovOpen, setOvOpen] = useState({});                   // Overview accordion: { spaceName: bool } (mobile starts collapsed)
  const [ovDoc, setOvDoc] = useState(null);                   // Overview inline document (mobile): { type, id, mode }

  // ── Unseen-change tracking: per-tab "seen" marks in localStorage (they survive sessions).
  // A tab's badge counts items changed since the tab was last opened; opening it (or changes
  // landing while it is open) marks it seen. First-ever visit seeds a baseline at "now", so
  // history never shows as unseen. Neutral gray badges only — red is reserved for errors.
  const seenKey = 'aimeat.ws.' + orgId + '.' + wsId + '.seen';
  const [seen, setSeen] = useState(() => {
    try { const raw = localStorage.getItem(seenKey); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  });
  const markSeen = useCallback((tabId) => setSeen(prev => {
    const next = { ...(prev || {}), [tabId]: new Date().toISOString() };
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch (e) { /* noop */ }
    return next;
  }), [seenKey]);
  // Items (not raw events) changed since the tab's seen mark. The user's own non-agent edits
  // are not news to them, so they never count. Event actors come as the BARE owner name from
  // the version history, so compare against both the bare name and the full GHII.
  const unseenOf = useCallback((tabId) => {
    if (!seen) return 0;
    const base = seen[tabId] || seen.__base;
    if (!base) return 0;
    const me = getGhii();
    const meBare = String(me || '').split('@')[0];
    const isOwn = (e) => !e.agent && me && (e.actor === me || e.actor === meBare);
    const match = tabId.startsWith('space:') ? (e) => e.type === tabId.slice(6)
      : (tabId === 'activity' ? () => true : () => false);
    const evs = wsEvents.filter(e => (e.at || '') > base && match(e) && !isOwn(e));
    return new Set(evs.map(e => (e.type || '') + ':' + (e.instance || ''))).size;
  }, [seen, wsEvents]);

  const load = useCallback(async () => {
    const w = await orgService.getWorkspace(orgId, wsId).catch(() => null);
    if (w && w.manifest) {
      const [ap, cfg, secs, act] = await Promise.all([
        orgService.listApprovals(orgId, 'pending').catch(() => []),
        orgService.getConfig(orgId).catch(() => ({})),
        orgService.getAllSections(orgId, wsId).catch(() => ({})),
        orgService.getWorkspaceActivity(orgId, wsId).catch(() => ({ events: [] })),
      ]);
      setApprovals(ap); setGateOn(!!(cfg?.gates?.publish?.enabled)); setSectionsByType(secs);
      setWsEvents(act?.events || []);
    }
    setWs(w && w.manifest ? w : null);
  }, [orgId, wsId]);

  useEffect(() => { load(); }, [load]);

  // Persist the open document (id only) so an F5 returns to it. Skip unsaved new docs (no id yet).
  useEffect(() => {
    try {
      if (activeDoc?.type && activeDoc.page?.id) sessionStorage.setItem(docKey, JSON.stringify({ type: activeDoc.type, id: activeDoc.page.id, mode: activeDoc.mode }));
      else sessionStorage.removeItem(docKey);
    } catch (e) { /* noop */ }
  }, [activeDoc, docKey]);

  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // First-ever visit: seed the seen baseline once the workspace has loaded — no badges for history.
  useEffect(() => {
    if (seen !== null || ws === undefined) return;
    const next = { __base: new Date().toISOString() };
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch (e) { /* noop */ }
    setSeen(next);
  }, [seen, ws]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Changes landing on the tab the user is LOOKING at are seen immediately — otherwise a draft
  // saved while you're on its space tab would raise that tab's own badge.
  useEffect(() => {
    if (!seen || showSettings) return;
    const cur = tab || 'overview';
    if (unseenOf(cur) > 0) markSeen(cur);
  }, [wsEvents, tab, showSettings, seen, unseenOf, markSeen]);

  const setup = useCallback(async () => {
    setBusy(true);
    try {
      await orgService.applyProjectTemplate(orgId, wsId, org.name || 'Project', org.description || '');
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      await load();
    } catch (e) { showToast((e && e.message) || (t('organisms.setupError') || 'Failed to set up workspace')); }
    finally { setBusy(false); }
  }, [orgId, org, showToast, load]);

  // Validate the JSON first; save only if clean. On errors, surface them (+ a fix prompt for the AI).
  const validateAndApply = useCallback(async (jsonText, fromGenerator) => {
    setGenErrors([]); setGenFail('');
    let generated;
    try { generated = orgService.parseGenerated(jsonText); }
    catch (e) { setGenErrors([(e && e.message) || 'Invalid JSON']); return; }
    const errs = orgService.validateGenerated(generated);
    if (errs.length) { setGenErrors(errs); return; }
    // The Generate flow owns genBusy; a direct paste-apply spins its own button only.
    const setBusyFn = fromGenerator ? setGenBusy : setApplyBusy;
    setBusyFn(true);
    try {
      await orgService.applyGeneratedWorkspace(orgId, wsId, generated);
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      if (fromGenerator) setShowSettings(true);   // open settings so the user can tweak the generated workspace
      await load();
    } catch (e) { setGenErrors([(e && e.message) || (t('organisms.applyError') || 'Could not apply — check the JSON.')]); }
    finally { setBusyFn(false); }
  }, [orgId, showToast, load]);

  const generate = useCallback(async () => {
    if (!genDesc.trim()) return;
    setGenBusy(true); setGenErrors([]); setGenFail('');
    try {
      const raw = await orgService.generateRaw(genDesc.trim(), showRegenerate ? ws?.manifest : null);
      setPasteText(raw);                  // show the generated JSON in the box
      await validateAndApply(raw, true);
    } catch (e) {
      setGenFail(e?.code === 'NO_API_KEY'
        ? (t('organisms.noAiKey') || 'Set up your OpenRouter key above, or copy the prompt to your own AI chat.')
        : ((e && e.message) || (t('organisms.generateError') || 'Generation failed')));
    } finally { setGenBusy(false); }
  }, [genDesc, validateAndApply, showRegenerate, ws]);

  const copyPrompt = useCallback(async () => {
    try {
      await copyToClipboard(await orgService.buildGeneratorPrompt(genDesc.trim(), showRegenerate ? ws?.manifest : null));
      showToast(t('organisms.promptCopied') || 'Prompt copied — paste it into any AI chat, then paste the JSON it returns below.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [genDesc, showToast, showRegenerate, ws]);

  const applyPasted = useCallback(() => { if (pasteText.trim()) validateAndApply(pasteText, false); }, [pasteText, validateAndApply]);

  const copyFixPrompt = useCallback(async () => {
    try {
      await copyToClipboard(orgService.buildFixPrompt(pasteText, genErrors));
      showToast(t('organisms.fixPromptCopied') || 'Fix prompt copied — paste it back to your AI, then paste the corrected JSON.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [pasteText, genErrors, showToast]);

  const startAdd = useCallback(async (ot) => {
    setAddingInitial(null); setAddingId(null);
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, wsId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId, wsId]);

  // Open the same schema form pre-filled with an existing draft — so a record can be reviewed/edited
  // (not just published blind). Saving overwrites the same draft id.
  const startEdit = useCallback(async (ot, rec) => {
    setAddingInitial(rec); setAddingId(rec.id);
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, wsId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId, wsId]);
  const cancelForm = () => { setAdding(null); setAddingSchema(null); setAddingInitial(null); setAddingId(null); };
  const toggleExpand = (ot, id) => setExpandedRec(s => ({ ...s, [ot.name + ':' + id]: !s[ot.name + ':' + id] }));
  // Read-only field view for a record (skips the underscore-prefixed metadata the read attaches).
  // Manifest-carried workspace translations (generated workspaces): field labels at
  // "{namespace}.{field}", hints at "{namespace}.{field}.hint", space labels at "type.{name}".
  // Resolution: active locale → en → '' (callers fall back to the raw key/name).
  const wsT = useCallback((key) => {
    const m = ws?.manifest?.i18n;
    if (!m || typeof m !== 'object') return '';
    const lang = getLocale();
    return (m[lang] && m[lang][key]) || (m.en && m.en[key]) || '';
  }, [ws]);
  const recordFields = (ot, rec) => {
    const rows = Object.entries(rec || {}).filter(([k, v]) =>
      !k.startsWith('_') && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (!rows.length) return html`<div class="pj-muted pj-rec-empty">${t('organisms.noFields') || 'No fields'}</div>`;
    return rows.map(([k, v]) => html`<${KeyValueRow} key=${k} label=${wsT(`${ot.namespace}.${k}`) || k}
      value=${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : String(v))} />`);
  };

  const saveDraft = useCallback(async (ot, value) => {
    const id = (String(value.id || '').trim() || `${ot.name}-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { ...value, id });
      if (r?.ok === false) { showToast(r?.error?.message || 'Draft rejected'); }
      else { showToast(t('organisms.draftSaved') || 'Draft saved'); setAdding(null); setAddingSchema(null); await load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to save draft'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  // Documents are free-form markdown records ({id,title,markdown}) — same draft/publish path.
  // When created from a section, file the new id into that section's documents[].
  const savePage = useCallback(async (ot, page, sectionId) => {
    const id = (String(page.id || '').trim() || `doc-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { id, title: page.title, markdown: page.markdown });
      if (r?.ok === false) { showToast(r?.error?.message || 'Document rejected'); }
      else {
        if (sectionId) {
          const secs = (sectionsByType[ot.name] || []).map(s => s.id === sectionId
            ? { ...s, documents: [...(s.documents || []).filter(d => d !== id), id] } : s);
          await orgService.saveSections(orgId, wsId, ot.name, secs).catch(() => {});
        }
        // Reload, then open the just-saved document (view mode). renderDocSpace re-resolves the id
        // to the fresh merged entry, so the new draft shows with its badge instead of the empty state.
        showToast(t('organisms.pageSaved') || 'Document saved'); await load(); setActiveDoc({ type: ot.name, mode: 'view', page: { id } });
      }
    } catch (e) { showToast((e && e.message) || 'Failed to save document'); }
    finally { setBusy(false); }
  }, [orgId, sectionsByType, showToast, load]);

  // ── Section index ops (persist organism.{id}.meta.sections.{typeName}) ──
  const updateSections = useCallback(async (typeName, sections) => {
    setSectionsByType(s => ({ ...s, [typeName]: sections }));
    await orgService.saveSections(orgId, wsId, typeName, sections).catch(e => showToast((e && e.message) || 'Failed to save sections'));
  }, [orgId, showToast]);
  const addSection = (typeName, parentId) => {
    const id = 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    updateSections(typeName, [...(sectionsByType[typeName] || []), { id, name: '', parentId: parentId || null, documents: [] }]);
    setEditingSec(id);   // open the new section in rename mode; it becomes plain text once named/blurred
  };
  const renameSection = (typeName, secId, name) =>
    updateSections(typeName, (sectionsByType[typeName] || []).map(s => s.id === secId ? { ...s, name } : s));
  const removeSection = (typeName, secId, secName) => {
    confirm(
      (t('organisms.confirmRemoveSection') || 'Remove the section “{name}”? Its documents move to Unsorted — they are not deleted.').replace('{name}', secName || '…'),
      () => updateSections(typeName, (sectionsByType[typeName] || []).filter(s => s.id !== secId).map(s => s.parentId === secId ? { ...s, parentId: null } : s)),
      { danger: true, title: t('organisms.removeSection') || 'Remove section' },
    );
  };
  const moveDocToSection = (typeName, docId, targetSecId) => {
    const secs = (sectionsByType[typeName] || []).map(s => ({ ...s, documents: (s.documents || []).filter(d => d !== docId) }));
    if (targetSecId) { const i = secs.findIndex(s => s.id === targetSecId); if (i >= 0) secs[i] = { ...secs[i], documents: [...secs[i].documents, docId] }; }
    updateSections(typeName, secs);
  };
  // Inline rename: update the name locally per keystroke, persist once on blur (no write storm).
  const sectionsRef = useRef(sectionsByType); sectionsRef.current = sectionsByType;
  const setSecName = (typeName, secId, name) =>
    setSectionsByType(s => ({ ...s, [typeName]: (s[typeName] || []).map(x => x.id === secId ? { ...x, name } : x) }));
  const commitSecName = (typeName) => { setEditingSec(null); orgService.saveSections(orgId, wsId, typeName, sectionsRef.current[typeName] || []).catch(() => {}); };

  const publish = useCallback(async (ot, instanceId) => {
    setBusy(true);
    try {
      const r = await orgService.publishDraft(orgId, wsId, ot.namespace, instanceId);
      if (r?.data?.gated) showToast(t('organisms.publishGated') || 'Sent for review (publish gate is on)');
      else showToast((t('organisms.published') || 'Published') + (r?.data?.version ? ` v${r.data.version}` : ''));
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to publish'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  const resolve = useCallback(async (aid, decision) => {
    setBusy(true);
    try { await orgService.resolveApproval(orgId, aid, decision); showToast(decision === 'approve' ? (t('organisms.approved') || 'Approved') : (t('organisms.rejected') || 'Rejected')); await load(); }
    catch (e) { showToast((e && e.message) || 'Failed to resolve'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  // Delete a record or document (draft + published + all versions), with a confirm dialog.
  const removeObject = useCallback((namespace, instanceId, label) => {
    confirm(
      (t('organisms.confirmDeleteItem') || 'Delete “{name}”? Its draft, published version and full history are removed. This cannot be undone.').replace('{name}', label || instanceId),
      async () => {
        setBusy(true);
        try { await orgService.deleteWorkspaceObject(orgId, wsId, namespace, instanceId); showToast(t('organisms.deletedItem') || 'Deleted'); await load(); }
        catch (e) { showToast((e && e.message) || 'Failed to delete'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.delete') || 'Delete' },
    );
  }, [orgId, wsId, confirm, showToast, load]);

  const toggleGate = useCallback(async () => {
    setBusy(true);
    try { await orgService.setPublishGate(orgId, !gateOn); setGateOn(!gateOn); showToast(t('organisms.gateToggled') || 'Publish gate updated'); }
    catch (e) { showToast((e && e.message) || 'Failed to update gate'); }
    finally { setBusy(false); }
  }, [orgId, gateOn, showToast]);

  // Populate the settings fields from the manifest when the panel opens (incl. after generation) or
  // fresher data arrives — but only while the user hasn't touched the fields (seededRef compare), so
  // a live-update reload never clobbers typing.
  const seededRef = useRef(null);   // { name, summary, autonomy } last written into the fields
  useEffect(() => {
    if (!showSettings || !ws?.manifest) return;
    const sv = seededRef.current;
    const untouched = !sv || (sName === sv.name && sSummary === sv.summary && sAutonomy === sv.autonomy);
    if (untouched) {
      const next = { name: ws.manifest.name || '', summary: ws.manifest.summary || '', autonomy: ws.manifest.policy?.agentAutonomy || 'L3' };
      setSName(next.name); setSSummary(next.summary); setSAutonomy(next.autonomy);
      seededRef.current = next;
    }
  }, [showSettings, ws]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Public sharing lives in its own tab — lazy-load the share state the first time it opens.
  useEffect(() => {
    if (tab === 'share' && share === null && ws?.manifest) loadShare();
  }, [tab, ws]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Dirty-check against the manifest: Save enables only on real changes (doubles as the
  // unsaved-changes indicator), Cancel resets the fields, and closing a dirty panel asks first.
  const wsDirty = !!ws?.manifest && (sName !== (ws.manifest.name || '')
    || sSummary !== (ws.manifest.summary || '')
    || sAutonomy !== (ws.manifest.policy?.agentAutonomy || 'L3'));
  const resetSettingsForm = () => {
    const next = { name: ws?.manifest?.name || '', summary: ws?.manifest?.summary || '', autonomy: ws?.manifest?.policy?.agentAutonomy || 'L3' };
    setSName(next.name); setSSummary(next.summary); setSAutonomy(next.autonomy);
    seededRef.current = next;
  };
  const guardWsDirty = (fn) => {
    if (showSettings && wsDirty) confirm(t('organisms.discardChanges') || 'Discard unsaved changes?', () => { resetSettingsForm(); fn(); }, { danger: true });
    else fn();
  };

  const saveSettings = useCallback(async () => {
    setBusy(true);
    try {
      const m = {
        ...ws.manifest,
        name: sName.trim() || ws.manifest.name,
        summary: sSummary.trim(),
        policy: { ...(ws.manifest.policy || {}), agentAutonomy: sAutonomy },
        updatedAt: new Date().toISOString(),
      };
      await orgService.saveManifest(orgId, wsId, m);
      showToast(t('organisms.settingsSaved') || 'Settings saved');
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to save settings'); }
    finally { setBusy(false); }
  }, [ws, sName, sSummary, sAutonomy, orgId, showToast, load]);

  // Wipe the workspace entirely (all data + schemas). The organism stays → back to "no workspace".
  // The typed-name field already gates the button; this adds a final "are you sure?" dialog.
  const delWorkspace = useCallback(() => {
    confirm(
      t('organisms.confirmDeleteWorkspace') || 'Are you sure you want to delete this workspace? All its documents, records and version history are permanently removed. This cannot be undone.',
      async () => {
        setBusy(true);
        try {
          const r = await orgService.deleteWorkspace(orgId, wsId);
          if (r?.ok === false) { showToast(r?.error?.message || 'Failed to delete'); }
          else {
            showToast(t('organisms.workspaceDeleted') || 'Workspace deleted');
            setShowSettings(false); setDelConfirm(''); setShowRegenerate(false);
            onBack();   // the workspace is gone — return to the organism's workspace list
          }
        } catch (e) { showToast((e && e.message) || 'Failed to delete workspace'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.deleteWorkspace') || 'Delete workspace' },
    );
  }, [orgId, confirm, showToast, load]);

  // Manual add / remove of object spaces (also doable by agents via the memory API).
  const addSpaceHandler = useCallback(async () => {
    if (!newSpaceName.trim() || !ws?.manifest) return;
    setBusy(true);
    try {
      // Manual adds are document spaces ONLY — a record type needs a schema the user can't author
      // by hand; those are designed with AI via Settings → Process (restructure).
      await orgService.addSpace(orgId, wsId, ws.manifest, newSpaceName.trim(), 'document');
      showToast(t('organisms.spaceAdded') || 'Space added');
      setNewSpaceName(''); setShowSpaces(false);
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to add space'); }
    finally { setBusy(false); }
  }, [newSpaceName, ws, wsId, orgId, showToast, load]);

  const removeSpaceHandler = useCallback((typeName) => {
    confirm(
      (t('organisms.confirmRemoveSpace') || 'Remove "{name}" from this workspace? Its data is kept in memory (orphaned) but the section disappears.').replace('{name}', typeName),
      async () => {
        setBusy(true);
        try {
          await orgService.removeSpace(orgId, wsId, ws.manifest, typeName);
          showToast(t('organisms.spaceRemoved') || 'Space removed');
          await load();
        } catch (e) { showToast((e && e.message) || 'Failed to remove space'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.removeSpace') || 'Remove space' },
    );
  }, [ws, orgId, confirm, showToast, load]);

  // Copy a ready prompt that teaches an AI/agent how to access + use THIS workspace (the MCP gap
  // bridge). 'human' = paste into a chat; 'agent' = imperative, assumes tool access.
  const copyAccessPrompt = useCallback(async (variant) => {
    try {
      const text = await orgService.buildAccessPrompt(orgId, org.name, wsId, ws, variant);
      await copyToClipboard(text);
      showToast(t('organisms.promptCopied') || 'Access prompt copied — paste it to your AI.');
    } catch (e) { showToast((e && e.message) || 'Failed to build prompt'); }
  }, [orgId, org, wsId, ws, showToast]);

  const copyContractPrompt = useCallback(async () => {
    try {
      const text = await orgService.buildContractAgentPrompt(orgId, org.name, wsId, ws);
      await copyToClipboard(text);
      showToast(t('organisms.contractPromptCopied') || 'Contract-agent prompt copied — paste it to your AI / coding agent.');
    } catch (e) { showToast((e && e.message) || 'Failed to build prompt'); }
  }, [orgId, org, wsId, ws, showToast]);

  // The AI / paste generator — reused for a fresh workspace AND for "restructure" (where, via
  // showRegenerate, generate/copyPrompt pass the current manifest so the AI EXTENDS it additively).
  const renderGenerator = () => html`
    <div class="pj-section">
      <div class="pj-section-title">${showRegenerate ? (t('organisms.restructureTitle') || 'Restructure / add types with AI') : (t('organisms.generateTitle') || 'Or generate a custom workspace with AI')}</div>
      <div class="section-desc">${showRegenerate
        ? (t('organisms.restructureDesc') || 'Describe what to add or change. Existing types and their data are kept — the AI extends the current structure. (To start completely fresh, delete the workspace below first.)')
        : (t('organisms.generateDesc') || 'Describe what you want to track — the AI designs the object types. Use your OpenRouter key for one-click generation, or copy the prompt into any AI chat (free) and paste the result back.')}</div>

      <textarea class="input-field input-sm" rows="3"
        placeholder=${t('organisms.generatePlaceholder') || 'e.g. A research study tracking hypotheses, experiments and validated findings'}
        value=${genDesc} onInput=${e => setGenDesc(e.target.value)}></textarea>

      <${OpenRouterSettings} onSettingsChange=${s => setHasAiKey(!!(s && s.hasApiKey))} />

      <div class="form-actions">
        ${hasAiKey ? html`
          <button class="btn-primary btn-sm" onClick=${generate} disabled=${genBusy || !genDesc.trim()}>
            ${genBusy ? html`<span class="spinner"></span> ${t('organisms.generating') || 'Generating…'}` : (t('organisms.generate') || 'Generate with AI')}
          </button>
        ` : null}
        <button class="btn-outline btn-sm" onClick=${copyPrompt} disabled=${!genDesc.trim()}>${t('organisms.copyPrompt') || 'Copy prompt'}</button>
      </div>

      <div class="section-desc">${t('organisms.pasteHelp') || 'No key? Copy the prompt above into any AI chat, then paste the JSON it returns here:'}</div>
      <textarea class="input-field input-sm" rows="4"
        placeholder=${t('organisms.pastePlaceholder') || 'Paste the AI JSON response here'}
        value=${pasteText} onInput=${e => setPasteText(e.target.value)}></textarea>

      ${genFail && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.genFailed') || 'Generation failed — try again'}</div>
          <div class="pj-error-line">${(genFail)}</div>
        </div>
      `}

      ${genErrors.length > 0 && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.fixNeeded') || 'This needs fixing before it can be saved:'}</div>
          ${genErrors.map((e, i) => html`<div class="pj-error-line" key=${i}>${(e)}</div>`)}
          <div class="form-actions">
            <button class="btn-outline btn-sm" onClick=${copyFixPrompt}>${t('organisms.copyFixPrompt') || 'Copy fix prompt for the AI'}</button>
          </div>
        </div>
      `}

      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${applyPasted} disabled=${applyBusy || !pasteText.trim()}>
          ${applyBusy ? html`<span class="spinner"></span> ` : ''}${t('organisms.applyPasted') || 'Validate & apply'}
        </button>
      </div>
    </div>
  `;

  // Same breadcrumb pattern as the organism home: Organisms / {org} / {workspace} — both ancestors
  // are links, so the list is one click away from inside a workspace too.
  const back = html`
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

  if (ws === undefined) return html`<div>${back}<${Spinner} text=${t('organisms.loading') || 'Loading...'} /></div>`;

  if (ws === null) {
    return html`
      <div class="pj-ws">
        ${back}
        <div class="section-title">${(org.name || 'Organism')}</div>
        <div class="section-desc">${t('organisms.noWorkspace') || 'This organism has no workspace yet. Set one up to track goals, plans, deliverables and decisions — versioned on publish.'}</div>
        <button class="btn-primary" onClick=${setup} disabled=${busy || genBusy}>${busy ? '...' : (t('organisms.setupWorkspace') || 'Set up workspace (project template)')}</button>
        ${renderGenerator()}
      </div>
    `;
  }

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
  const loadShare = async () => {
    setShareBusy(true);
    try { setShare(await orgService.getWorkspaceShare(orgId, wsId)); } finally { setShareBusy(false); }
  };
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
  const copyShareLink = async (url) => {
    try { await navigator.clipboard.writeText(window.location.origin + url); showToast(t('organisms.linkCopied') || 'Link copied'); }
    catch { showToast(t('organisms.copyFailed') || 'Copy failed'); }
  };

  // A document-space: left index (section tree + documents, with an Unsorted group) + a main
  // area showing the active document (view/edit). Sections nest via parentId; documents are
  // tied to a section's documents[] (or unsorted). Edits to the tree persist immediately.
  const renderDocSpace = (ot) => {
    const secs = sectionsByType[ot.name] || [];
    const docs = mergedDocs(ot);
    const docById = {}; docs.forEach(d => { docById[d.id] = d; });
    const used = new Set(); secs.forEach(s => (s.documents || []).forEach(id => used.add(id)));
    const unsorted = docs.filter(d => !used.has(d.id));
    const childrenOf = (pid) => secs.filter(s => (s.parentId || null) === (pid || null));
    const isActive = (d) => activeDoc?.type === ot.name && activeDoc.page?.id === d.id;

    const docItem = (d) => html`
      <div class="pj-doc-item ${isActive(d) ? 'active' : ''}" key=${'di' + d.id}
        draggable=${true}
        onDragStart=${(e) => { draggedDoc.current = { type: ot.name, id: d.id }; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch (x) { /* noop */ } } }}
        onDragEnd=${() => { draggedDoc.current = null; }}>
        <span class="pj-grip" title=${t('organisms.dragHint') || 'Drag into a section'}>⠿</span>
        <button class="pj-doc-link" onClick=${() => setActiveDoc({ type: ot.name, mode: 'view', page: d })}>
          ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span> ` : ''}${d.title || d.id}
        </button>
        <button class="pj-icon-btn pj-doc-del" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, d.title || d.id)}>🗑</button>
      </div>`;

    // A section is a drop target — dragging a document onto it (or its header) files it here.
    const dropOn = (secId) => (e) => { e.preventDefault(); e.stopPropagation(); if (draggedDoc.current?.type === ot.name) { moveDocToSection(ot.name, draggedDoc.current.id, secId); draggedDoc.current = null; } };
    const allowDrop = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };

    const renderSection = (sec) => html`
      <div class="pj-sec" key=${sec.id} onDragOver=${allowDrop} onDrop=${dropOn(sec.id)}>
        <div class="pj-sec-head">
          ${editingSec === sec.id
            ? html`<input class="input-field input-xs pj-sec-name" autofocus placeholder=${t('organisms.sectionName') || 'Section name'}
                value=${sec.name} onInput=${e => setSecName(ot.name, sec.id, e.target.value)}
                onBlur=${() => commitSecName(ot.name)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`
            : html`<span class="pj-sec-name-text" onDblClick=${() => setEditingSec(sec.id)}>${(sec.name || t('organisms.unnamed') || '(unnamed)')}</span>`}
          <button class="pj-icon-btn" title=${t('organisms.rename') || 'Rename'} onClick=${() => setEditingSec(sec.id)}>✎</button>
          <button class="pj-icon-btn" title=${t('organisms.newDocHere') || 'New document here'} onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' }, sectionId: sec.id })}>+</button>
          <button class="pj-icon-btn" title=${t('organisms.addSubsection') || 'Sub-section'} onClick=${() => addSection(ot.name, sec.id)}>⊕</button>
          <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSection(ot.name, sec.id, sec.name)}>✕</button>
        </div>
        ${(sec.documents || []).map(id => docById[id]).filter(Boolean).map(docItem)}
        ${childrenOf(sec.id).map(renderSection)}
      </div>`;

    return html`
      <div class="pj-section" key=${ot.name}>
        <div class="pj-section-head">
          <span class="pj-section-title">${(ot.name)}<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span></span>
          <button class="btn-outline btn-sm" onClick=${() => addSection(ot.name, null)}>${'+ '}${t('organisms.section') || 'Section'}</button>
          <button class="btn-outline btn-sm" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${t('organisms.newPage') || 'New document'}</button>
        </div>
        <div class="pj-docspace">
          <div class="pj-doc-index">
            ${childrenOf(null).map(renderSection)}
            ${unsorted.length > 0 ? html`
              <div class="pj-sec" onDragOver=${allowDrop} onDrop=${dropOn(null)}><div class="pj-sec-head"><span class="pj-sec-name pj-muted">${t('organisms.unsorted') || 'Unsorted'}</span></div>${unsorted.map(docItem)}</div>` : null}
            ${docs.length === 0 && secs.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
          </div>
          <div class="pj-doc-main">
            ${(() => {
              if (activeDoc?.type !== ot.name) return html`<${EmptyState} icon="📄" text=${t('organisms.selectDoc') || 'Select a document, or create one.'} />`;
              // Re-resolve the open document against the freshly-loaded list by id, so after a save (or
              // a live-update / F5 restore that only kept the id) the view shows the current draft —
              // with its correct draft badge, published copy, and Draft/Published toggle.
              const livePage = (activeDoc.page && activeDoc.page.id && docById[activeDoc.page.id]) || activeDoc.page;
              if (activeDoc.mode === 'edit') return html`
                <${DocumentEditor} key=${'ed-' + (livePage.id || 'new')} orgId=${orgId} page=${livePage} busy=${busy} onSave=${(p) => savePage(ot, p, activeDoc.sectionId)} onCancel=${() => setActiveDoc(null)} />`;
              return html`
                <${DocumentView} key=${'view-' + livePage.id} page=${livePage} busy=${busy}
                  onEdit=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: livePage })}
                  onPublish=${() => publish(ot, livePage.id)}
                  onPopOut=${() => popOut(ot.name, livePage.id)}
                  onWikiLink=${(content) => {
                    const [titlePart, headingPart] = String(content).split('#');
                    const title = titlePart.trim();
                    const anchor = (headingPart || '').trim();
                    const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.querySelector('.pj-doc-view [id="' + slugifyHeading(anchor) + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                    if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                    const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                    if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                    else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
                  }} />
                <${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${livePage.id} showToast=${showToast} />`;
            })()}
          </div>
        </div>
      </div>`;
  };

  // A record-space tab: schema-form add/edit + draft and published record lists (with comments).
  const renderRecordSpace = (ot) => html`
    <div class="pj-section" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title">${(wsT('type.' + ot.name) || ot.name)}</span>
        ${ot.append ? null : html`<button class="btn-outline btn-sm" onClick=${() => startAdd(ot)}>${'+ '}${t('organisms.addDraft') || 'Add draft'}</button>`}
      </div>

      ${adding === ot.name && (addingSchema
        ? html`<${SchemaForm} key=${'sf-' + (addingId || 'new')} schema=${addingSchema} busy=${busy} initial=${addingInitial}
            idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
            onSave=${(v) => saveDraft(ot, addingId ? { ...v, id: addingId } : v)} onCancel=${cancelForm} />`
        : html`<${Spinner} />`)}

      ${draftsFor(ot.name).map((d, i) => html`
        <div class="pj-rec" key=${'d' + i}>
          <div class="pj-item pj-item-draft">
            <span class="badge badge-warn">${t('organisms.draft') || 'draft'}</span>
            <button class="pj-rec-title" onClick=${() => toggleExpand(ot, d.id)}>${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || '')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}</button>
            <button class="btn-primary btn-sm" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>
            <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id))}>🗑</button>
          </div>
          ${expandedRec[ot.name + ':' + d.id] ? html`<div class="pj-rec-fields">${recordFields(ot, d)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${d.id} showToast=${showToast} />` : null}
        </div>
      `)}

      ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
        ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />`
        : objectsFor(ot.name).map((o, i) => html`
          <div class="pj-rec" key=${'o' + i}>
            <div class="pj-item">
              <button class="pj-rec-title" onClick=${() => toggleExpand(ot, o.id)}>${String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || '')}</button>
              ${o.status ? html`<span class="badge badge-info">${(o.status)}</span>` : null}
              <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, o.id, String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.id))}>🗑</button>
            </div>
            ${expandedRec[ot.name + ':' + o.id] ? html`<div class="pj-rec-fields">${recordFields(ot, o)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${o.id} showToast=${showToast} />` : null}
          </div>
        `)
      }
    </div>`;

  // A declared space whose backing isn't memory — never silently hidden, its tab shows a notice.
  const renderSpaceNotice = (ot) => html`
    <div class="pj-section" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title">${(ot.name)}</span>
        <span class="badge badge-warn">${(String(ot.backing))}</span>
      </div>
      <div class="pj-space-notice">${ot.backing === 'tasks'
        ? (t('organisms.spaceTasksBacked') || 'This space points at the task system — its items are tasks, not workspace records. Manage them in the Tasks views.')
        : (t('organisms.spaceBackingUnsupported') || 'This space’s backing is not supported, so its content is not shown here. Edit the workspace (manifest) and set this space’s backing to "memory" to restore it — files and knowledge packages attach via Sources or document images instead.')}</div>
    </div>`;

  // ── Tabs: one per declared manifest space (memory-backed or not), then the fixed tabs.
  // The "+" pseudo-tab opens the add-space form, so adding spaces stays one click away.
  // Space labels are capitalized so the row reads uniformly next to the fixed tabs.
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const spaceCount = (name) => new Set([...draftsFor(name), ...objectsFor(name)].map(d => d.id)).size;
  const spaceTabs = allTypes.map(ot => ({
    id: 'space:' + ot.name, ot, label: cap(wsT('type.' + ot.name) || ot.name),
    count: orgService.isMemorySpace(ot) ? spaceCount(ot.name) : null,
  }));
  const fixedTabs = [
    { id: 'sources', label: t('organisms.sources') || 'Sources', count: null },
    { id: 'share', label: t('organisms.share') || 'Share', count: null },
    { id: 'review', label: t('organisms.tabReview') || 'Review', count: approvals.length || null },
    { id: 'activity', label: t('organisms.activity') || 'Activity', count: null },
    { id: 'people', label: t('organisms.tabPeople') || 'People', count: null },
  ];
  const wsTabs = [{ id: 'overview', label: t('organisms.tabOverview') || 'Overview', count: null }, ...spaceTabs, ...fixedTabs];
  // Settings REPLACES the tab content: while it is open no tab is active (the previous state — a
  // highlighted tab above settings content — lied about what the user was looking at).
  const activeTab = showSettings ? '' : (wsTabs.some(tb => tb.id === tab) ? tab : 'overview');
  const activeSpace = activeTab.startsWith('space:') ? allTypes.find(ot => ot.name === activeTab.slice(6)) : null;
  // Opening a tab clears its unseen badge (the seen mark persists across sessions).
  const pickTab = (id) => guardWsDirty(() => { setShowSettings(false); setTab(id); markSeen(id); });

  // Menu items are VERBS (a click copies to the clipboard; the toast confirms). The contract-agent
  // builder is a different category from the two copy actions, so a divider separates it.
  const agentMenuItems = [
    { label: t('organisms.copyChatPrompt') || 'Copy chat prompt', icon: '💬', onClick: () => copyAccessPrompt('human') },
    { label: t('organisms.copyCodingPrompt') || 'Copy coding agent prompt', icon: '⌨', onClick: () => copyAccessPrompt('agent') },
    { divider: true },
    { label: t('organisms.contractPrompt') || 'Create contract agent', icon: '⚙️', onClick: copyContractPrompt },
  ];

  // ── Overview (landing tab): the whole workspace on one vertical scroll — a "what happened
  // here" strip from the activity feed, then every manifest space as its own stacked section.
  // Tabs stay for focused work; this answers "where is everything and what changed".
  const isMobileView = () => window.matchMedia('(max-width: 640px)').matches;
  const shortActor = (a) => String(a || '').split('@')[0];
  // First non-empty markdown line as a gray preview (heading/list markers stripped).
  const firstLine = (md) => {
    const line = String(md || '').split('\n').map(s => s.trim()).find(s => s && !s.startsWith('```'));
    return line ? line.replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '').slice(0, 120) : '';
  };
  // Strip event → jump straight to the changed item in its space tab.
  const gotoEvent = (e) => {
    const target = allTypes.find(o => o.name === e.type);
    if (!target || !orgService.isMemorySpace(target)) { pickTab('activity'); return; }
    if (isDocSpace(target)) setActiveDoc({ type: target.name, mode: 'view', page: { id: e.instance } });
    else setExpandedRec(s => ({ ...s, [target.name + ':' + e.instance]: true }));
    pickTab('space:' + target.name);
  };
  const openOvRec = (ot, r) => { setExpandedRec(s => ({ ...s, [ot.name + ':' + r.id]: true })); pickTab('space:' + ot.name); };
  // A document opens in its space tab on desktop; on mobile it expands INLINE right here —
  // view and edit both — so no window juggling is ever needed on a phone.
  const openOvDoc = (ot, d) => {
    if (isMobileView()) setOvDoc(v => (v && v.type === ot.name && v.id === d.id) ? null : { type: ot.name, id: d.id, mode: 'view' });
    else { setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); pickTab('space:' + ot.name); }
  };
  const ovAddNew = (ot, docMode) => {
    if (docMode) setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } });
    else startAdd(ot);
    pickTab('space:' + ot.name);
  };

  const renderOvDocInline = (ot, d) => ovDoc.mode === 'edit'
    ? html`<div class="pj-ov-doc-inline"><${DocumentEditor} key=${'oved-' + d.id} orgId=${orgId} page=${d} busy=${busy}
        onSave=${(p) => { savePage(ot, p); setOvDoc({ type: ot.name, id: d.id, mode: 'view' }); }}
        onCancel=${() => setOvDoc({ type: ot.name, id: d.id, mode: 'view' })} /></div>`
    : html`<div class="pj-ov-doc-inline"><${DocumentView} key=${'ovv-' + d.id} page=${d} busy=${busy}
        onEdit=${() => setOvDoc({ type: ot.name, id: d.id, mode: 'edit' })}
        onPublish=${() => publish(ot, d.id)}
        onWikiLink=${(content) => {
          const title = String(content).split('#')[0].trim();
          const targetDoc = title && mergedDocs(ot).find(x => (x.title || '').toLowerCase() === title.toLowerCase());
          if (targetDoc) setOvDoc({ type: ot.name, id: targetDoc.id, mode: 'view' });
        }} /></div>`;

  const renderOvSection = (ot) => {
    const memory = orgService.isMemorySpace(ot);
    const docMode = memory && isDocSpace(ot);
    const items = memory ? (docMode ? mergedDocs(ot) : mergedRecords(ot)) : [];
    const label = cap(wsT('type.' + ot.name) || ot.name);
    // A space the manifest declares but memory doesn't back → one notice row, never hidden.
    if (!memory) return html`
      <div class="pj-ov-row" key=${ot.name}>
        <button class="pj-ov-name pj-ov-name-link" onClick=${() => pickTab('space:' + ot.name)}>${label}</button>
        <span class="badge badge-warn">${String(ot.backing)}</span>
      </div>`;
    // Empty space → a single compact row (name + none + add), not an empty box.
    if (items.length === 0) return html`
      <div class="pj-ov-row" key=${ot.name}>
        <span class="pj-ov-name">${label}</span>
        <span class="pj-muted">${t('organisms.noneYet') || 'none yet'}</span>
        <button class="btn-ghost btn-sm" onClick=${() => ovAddNew(ot, docMode)}>${'+ '}${docMode ? (t('organisms.newPage') || 'New document') : (t('organisms.addDraft') || 'Add draft')}</button>
      </div>`;
    const open = ovOpen[ot.name] ?? !isMobileView();
    const shown = items.slice(0, 5);
    return html`
      <div class="pj-ov-sec" key=${ot.name}>
        <div class="pj-ov-sec-head" onClick=${() => setOvOpen(s => ({ ...s, [ot.name]: !open }))}>
          <span class="pj-ov-chevron">${open ? '▾' : '▸'}</span>
          <span class="pj-ov-name">${label}</span>
          <span class="pj-org-tab-count">${items.length}</span>
          ${docMode ? html`<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span>` : null}
          <span class="pj-ov-spacer"></span>
          <button class="btn-ghost btn-sm" onClick=${(ev) => { ev.stopPropagation(); ovAddNew(ot, docMode); }}>${'+ '}${docMode ? (t('organisms.newPage') || 'New document') : (t('organisms.addDraft') || 'Add draft')}</button>
        </div>
        ${open ? html`
          <div class="pj-ov-items">
            ${shown.map(d => docMode ? html`
              <div class="pj-ov-doc" key=${d.id}>
                <button class="pj-ov-item" onClick=${() => openOvDoc(ot, d)}>
                  ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                  <span class="pj-ov-item-title">${d.title || d.id}</span>
                  <span class="pj-ov-preview">${firstLine(d.markdown)}</span>
                </button>
                ${ovDoc && ovDoc.type === ot.name && ovDoc.id === d.id ? renderOvDocInline(ot, d) : null}
              </div>` : html`
              <button class="pj-ov-item" key=${d.id} onClick=${() => openOvRec(ot, d)}>
                ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                <span class="pj-ov-item-title">${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.summary || d.id || '')}</span>
                ${d.status ? html`<span class="badge badge-info">${String(d.status)}</span>` : null}
              </button>`)}
            ${items.length > 5 ? html`
              <button class="pj-ov-more" onClick=${() => pickTab('space:' + ot.name)}>${(t('organisms.ovShowAll') || 'Show all {n} →').replace('{n}', String(items.length))}</button>` : null}
          </div>` : null}
      </div>`;
  };

  const renderOverview = () => {
    const recent = wsEvents.slice(0, 8);
    return html`
      <div class="pj-ov">
        ${recent.length > 0 ? html`
          <div class="pj-ov-strip">
            <div class="pj-ov-strip-title">${t('organisms.ovRecent') || 'What happened here'}</div>
            ${recent.map((e, i) => html`
              <button class="pj-ov-event" key=${i} onClick=${() => gotoEvent(e)}>
                <span class="pj-act-dot ${e.action}"></span>
                <span class="pj-ov-event-who">${shortActor(e.actor)}${e.agent ? html` <span class="pj-act-agent" title=${t('organisms.viaAgent') || 'via this agent'}>🤖 ${e.agent}</span>` : null}</span>
                <span class="pj-ov-event-act">${e.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited')}</span>
                <span class="pj-ov-event-what">${e.mode === 'document' ? '📄' : '🗂'} ${(wsT('type.' + e.type) || e.type)}${' / '}${e.instance}</span>
                <span class="pj-ov-event-time">${relTime(e.at)}</span>
              </button>`)}
          </div>` : null}
        ${allTypes.map(renderOvSection)}
        ${allTypes.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
      </div>`;
  };

  return html`
    <div class="pj-ws">
      <${ConfirmUI} />
      ${back}
      <div class="pj-ws-titlerow">
        <span class="section-title pj-ws-title">${(ws.manifest?.name || org.name || 'Workspace')}</span>
        <span class="badge badge-success">${(ws.manifest?.status || 'active')}</span>
        <span class="pj-ws-head-actions">
          <${KebabMenu} label=${t('organisms.forAgentsHint') || 'Copy a ready prompt that teaches an AI to use this workspace'}
            btnClass="btn-outline btn-sm" trigger=${'🤖 ' + (t('organisms.agentAccess') || 'Agent access') + ' ▾'} items=${agentMenuItems} />
          <button class="btn-outline btn-sm ${showSettings ? 'pj-org-btn-active' : ''}" onClick=${() => guardWsDirty(() => setShowSettings(s => !s))}>${'⚙ '}${t('organisms.settings') || 'Settings'}</button>
        </span>
      </div>
      ${ws.manifest?.summary ? html`<div class="section-desc">${(ws.manifest.summary)}</div>` : null}

      ${approvals.length > 0 && activeTab !== 'review' ? html`
        <div class="pj-ws-banner" role="status">
          <span class="pj-ws-banner-text">
            <b>${(t('organisms.reviewBanner') || '{n} waiting for review').replace('{n}', String(approvals.length))}</b>
            <span class="pj-ws-banner-sub">${t('organisms.reviewBannerSub') || 'Publishes are gated and need a human decision.'}</span>
          </span>
          <button class="btn-outline btn-sm" onClick=${() => setTab('review')}>${t('organisms.reviewQueue') || 'Review queue'}</button>
        </div>` : null}

      <div class="pj-org-tabs" role="tablist">
        ${wsTabs.map(tb => {
          const u = activeTab === tb.id ? 0 : unseenOf(tb.id);
          return html`
          <button class="pj-org-tab ${activeTab === tb.id ? 'active' : ''}" role="tab" aria-selected=${activeTab === tb.id} key=${tb.id}
            onClick=${() => pickTab(tb.id)}>
            ${(tb.label)}${tb.count !== null && tb.count !== undefined ? html`<span class="pj-org-tab-count">${tb.count}</span>` : null}
            ${u > 0 ? html`<span class="pj-org-tab-unseen" title=${t('organisms.unseenHint') || 'Changed since your last visit'}>${u}</span>` : null}
          </button>`;
        })}
        <button class="pj-org-tab pj-ws-tab-add" title=${t('organisms.addDocSpaceTitle') || 'Add a document space'} onClick=${() => guardWsDirty(() => { setShowSettings(false); setShowSpaces(s => !s); })}>+</button>
      </div>

      ${showSpaces && html`
        <div class="pj-inbox pj-spaces-add">
          <div class="card-h3">${t('organisms.addDocSpaceTitle') || 'Add a document space'}</div>
          <div class="section-desc">${t('organisms.addDocSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). Record types need a schema, so they are designed with AI in Settings → Process (restructure).'}</div>
          <div class="pj-space-row">
            <input type="text" class="input-field input-sm" placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addSpaceHandler(); }} />
            <button class="btn-primary btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}</button>
          </div>
        </div>`}

      ${showSettings && html`
        <div class="pj-inbox">
          <div class="pj-meta-line">
            <span>${t('organisms.template') || 'Template'} ${(ws.manifest?.kind || '-')}</span>
            ${ws.manifest?.updatedAt ? html`<span>${t('organisms.lastSaved') || 'Last saved'} ${fmtDate(ws.manifest.updatedAt)}</span>` : null}
          </div>

          <div class="pj-form-card">
            <div class="pj-form-group">${t('organisms.formIdentity') || 'Identity'}</div>
            <label class="pj-field"><span>${t('organisms.wsName') || 'Name'}</span>
              <input type="text" class="input-field input-sm" value=${sName} onInput=${e => setSName(e.target.value)} /></label>
            <label class="pj-field"><span>${t('organisms.wsSummary') || 'Summary'}</span>
              <textarea class="input-field input-sm" rows="2" value=${sSummary} onInput=${e => setSSummary(e.target.value)}></textarea></label>

            <div class="pj-form-group">${t('organisms.formAgentPolicy') || 'Agent policy'}</div>
            <label class="pj-field"><span>${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'}</span>
              <select class="input-field input-sm" value=${sAutonomy} onChange=${e => setSAutonomy(e.target.value)}>
                ${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => html`<option value=${l} key=${l}>${l} — ${t(`organisms.autonomyLevels.${l}`) || ''}</option>`)}
              </select></label>
            <div class="pj-form-hint">${t('organisms.autonomyHint') || 'Guidance for agents working here — L1 asks before nearly everything, L5 acts freely. The publish gate (Review tab) still applies regardless.'}</div>

            <div class="form-actions">
              <button class="btn-primary btn-sm" onClick=${saveSettings} disabled=${busy || !wsDirty}>${t('organisms.saveChanges') || 'Save changes'}</button>
              <button class="btn-ghost btn-sm" onClick=${() => { resetSettingsForm(); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}</button>
            </div>
          </div>

          <div class="pj-divider"></div>
          <div class="pj-form-group">${t('organisms.spaces') || 'Spaces'}</div>
          <div class="pj-form-hint">${t('organisms.spacesRemoveHint') || 'These actions apply immediately. Removing a space hides its section — the data stays in memory and comes back if a space with the same name is added again.'}</div>
          ${(ws.manifest?.objectTypes || []).map(ot => html`
            <div class="pj-doc-row" key=${'sp' + ot.name}>
              <span class="pj-space-name">${(ot.name)}<span class="pj-doc-tag">${isDocSpace(ot) ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}</span></span>
              <button class="btn-ghost btn-sm" onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}</button>
            </div>
          `)}
          <div class="form-actions">
            <input type="text" class="input-field input-sm" placeholder=${t('organisms.docSpaceNamePlaceholder') || 'New document space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} />
            <button class="btn-outline btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
          </div>

          <div class="pj-divider"></div>
          <div class="pj-form-group">${t('organisms.formProcess') || 'Process'}</div>
          ${ws.manifest ? html`
            <div class="pj-chart">
              <div class="pj-chart-head">
                <span class="pj-chart-title">${'🔄 '}${t('organisms.editFlow') || 'How editing works here'}</span>
                <button class="btn-ghost btn-sm" onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
              </div>
              ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}
            </div>` : null}
          <button class="btn-outline btn-sm" onClick=${() => setShowRegenerate(s => !s)}>
            ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || '✨ Restructure / add types with AI')}
          </button>
          ${showRegenerate && renderGenerator()}

          <div class="pj-divider"></div>
          <div class="pj-danger">
            <div class="pj-danger-title">${t('organisms.dangerZone') || 'Danger zone'}</div>
            <div class="section-desc">${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}</div>
            <label class="pj-field"><span>${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}</span>
              <input type="text" class="input-field input-sm" value=${delConfirm} onInput=${e => setDelConfirm(e.target.value)} placeholder=${ws.manifest?.name || ''} /></label>
            <button class="btn-danger btn-sm" onClick=${delWorkspace}
              disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}</button>
          </div>
        </div>
      `}

      ${activeTab === 'overview' ? renderOverview() : null}

      ${activeSpace
        ? (!orgService.isMemorySpace(activeSpace)
          ? renderSpaceNotice(activeSpace)
          : (isDocSpace(activeSpace) ? renderDocSpace(activeSpace) : renderRecordSpace(activeSpace)))
        : null}

      ${activeTab === 'sources' ? html`<${SourcesPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}

      ${activeTab === 'share' ? html`
        <div class="pj-section">
          <div class="section-desc">${t('organisms.sharePublicDesc') || 'Make published document-space pages readable by anyone with the link — no login required. Drafts are never shared.'}</div>
          ${docTypes.length === 0 ? html`<${EmptyState} icon="🌐" text=${t('organisms.noDocSpaces') || 'This workspace has no document spaces to share.'} />` : html`
            ${!share && shareBusy ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading…'}</div>` : null}
            ${share ? docTypes.map(ot => {
              const docs = objectsFor(ot.name);
              const spaceOn = !!(share.spaces && share.spaces[ot.name]);
              return html`
                <div class="pj-share-space" key=${'sh' + ot.name}>
                  <label class="pj-share-row">
                    <input type="checkbox" checked=${spaceOn} disabled=${shareBusy} onChange=${e => patchShare({ spaces: { [ot.name]: e.target.checked } })} />
                    <span class="pj-space-name">${wsT('type.' + ot.name) || ot.name}</span>
                    <span class="pj-doc-tag">${docs.length} ${t('organisms.docs') || 'docs'}</span>
                  </label>
                  ${docs.length === 0
                    ? html`<div class="pj-empty pj-share-empty">${t('organisms.noPublishedDocs') || 'No published documents yet — publish a page to share it.'}</div>`
                    : html`<div class="pj-share-docs">
                        ${docs.map(d => {
                          const on = isDocPublic(ot.name, d.id);
                          return html`
                            <label class="pj-share-doc" key=${'shd' + d.id}>
                              <input type="checkbox" checked=${on} disabled=${shareBusy} onChange=${e => patchShare({ docs: { [`${ot.name}/${d.id}`]: e.target.checked } })} />
                              <span class="pj-share-doc-title">${d.title || d.id}</span>
                              ${on ? html`<a class="pj-share-link" href=${orgService.publicViewerUrl(orgId, wsId, { type: ot.name, id: d.id })} target="_blank" rel="noopener">${t('organisms.openLink') || 'open ↗'}</a>` : null}
                            </label>`;
                        })}
                      </div>`}
                </div>`;
            }) : null}
            ${anythingPublic() ? html`
              <div class="pj-share-actions">
                <a class="btn-outline btn-sm" href=${orgService.publicViewerUrl(orgId, wsId)} target="_blank" rel="noopener">${'🔗 '}${t('organisms.openPublicViewer') || 'Open public viewer'}</a>
                <button class="btn-ghost btn-sm" onClick=${() => copyShareLink(orgService.publicViewerUrl(orgId, wsId))}>${t('organisms.copyLink') || 'Copy link'}</button>
              </div>` : null}
          `}
        </div>` : null}

      ${activeTab === 'review' ? html`
        <div class="pj-section">
          <label class="pj-gate-label" title=${t('organisms.publishGateHint') || 'When on, an agent’s publish is held for your review instead of going live'}>
            <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
            ${'🔒 '}${t('organisms.publishGate') || 'Require review before publishing'}
          </label>
          ${approvals.length === 0
            ? html`<${EmptyState} icon="📭" text=${t('organisms.reviewEmpty') || 'Nothing waiting for review.'} />`
            : html`
              <div class="card-h3">${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})</div>
              ${approvals.map(a => html`
                <div class="pj-approval" key=${a.id}>
                  <div class="pj-approval-text">${(a.prompt || a.action)}</div>
                  <div class="card-actions">
                    <button class="btn-success btn-sm" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}</button>
                    <button class="btn-danger btn-sm" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}</button>
                  </div>
                </div>
              `)}`}
        </div>` : null}

      ${activeTab === 'activity' ? html`
        <${ActivityPanel} orgId=${orgId} wsId=${wsId} />
        ${(ws.decisions || []).length > 0 ? html`
          <div class="pj-section">
            <div class="pj-section-title">${t('organisms.decisions') || 'Recent decisions'}</div>
            ${ws.decisions.slice(-8).reverse().map((d, i) => html`
              <div class="pj-item pj-decision" key=${'dec' + i}><span class="pj-item-text">${(String(d.summary || ''))}</span></div>
            `)}
          </div>` : null}` : null}

      ${activeTab === 'people' ? html`<${ParticipantsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />` : null}
    </div>
  `;
}

/* Sources: references the workspace draws on — memory entries, storage files, and knowledge
 * packages (own, or external/read-only). Pointers ONLY: nothing is copied or moved; the referenced
 * data stays where it lives (organism.{id}.meta.sources holds just the pointers). Attach via a
 * picker with Memory / Storage / Knowledge tabs (Mine, or Discover for memory + knowledge). */
const SRC_ICON = { memory: '🧠', storage: '📎', knowledge: '📚' };
function SourcesPanel({ orgId, wsId, showToast }) {
  const [sources, setSources] = useState([]);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState('knowledge');   // memory | storage | knowledge
  const [scope, setScope] = useState('mine');     // mine | discover (storage has no discover)
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setSources(await orgService.getWorkspaceSources(orgId, wsId)); }, [orgId, wsId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, [load]);

  const persist = async (next) => {
    setSources(next);
    const r = await orgService.saveWorkspaceSources(orgId, wsId, next).catch(() => ({ ok: false }));
    if (r?.ok === false) showToast(t('organisms.sourcesSaveError') || 'Failed to save sources');
  };

  const doSearch = async () => {
    setLoading(true);
    const ql = q.trim().toLowerCase();
    try {
      if (tab === 'memory') {
        if (scope === 'mine') {
          const items = await memoryService.listMemories();
          setResults(items.filter(i => !ql || String(i.key).toLowerCase().includes(ql)).slice(0, 100));
        } else {
          const d = await memoryService.discoverPublicMemories({ q: q.trim(), limit: 50 });
          setResults(d.items || []);
        }
      } else if (tab === 'storage') {
        const files = await orgService.listOwnStorageFiles();
        setResults(files.filter(f => !ql || String(f.key).toLowerCase().includes(ql)));
      } else if (scope === 'mine') {
        const pkgs = await knowledgeService.listMyPackages();
        setResults(pkgs.filter(p => { const n = String(p.value?.name || p.key || ''); return !ql || n.toLowerCase().includes(ql); }));
      } else {
        const r = await knowledgeService.discoverPackages({ limit: 50, sort: 'recent' });
        setResults((r?.data?.packages || []).filter(p => !ql || String(p.name || '').toLowerCase().includes(ql)));
      }
    } catch (e) { setResults([]); }
    finally { setLoading(false); }
  };
  const searchRef = useRef(doSearch); searchRef.current = doSearch;
  // Auto-search when the picker opens or the tab/scope changes — but NOT on every keystroke
  // (typing only updates q; Enter or the Search button runs it).
  useEffect(() => { if (picking) searchRef.current(); }, [picking, tab, scope]);
  // storage has no cross-owner discovery — force 'mine' there
  useEffect(() => { if (tab === 'storage' && scope !== 'mine') setScope('mine'); }, [tab, scope]);

  const keyOf = (s) => `${s.type}:${s.packageId || (s.ownerGaii || '') + '|' + (s.key || '')}`;
  const attach = async (item) => {
    setBusy(true);
    try {
      const base = { id: 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), addedAt: new Date().toISOString() };
      let src;
      if (tab === 'memory') {
        src = { ...base, type: 'memory', key: item.key, ownerGaii: item.owner_gaii || orgService.currentGhii(), label: item.key, external: scope === 'discover' };
      } else if (tab === 'storage') {
        src = { ...base, type: 'storage', key: item.key, ownerGaii: orgService.currentGhii(), label: item.key, mime: item.mime_type, external: false };
      } else {
        const pid = scope === 'mine' ? ((String(item.key).match(/packages\/([^/]+)\/manifest/) || [])[1] || item.key) : item.package_id;
        const name = scope === 'mine' ? (item.value?.name || pid) : (item.name || pid);
        src = { ...base, type: 'knowledge', packageId: pid, label: name, external: scope === 'discover' };
      }
      if (sources.some(s => keyOf(s) === keyOf(src))) { showToast(t('organisms.sourceExists') || 'Already added'); return; }
      await persist([...sources, src]);
      showToast(t('organisms.sourceAdded') || 'Source added');
    } finally { setBusy(false); }
  };
  const removeSource = (id) => persist(sources.filter(s => s.id !== id));

  const resultRow = (item, i) => {
    let label, meta;
    if (tab === 'memory') { label = item.key; meta = (scope === 'discover' ? (item.owner_gaii + ' · ') : '') + (item.visibility || ''); }
    else if (tab === 'storage') { label = item.key; meta = (item.mime_type || '') + ' · ' + fmtBytes(item.size || 0); }
    else { label = scope === 'mine' ? (item.value?.name || item.key) : (item.name || item.package_id); meta = (scope === 'mine' ? (item.value?.entries?.length || 0) : (item.entries_count || 0)) + ' ' + (t('organisms.entries') || 'entries'); }
    return html`
      <div class="pj-src-result" key=${'r' + i}>
        <span class="pj-src-result-label" title=${String(label)}>${(String(label))}</span>
        <span class="pj-src-result-meta">${(String(meta))}</span>
        <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => attach(item)}>${t('organisms.attach') || 'Attach'}</button>
      </div>`;
  };

  return html`
    <div class="pj-section pj-sources">
      <div class="pj-section-head">
        <span class="pj-section-title">${t('organisms.sources') || 'Sources'}<span class="pj-doc-tag">${sources.length}</span></span>
        <button class="btn-outline btn-sm" onClick=${() => setPicking(p => !p)}>
          ${picking ? (t('organisms.close') || 'Close') : ('+ ' + (t('organisms.addSource') || 'Add source'))}
        </button>
      </div>
      <div class="section-desc pj-sources-desc">${t('organisms.sourcesDesc') || 'References this workspace draws on — memory, files, and knowledge packages. Pointers only; the originals stay where they live.'}</div>

      ${picking ? html`
        <div class="pj-src-picker">
          <div class="seg" role="tablist">
            ${['memory', 'storage', 'knowledge'].map(tk => html`<button class="seg-btn ${tab === tk ? 'active' : ''}" key=${tk} onClick=${() => setTab(tk)}>${SRC_ICON[tk]} ${t('organisms.src_' + tk) || tk}</button>`)}
          </div>
          <div class="pj-src-controls">
            ${tab !== 'storage' ? html`
              <div class="seg">
                <button class="seg-btn ${scope === 'mine' ? 'active' : ''}" onClick=${() => setScope('mine')}>${t('organisms.mine') || 'Mine'}</button>
                <button class="seg-btn ${scope === 'discover' ? 'active' : ''}" onClick=${() => setScope('discover')}>${t('organisms.discover') || 'Discover'}</button>
              </div>` : null}
            <div class="pj-src-search"><${SearchBar} value=${q} onInput=${e => setQ(e.target.value)} onSubmit=${() => doSearch()} placeholder=${t('organisms.searchSources') || 'Search…'} /></div>
            <button class="btn-ghost btn-sm" onClick=${doSearch} disabled=${loading}>${t('organisms.search') || 'Search'}</button>
          </div>
          <div class="pj-src-results">
            ${loading ? html`<${EmptyState} text=${t('organisms.loading') || 'Loading…'} />`
              : results.length === 0 ? html`<${EmptyState} text=${t('organisms.noResults') || 'No results'} />`
              : results.slice(0, 100).map(resultRow)}
          </div>
        </div>` : null}

      ${sources.length === 0 ? html`<${EmptyState} text=${t('organisms.noSources') || 'No sources yet'} />`
        : html`<div class="pj-src-list">
          ${sources.map(s => html`
            <div class="pj-src-item" key=${s.id}>
              <span class="pj-src-icon">${SRC_ICON[s.type] || '•'}</span>
              <span class="pj-src-label" title=${s.key || s.packageId || ''}>${(String(s.label || s.key || s.packageId || ''))}</span>
              ${s.external ? html`<span class="badge badge-muted pj-mini">${t('organisms.external') || 'external'}</span>` : null}
              <span class="badge badge-info pj-mini">${t('organisms.src_' + s.type) || s.type}</span>
              <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSource(s.id)}>✕</button>
            </div>`)}
        </div>`}
    </div>`;
}

/* A form rendered from a JSON Schema — typed inputs (enum→select, integer→number,
 * array→lines, boolean→checkbox, else text). Works for any objectType, including ones a
 * generated manifest declares. New records pre-fill `id` (editable) and requester-style
 * fields ("x-default": "currentUser", or a requested_by/created_by-shaped name) with the
 * signed-in GHII. readOnly properties are agent-filled results — hidden here, shown only in
 * the record view. Labels/hints resolve manifest i18n (wsT) → schema description → raw key.
 * Save is always clickable: a failed attempt outlines the still-empty required fields. */
function SchemaForm({ schema, busy, onSave, onCancel, initial, idPrefix, namespace, wsT }) {
  const props = (schema && schema.properties) || {};
  const editable = Object.entries(props).filter(([, def]) => !(def && def.readOnly));
  const required = new Set(((schema && schema.required) || []).filter(k => k !== 'id' && !(props[k] && props[k].readOnly)));
  const fieldNames = editable.map(([k]) => k);
  const [missing, setMissing] = useState(null); // required keys empty at the last save attempt
  // Seed from an existing record when editing (arrays → newline text for the textarea inputs).
  const [vals, setVals] = useState(() => {
    const out = {};
    for (const [k, def] of Object.entries(props)) {
      const v = initial && initial[k];
      if (v === undefined || v === null) continue;
      out[k] = Array.isArray(v) ? v.join('\n') : (def.type === 'boolean' ? !!v : String(v));
    }
    if (!initial) {
      if (props.id && out.id === undefined) out.id = `${idPrefix || 'rec'}-${Date.now().toString(36)}`;
      const me = getGhii() || '';
      for (const [k, def] of editable) {
        if (out[k] !== undefined || def.type !== 'string' || def.enum) continue;
        if (def['x-default'] === 'currentUser' || /^(requested_by|created_by|requester|author)$/i.test(k)) out[k] = me;
      }
    }
    return out;
  });
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }));

  const buildValue = () => {
    const out = {};
    for (const [k, def] of Object.entries(props)) {
      const raw = vals[k];
      if (raw === undefined || raw === '') continue;
      if (def.type === 'integer' || def.type === 'number') out[k] = Number(raw);
      else if (def.type === 'boolean') out[k] = !!raw;
      else if (def.type === 'array') out[k] = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
      else out[k] = raw;
    }
    return out;
  };

  const isEmpty = (k) => vals[k] === undefined || String(vals[k]).trim() === '';
  // Of the fields flagged at the last attempt, only the ones STILL empty stay outlined.
  const stillMissing = (missing || []).filter(isEmpty);
  const trySave = () => {
    const miss = [...required].filter(isEmpty);
    setMissing(miss.length ? miss : null);
    if (!miss.length) onSave(buildValue());
  };

  const labelOf = (k) => (wsT && wsT(`${namespace}.${k}`)) || k;
  const hintOf = (k, def) => (wsT && wsT(`${namespace}.${k}.hint`)) || def.description
    || (k === 'id' && !initial ? (t('organisms.autoIdHint') || 'Pre-filled automatically — change it if you want a memorable id.') : '');

  const control = (k, def) => {
    if (def.type === 'string' && Array.isArray(def.enum)) {
      return html`<select class="input-field input-sm" value=${vals[k] ?? ''} onChange=${e => set(k, e.target.value)}>
          <option value="">—</option>${def.enum.map(o => html`<option value=${o} key=${o}>${o}</option>`)}
        </select>`;
    }
    // Date / datetime fields → native pickers (by schema format, or a name ending in _date).
    if (def.format === 'date-time') {
      return html`<input type="datetime-local" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
    }
    if (def.format === 'date' || (def.type === 'string' && !def.enum && /(_date$|^date$)/i.test(k))) {
      return html`<input type="date" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
    }
    if (def.type === 'integer' || def.type === 'number') {
      return html`<input type="number" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
    }
    if (def.type === 'array') {
      return html`<textarea class="input-field input-sm" rows="2" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)}></textarea>`;
    }
    return html`<input type="text" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
  };

  const field = (k, def) => {
    const label = labelOf(k) + (required.has(k) ? ' *' : '');
    if (def.type === 'boolean') {
      return html`<label class="pj-field pj-field-inline" key=${k}><input type="checkbox" checked=${!!vals[k]} onChange=${e => set(k, e.target.checked)} /><span>${label}</span></label>`;
    }
    const hint = hintOf(k, def);
    const suffix = def.type === 'array' ? ' (' + (t('organisms.onePerLine') || 'one per line') + ')' : '';
    return html`<label class="pj-field ${stillMissing.includes(k) ? 'pj-field-invalid' : ''}" key=${k}>
      <span>${label}${suffix}</span>
      ${hint ? html`<span class="pj-field-hint">${hint}</span>` : null}
      ${control(k, def)}</label>`;
  };

  return html`
    <div class="create-form pj-draft-form">
      <div class="flex-col">
        ${fieldNames.length === 0
          ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading...'}</div>`
          : fieldNames.map(k => field(k, props[k]))}
        ${stillMissing.length ? html`<div class="pj-form-error">${(t('organisms.fillRequired') || 'Please fill in the required fields: {fields}')
            .replace('{fields}', stillMissing.map(labelOf).join(', '))}</div>` : null}
        <div class="form-actions">
          <button class="btn-primary btn-sm" onClick=${trySave} disabled=${busy}>${t('organisms.saveDraft') || 'Save draft'}</button>
          <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      </div>
    </div>
  `;
}

/* Free-form markdown page editor for document-mode object types: a title + a markdown textarea
 * with a live preview (reusing the safe Markdown renderer). Saves as a draft, versioned on publish. */
// Lazy-load the vendored Toast UI Editor (MIT, /lib/toastui/) only when a document is edited —
// it's ~520KB, so it stays out of the main bundle. Resolves window.toastui.Editor.
let _tuiPromise = null;
function loadToastUI() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(window.toastui.Editor);
  if (_tuiPromise) return _tuiPromise;
  _tuiPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/lib/toastui/toastui-editor.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/lib/toastui/toastui-editor-all.min.js';
    s.onload = () => (window.toastui && window.toastui.Editor) ? resolve(window.toastui.Editor) : reject(new Error('editor missing'));
    s.onerror = () => reject(new Error('failed to load editor'));
    document.head.appendChild(s);
  });
  return _tuiPromise;
}

/* Read-only document view. Renders the markdown, resolves private /v1/storage images (the GET needs
 * the session token, so a plain <img> would break), and — when the document has BOTH an unpublished
 * draft and a published version — offers a Draft/Published toggle so the two can be compared. The
 * parent passes the merged `page` (the draft, carrying the published copy on `page._pub`). Remounted
 * per document via `key`, so the toggle resets to "Draft" each time a document is opened. */
export function DocumentView({ page, busy, onEdit, onPublish, onWikiLink, onPopOut }) {
  const hasBoth = page._draft && page._pub;
  const [tab, setTab] = useState('draft');
  const shown = (hasBoth && tab === 'published') ? page._pub : page;
  const [rendered, setRendered] = useState(shown.markdown || '');

  // Resolve private /v1/storage images to auth'd blob: URLs IN THE MARKDOWN TEXT (declarative), then
  // render that. Doing it in the text — instead of mutating <img src> after render — means a
  // re-render (toggling Draft/Published, a live-update refresh) can never leave a stale or revoked
  // object URL on a reused <img> node, which previously showed a broken image. Re-runs per version.
  useEffect(() => {
    let cancelled = false; const created = [];
    const raw = shown.markdown || '';
    setRendered(raw);   // show text/structure at once; images swap in a moment later
    (async () => {
      const urls = [...new Set(raw.match(/\/v1\/storage\/[^\s)\]"'>]+/g) || [])];
      if (!urls.length) return;
      let out = raw;
      for (const su of urls) {
        try { const bu = await orgService.fetchStorageObjectUrl(su); created.push(bu); out = out.split(su).join(bu); }
        catch (e) { /* leave the storage URL — renders broken but never throws */ }
      }
      if (!cancelled) setRendered(out);
    })();
    return () => { cancelled = true; created.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } }); };
  }, [shown.markdown]);

  // created/saved/published timestamps come from the workspace read (record metadata on the value).
  const created = page._createdAt || page._pub?._createdAt;
  const savedAt = page._draft ? page._updatedAt : null;          // draft = working copy → "last saved"
  const publishedAt = page._pub?._updatedAt || (!page._draft && page._published ? page._updatedAt : null);

  return html`
    <div class="pj-doc-toolbar">
      <span class="pj-doc-vtitle">${shown.title || shown.id || page.id}</span>
      ${hasBoth ? html`
        <div class="seg" role="tablist">
          <button class="seg-btn ${tab === 'draft' ? 'active' : ''}" onClick=${() => setTab('draft')}>${t('organisms.draftVersion') || 'Draft'}</button>
          <button class="seg-btn ${tab === 'published' ? 'active' : ''}" onClick=${() => setTab('published')}>${t('organisms.publishedVersion') || 'Published'}</button>
        </div>` : null}
      <button class="btn-ghost btn-sm" onClick=${onEdit}>${t('organisms.edit') || 'Edit'}</button>
      ${page._draft ? html`<button class="btn-primary btn-sm" onClick=${onPublish} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>` : null}
      ${onPopOut ? html`<button class="btn-ghost btn-sm pj-doc-popout" title=${t('organisms.popOut') || 'Open in its own window'} onClick=${onPopOut}>${'⧉'}</button>` : null}
    </div>
    ${(created || savedAt || publishedAt) ? html`
      <div class="pj-doc-meta">
        ${created ? html`<${KeyValueRow} label=${t('organisms.createdAt') || 'Created'} value=${dt(created)} />` : null}
        ${savedAt ? html`<${KeyValueRow} label=${t('organisms.lastSaved') || 'Last saved'} value=${dt(savedAt)} />` : null}
        ${publishedAt ? html`<${KeyValueRow} label=${t('organisms.publishedAt') || 'Published'} value=${dt(publishedAt)} />` : null}
      </div>` : null}
    <div class="pj-doc-view"><${Markdown} text=${rendered} onWikiLink=${onWikiLink} /></div>`;
}

/* Document editor: a Toast UI Editor (WYSIWYG, with its own built-in Markdown⇄WYSIWYG toggle, so
 * non-technical users type like a document). Falls back to a plain markdown textarea + live preview
 * if the editor can't load. Title is a separate Preact-controlled field. */
export function DocumentEditor({ orgId, page, busy, onSave, onCancel }) {
  const [title, setTitle] = useState((page && page.title) || '');
  const [mode, setMode] = useState('rich');               // 'rich' = Toast UI; 'markdown' = fallback textarea
  const [md, setMd] = useState((page && page.markdown) || '');
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const imageMap = useRef({});                             // data: URL (shown in editor) → /v1/storage URL (saved)
  const displayMap = useRef({});                           // blob: URL (shown in editor) → /v1/storage URL (saved) — for already-stored images
  const pending = useRef([]);                              // in-flight image uploads — save() awaits these
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState([]);                // embedded /v1/storage images: [{key, alt, visibility}]
  const [imgBusy, setImgBusy] = useState(false);

  // Load the visibility of the document's already-saved /v1/storage images, so the author can make
  // them public (a private image won't load for other viewers of a shared/published document).
  // Newly-pasted images appear here after the first save + reopen.
  useEffect(() => {
    let cancelled = false;
    const embedded = orgService.extractStorageImages((page && page.markdown) || '');
    if (!embedded.length) { setImages([]); return undefined; }
    orgService.listStorageVisibilities().then((vis) => {
      if (!cancelled) setImages(embedded.map(e => ({ ...e, visibility: vis[e.key] || 'private' })));
    }).catch(() => { if (!cancelled) setImages(embedded.map(e => ({ ...e, visibility: 'private' }))); });
    return () => { cancelled = true; };
  }, []);

  const changeImageVisibility = async (key, visibility) => {
    setImgBusy(true);
    try {
      const r = await orgService.setImageVisibility(key, visibility);
      if (r?.ok === false) throw new Error(r?.error?.message || 'Failed');
      setImages(imgs => imgs.map(i => i.key === key ? { ...i, visibility } : i));
    } catch (e) { /* leave as-is; a failed toggle just doesn't change the pill */ }
    finally { setImgBusy(false); }
  };
  const makeAllImagesPublic = async () => {
    setImgBusy(true);
    try {
      const targets = images.filter(i => i.visibility !== 'public');
      await Promise.all(targets.map(i => orgService.setImageVisibility(i.key, 'public').catch(() => {})));
      setImages(imgs => imgs.map(i => ({ ...i, visibility: 'public' })));
    } finally { setImgBusy(false); }
  };

  // Show the image instantly via a data URL, upload to storage in the background, and remember the
  // mapping so save() rewrites the data URL to the storage URL. If the upload fails, the image stays
  // inline (still renders + saves, just larger) — so an image NEVER silently disappears.
  const uploadAndMap = (blob, dataUrl) => {
    pending.current.push(
      orgService.uploadImage(orgId, blob, blob.type || 'image/png')
        .then((url) => { imageMap.current[dataUrl] = url; })
        .catch(() => { /* keep the inline data URL */ }),
    );
  };
  const insertFromFile = async (file) => {
    if (!file) return;
    const dataUrl = await orgService.blobToDataUrl(file);
    if (mode === 'rich' && editorRef.current) editorRef.current.exec('addImage', { imageUrl: dataUrl, altText: file.name || 'image' });
    else setMd((m) => m + `\n\n![${file.name || 'image'}](${dataUrl})\n`);
    uploadAndMap(file, dataUrl);
  };

  useEffect(() => {
    if (mode !== 'rich') return undefined;
    let inst = null, cancelled = false; const blobUrls = [];
    (async () => {
      const Editor = await loadToastUI().catch(() => null);
      if (cancelled) return;
      if (!Editor) { setMode('markdown'); return; }
      // Already-stored images embed a private /v1/storage URL, which a plain <img> in the editor
      // can't load (the GET needs the session token). Fetch each with auth, show it as a blob: URL,
      // and remember blob→storage so save() rewrites it back to the canonical storage URL.
      let initial = (page && page.markdown) || '';
      const urls = [...new Set(initial.match(/\/v1\/storage\/[^\s)\]"'>]+/g) || [])];
      for (const su of urls) {
        try {
          const bu = await orgService.fetchStorageObjectUrl(su);
          displayMap.current[bu] = su; blobUrls.push(bu);
          initial = initial.split(su).join(bu);
        } catch (e) { /* leave the storage URL — it renders broken but saves intact */ }
      }
      if (cancelled || !containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        height: '440px',
        initialEditType: 'wysiwyg',
        previewStyle: 'tab',
        initialValue: initial,
        usageStatistics: false,
        // Drop Toast UI's own image button — its file popup is unreliable; the "📷 Insert image"
        // button above is the image path (and paste/drag still work via the hook below).
        toolbarItems: [
          ['heading', 'bold', 'italic', 'strike'],
          ['hr', 'quote'],
          ['ul', 'ol', 'task', 'indent', 'outdent'],
          ['table', 'link'],
          ['code', 'codeblock'],
        ],
        hooks: {
          // Paste/drag an image → insert it as a data URL (shows at once) + upload in the background.
          addImageBlobHook: async (blob, callback) => {
            const dataUrl = await orgService.blobToDataUrl(blob);
            callback(dataUrl, '');
            uploadAndMap(blob, dataUrl);
          },
        },
      });
      editorRef.current = inst;
    })();
    return () => {
      cancelled = true;
      if (inst) { try { inst.destroy(); } catch (e) { /* noop */ } }
      editorRef.current = null;
      blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
    };
  }, [mode]);

  const save = async () => {
    setSaving(true);
    try {
      if (pending.current.length) { await Promise.all(pending.current); pending.current = []; }  // finish uploads first
      let markdown = (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md;
      for (const [dataUrl, storageUrl] of Object.entries(imageMap.current)) markdown = markdown.split(dataUrl).join(storageUrl);
      for (const [blobUrl, storageUrl] of Object.entries(displayMap.current)) markdown = markdown.split(blobUrl).join(storageUrl);
      // Point each image at the URL form its visibility needs: public → /v1/pub/<ghii>/<key> (loads
      // for any viewer), private → /v1/storage/<key> (owner-only). So a public document's images render.
      const visByKey = {}; for (const im of images) visByKey[im.key] = im.visibility;
      markdown = orgService.applyImageVisibilityUrls(markdown, visByKey, orgService.currentGhii());
      onSave({ ...page, title: title.trim(), markdown });
    } finally { setSaving(false); }
  };

  return html`
    <div class="pj-doc-editor">
      <input type="text" class="input-field input-sm" placeholder=${t('organisms.pageTitle') || 'Document title'}
        value=${title} onInput=${e => setTitle(e.target.value)} />
      <div class="pj-doc-imgbar">
        <label class="btn-outline btn-sm pj-file-btn">
          <span class="pj-file-btn-icon">📷</span> ${t('organisms.insertImage') || 'Upload image from file'}
          <input type="file" accept="image/*" hidden onChange=${e => { insertFromFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
        <span class="pj-imgbar-hint">${t('organisms.orPaste') || '…or paste / drag an image into the editor'}</span>
      </div>
      ${images.length ? html`
        <div class="pj-img-vis">
          <div class="pj-img-vis-head">
            <span class="pj-img-vis-title">${t('organisms.fileVisibility') || 'File visibility'}</span>
            <span class="pj-img-vis-note">${t('organisms.fileVisibilityNote') || 'Private files only load for you — make them public to share the document.'}</span>
            ${images.some(i => i.visibility !== 'public') ? html`<button class="btn-ghost btn-sm" disabled=${imgBusy} onClick=${makeAllImagesPublic}>${t('organisms.makeAllPublic') || 'Make all public'}</button>` : null}
          </div>
          ${images.map(i => html`
            <div class="pj-img-vis-row" key=${i.key}>
              <span class="pj-img-vis-name" title=${i.key}>${(i.alt)}</span>
              <${VisibilityPill} visibility=${i.visibility} onClick=${() => { if (!imgBusy) changeImageVisibility(i.key, i.visibility === 'public' ? 'private' : 'public'); }} />
            </div>`)}
        </div>` : null}
      ${mode === 'rich'
        ? html`<div ref=${containerRef} class="pj-tui"></div>`
        : html`<div class="pj-doc-grid">
            <textarea class="input-field pj-doc-md" rows="14" placeholder=${t('organisms.writeMarkdown') || 'Write markdown…'}
              value=${md} onInput=${e => setMd(e.target.value)}></textarea>
            <div class="pj-doc-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${save} disabled=${busy || saving || !title.trim()}>
          ${saving ? html`<span class="spinner"></span> ${t('organisms.saving') || 'Saving…'}` : (t('organisms.saveDraft') || 'Save draft')}
        </button>
        <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>
    </div>
  `;
}
