/**
 * @file offers-tab.js
 * @description The Agent Offers "Do" surface — goal-first "what do you want to do with your agents".
 *   Aggregates every agent's published offers into one searchable list with trust badges
 *   (cost/latency/verification/dataHandling/availability), and a mode-aware Ask (Run / Copy prompt /
 *   Run now) that returns a result with a provenance footer. See docs/plans/2026-06-12-agent-offers-*.md.
 * @structure default OffersTab({ session, showToast }) · OfferCard · badges
 * @version-history
 *   v1.0.0 -- 2026-06-12 -- Initial v1: Do feed + offer detail + mode-aware Ask + provenance footer.
 *   v1.1.0 -- 2026-06-12 -- Billable offers: price/visibility badges + an owner Selling editor (price +
 *     visibility) on the offer card, persisted via setOfferBilling.
 *   v1.2.0 -- 2026-06-12 -- Inbox shows the real deliverable (read from the agent namespace, markdown-
 *     rendered) even when deliverableKey is unset; sample rendered as markdown; request box clears after
 *     Ask; "Requested" links to the Inbox.
 *   v1.3.0 -- 2026-06-13 -- Image deliverables: the inbox deliverable preview + the offer sample now
 *     render image values (a /v1/pub URL, data: URI, or { url, mime } object) as inline thumbnails via
 *     the shared ImageDeliverable renderer (DeliverableBody). Pairs with deliverable.format:"image".
 *   v1.4.0 -- 2026-06-16 -- Richer Offerings card: structured (JSON) sample via DeliverableBody format;
 *     per-offer "Recent runs" (lazy-fetched, reuses DeliverableRow); prerequisites — SHOW ("needs
 *     first"), GATE (disable Ask + reason when a hard prereq is unmet, from offer.prereq), and BUNDLE
 *     (this offer is a step of a workflow, from offer.workflows).
 *   v1.4.1 -- 2026-06-16 -- BUNDLE navigates to the Workflows tab (aimeat-open-tab event) instead of
 *     launching the run, so the user reviews + runs the chain deliberately there.
 *   v1.5.0 -- 2026-06-16 -- Findability: Do/Map/Inbox segments; facet filters + group-by axis
 *     (need-verb default) + standing sort (value≠activity) + ⏱ Automatiikassa pinned group; a Mermaid
 *     orientation map (Kartta); crew-forge "build for this need" empty-state; and an AI need-router
 *     (✨ Find by need) that ranks the catalogue and proposes a builder brief when nothing fits. Pure
 *     grouping logic in /js/services/offers-grouping.js; AI via offers.js rankOffersByNeed.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { Mermaid } from '/components/Mermaid.js';
import { dt } from '/js/format.js';
import * as offersService from '/js/services/offers.js';
import * as grouping from '/js/services/offers-grouping.js';

const askLabel = (entry, offer) => {
  if (offer?.availability?.scheduleBorn) return t('profile.offers.runNow') || '⏱ Run now';
  const m = entry.mode || 'interactive';
  return (m === 'task-runner' || m === 'autonomous') ? (t('profile.offers.run') || '▶ Run') : (t('profile.offers.copyPrompt') || '⧉ Copy prompt');
};

/** Pick a display string from a (possibly localized) title — a plain string or a { locale: text } map. */
const locTitle = (title) => {
  if (!title) return '';
  if (typeof title === 'string') return title;
  return title.en_US || title.fi_FI || Object.values(title)[0] || '';
};

function Badges({ offer }) {
  const chips = [];
  if (offer.visibility && offer.visibility !== 'private') chips.push(['vis', t('profile.offers.visibility.' + offer.visibility) || offer.visibility]);
  if (offer.price && offer.price.morsels > 0) chips.push(['price', offer.price.morsels + ' ' + (t('profile.offers.morsels') || 'morsels')]);
  if (offer.verification) chips.push(['ver', t('profile.offers.verification.' + offer.verification) || offer.verification]);
  if (offer.dataHandling) chips.push(['data', t('profile.offers.dataHandling.' + offer.dataHandling) || offer.dataHandling]);
  if (offer.cost) chips.push(['cost', t('profile.offers.cost.' + offer.cost) || offer.cost]);
  if (offer.latency) chips.push(['lat', t('profile.offers.latency.' + offer.latency) || offer.latency]);
  return html`<span class="of-badges">${chips.map(([k, label]) => html`<span class="of-badge of-badge--${k}" key=${k}>${escHtml(label)}</span>`)}</span>`;
}

function OfferCard({ entry, offer, showToast, confirm, busy, setBusy, onChanged, onGoInbox }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [vis, setVis] = useState(offer.visibility || 'private');
  const [morsels, setMorsels] = useState(offer.price?.morsels ?? 0);
  const [savingBill, setSavingBill] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runs, setRuns] = useState(undefined);   // undefined = not loaded, [] = none

  const consequences = offer.consequences || [];
  const gated = consequences.some(c => c.persistent || c.requiresApproval || c.type === 'external-send' || c.type === 'mutates-host' || c.type === 'publishes-public');

  // Prerequisites (server-evaluated against owner memory): show them, and GATE the Ask when a hard
  // prereq is unmet. `prereq` is absent when the offer declares none → nothing shown, never blocked.
  const prereq = offer.prereq || null;
  const blocked = !!prereq?.blocked;
  const blockedReasons = (prereq?.items || []).filter(i => i.hard && !i.ok).map(i => i.label);

  // Bundling workflows: this offer is a step of a multi-step chain — offer to run the whole thing.
  const bundles = offer.workflows || [];

  // Per-offer run history — lazy-fetched on first expand (like DeliverableRow's content fetch).
  const toggleRuns = async () => {
    const next = !runsOpen; setRunsOpen(next);
    if (next && runs === undefined) {
      setRuns('loading');
      const r = await offersService.listOfferRuns({ agent: entry.agent, offerId: offer.id, limit: 5 }).catch(() => []);
      setRuns(Array.isArray(r) ? r : []);
    }
  };

  // Bundle: don't launch the chain from here — take the user to the Workflows tab, where they can
  // review the whole workflow (blueprint + steps + run history) and run it deliberately. Uses the
  // profile SPA's cross-tab navigation event (LandingPage listens and opens the tab inline).
  const openWorkflow = (wf) => {
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'workflows' } }));
    showToast((t('profile.offers.bundleOpened') || 'Opening “{wf}” in Workflows…').replace('{wf}', locTitle(wf.title) || wf.id));
  };

  const doAsk = async () => {
    setBusy(true);
    try {
      const r = await offersService.ask(entry, offer, input);
      if (r.ok === false) { showToast(r.error?.message || (t('profile.offers.askFailed') || 'Ask failed')); setResult(null); }
      else {
        setResult({ ...r, at: new Date().toISOString() });
        setInput('');   // clear the request box — it has been submitted
        if (r.kind === 'prompt') showToast(t('profile.offers.promptCopied') || 'Prompt copied — paste it into the agent’s chat.');
        else if (r.kind === 'triggered') showToast(t('profile.offers.triggered') || 'Schedule triggered.');
        else if (r.kind === 'task') showToast((t('profile.offers.requested') || 'Requested — task queued for {agent}.').replace('{agent}', entry.agent));
      }
    } catch (e) { showToast((e && e.message) || (t('profile.offers.askFailed') || 'Ask failed')); }
    finally { setBusy(false); }
  };

  const onAsk = () => {
    if (gated) {
      confirm(
        (t('profile.offers.confirmAsk') || 'This has lasting effects ({effects}). Ask anyway?').replace('{effects}', consequences.map(c => c.type).join(', ')),
        doAsk, { danger: true });
    } else doAsk();
  };

  const saveBilling = async () => {
    setSavingBill(true);
    try {
      const price = Number(morsels) > 0 ? { morsels: Number(morsels), unit: 'per-call' } : null;
      const r = await offersService.setOfferBilling(entry.agent, offer.id, { price, visibility: vis });
      if (r?.ok === false) showToast(r?.error?.message || (t('profile.offers.billSaveFailed') || 'Could not save'));
      else { showToast(t('profile.offers.billSaved') || 'Saved.'); onChanged?.(); }
    } catch (e) { showToast((e && e.message) || (t('profile.offers.billSaveFailed') || 'Could not save')); }
    finally { setSavingBill(false); }
  };

  return html`
    <div class="of-card ${open ? 'of-card--open' : ''}">
      <div class="of-card-head" onClick=${() => setOpen(o => !o)}>
        <div class="of-card-title">
          <span class="of-offer-title">${escHtml(offer.title)}</span>
          <span class="of-agent">${escHtml(entry.agent)} <span class="of-dot ${entry.online ? 'of-dot--on' : 'of-dot--off'}" title=${entry.online ? (t('profile.offers.online') || 'online') : (t('profile.offers.offline') || 'last seen ' + (entry.last_seen ? dt(entry.last_seen) : '—'))}></span></span>
        </div>
        <${Badges} offer=${offer} />
      </div>
      <div class="of-ask">${escHtml(offer.ask)}</div>

      ${open ? html`
        <div class="of-detail">
          ${offer.example ? html`<div class="of-example"><span class="of-label">${t('profile.offers.example') || 'Example'}:</span> ${escHtml(offer.example)}</div>` : null}

          ${(offer.requirements || []).length ? html`
            <div class="of-label">${t('profile.offers.requirements') || 'Before you ask'}</div>
            <div class="of-req-list">${offer.requirements.map((r, i) => html`
              <span class="of-req" key=${i}>${escHtml(r.need)}${r.instruction ? html` <span class="of-mini">— ${escHtml(r.instruction)}</span>` : null}${r.fix ? html` <span class="of-fix">${escHtml(r.fix)}</span>` : null}</span>`)}</div>
          ` : null}

          ${consequences.length ? html`
            <div class="of-label">${t('profile.offers.consequences') || 'What this does'}</div>
            <div class="of-conseq-list">${consequences.map((c, i) => html`
              <span class="of-conseq ${(c.persistent || c.requiresApproval || c.type === 'mutates-host') ? 'of-conseq--warn' : ''}" key=${i}>
                ${escHtml(t('profile.offers.consequence.' + c.type) || c.type)}${c.requiresApproval ? ' ⚠' : ''}${c.dynamic ? ' ↯' : ''}</span>`)}</div>
          ` : null}

          ${prereq && prereq.items.length ? html`
            <div class="of-label">${t('profile.offers.needsFirst') || 'Needs first'}</div>
            <div class="of-prereq-list">${prereq.items.map((it, i) => html`
              <span class="of-prereq ${it.ok ? 'of-prereq--ok' : (it.hard ? 'of-prereq--blocked' : 'of-prereq--warn')}" key=${i}>
                <span class="of-prereq-mark">${it.ok ? '✓' : (it.hard ? '✕' : '!')}</span> ${escHtml(it.label)}</span>`)}</div>
          ` : null}

          ${offer.deliverable ? html`
            <div class="of-label">${t('profile.offers.deliverable') || 'You’ll get back'}: ${escHtml(offer.deliverable.format || '')}${offer.deliverable.location?.space ? html` <span class="of-mini">→ ${escHtml(offer.deliverable.location.space)}</span>` : null}</div>
            ${offer.deliverable.sample === 'untested'
              ? html`<span class="of-badge of-badge--untested">${t('profile.offers.untested') || 'untested — no sample yet'}</span>`
              : html`<div class="of-md of-sample-md"><${DeliverableBody} value=${offer.deliverable.sample} alt=${offer.title} format=${offer.deliverable.format} /></div>`}
          ` : null}

          <div class="of-runs">
            <button class="of-runs-toggle" onClick=${toggleRuns}>${runsOpen ? '▾' : '▸'} ${t('profile.offers.recentRuns') || 'Recent runs'}</button>
            ${runsOpen ? html`
              ${runs === 'loading' ? html`<div class="of-mini">…</div>` : null}
              ${Array.isArray(runs) && runs.length === 0 ? html`<div class="of-mini">${t('profile.offers.noRunsYet') || 'No runs yet for this offer.'}</div>` : null}
              ${Array.isArray(runs) ? runs.map(d => html`<${DeliverableRow} key=${d.task_id} d=${d} showToast=${showToast} onChanged=${onChanged} />`) : null}
            ` : null}
          </div>

          ${bundles.length ? html`
            <div class="of-bundle">
              <div class="of-mini">${t('profile.offers.bundleHint') || 'This is a step of a workflow — open it to run the whole chain:'}</div>
              <div class="flex-row-wrap">${bundles.map(wf => html`
                <button class="btn-outline btn-sm" key=${wf.id} onClick=${() => openWorkflow(wf)}>🔀 ${escHtml(locTitle(wf.title) || wf.id)} →</button>`)}</div>
            </div>
          ` : null}

          <textarea class="input-field input-sm of-input" rows="2" placeholder=${t('profile.offers.requestPlaceholder') || 'Your request (optional — fills the example)…'} value=${input} onInput=${(e) => setInput(e.target.value)}></textarea>
          <div class="flex-row-wrap">
            <button class="btn-primary btn-sm" disabled=${busy || blocked} onClick=${onAsk}>${askLabel(entry, offer)}</button>
          </div>
          ${blocked ? html`<div class="of-mini of-warn">${(t('profile.offers.blockedReason') || 'Can’t run yet — needs: {what}').replace('{what}', blockedReasons.join(', '))}</div>` : null}

          <div class="of-bill">
            <div class="of-label">${t('profile.offers.selling') || 'Selling'}</div>
            <div class="flex-row-wrap of-bill-row">
              <select class="input-field input-sm of-bill-vis" value=${vis} onChange=${(e) => setVis(e.target.value)}>
                <option value="private">${t('profile.offers.visibility.private') || 'Private (only me)'}</option>
                <option value="unlisted">${t('profile.offers.visibility.unlisted') || 'Unlisted (by link)'}</option>
                <option value="public">${t('profile.offers.visibility.public') || 'Public (listed)'}</option>
              </select>
              <input type="number" min="0" class="input-field input-sm of-bill-price" value=${morsels} onInput=${(e) => setMorsels(e.target.value)} placeholder=${t('profile.offers.priceMorsels') || 'Price'} />
              <span class="of-mini">${t('profile.offers.morsels') || 'morsels'} / ${t('profile.offers.perCall') || 'call'}</span>
              <button class="btn-outline btn-sm" disabled=${savingBill} onClick=${saveBilling}>${t('profile.offers.saveBilling') || 'Save'}</button>
            </div>
            ${vis !== 'private' && Number(morsels) > 0 ? html`<div class="of-mini">${(t('profile.offers.billHint') || 'Others pay {n} morsels per call; you keep it minus the marketplace fee. Your own use is free.').replace('{n}', morsels)}</div>` : null}
            ${vis !== 'private' && !offer.callable ? html`<div class="of-mini of-warn">${t('profile.offers.notCallableHint') || 'Not machine-callable yet — others can find it, but invoking it needs a capability binding (action_id).'}</div>` : null}
          </div>

          ${result ? html`
            <div class="of-result">
              ${result.kind === 'prompt' ? html`<div class="of-result-msg">${t('profile.offers.promptCopied') || 'Prompt copied — paste it into the agent’s chat.'}</div>` : null}
              ${result.kind === 'triggered' ? html`<div class="of-result-msg">${t('profile.offers.triggered') || 'Schedule triggered.'}</div>` : null}
              ${result.kind === 'task' ? html`<div class="of-result-msg">${(t('profile.offers.requested') || 'Requested — task queued for {agent}.').replace('{agent}', entry.agent)}${onGoInbox ? html` <button class="of-link" onClick=${onGoInbox}>${t('profile.offers.openInbox') || 'See it in the Inbox →'}</button>` : null}</div>` : null}
              <div class="of-prov">${t('profile.offers.provenance') || 'From'}: <b>${escHtml(entry.agent)}</b>${result.taskId ? html` · ${t('profile.offers.task') || 'task'} ${escHtml(String(result.taskId))} · ${t('profile.offers.queued') || 'queued'}` : ''} · ${dt(result.at)}</div>
            </div>
          ` : null}
        </div>
      ` : null}
    </div>
  `;
}

const STATUS_CLASS = { done: 'of-st--done', failed: 'of-st--failed', active: 'of-st--active', paused: 'of-st--active', stalled: 'of-st--failed', queued: 'of-st--queued', revision_requested: 'of-st--queued' };

function Stars({ value, onPick, disabled }) {
  return html`<span class="of-stars">${[1, 2, 3, 4, 5].map(n => html`
    <button class="of-star ${n <= value ? 'of-star--on' : ''}" key=${n} disabled=${disabled} onClick=${() => onPick(n)} title=${String(n)}>${n <= value ? '★' : '☆'}</button>`)}</span>`;
}

function DeliverableRow({ d, showToast, onChanged }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(undefined);   // undefined = not loaded, null = gone
  const [stars, setStars] = useState(d.rating?.stars || 0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !open; setOpen(next);
    // Fetch on first open for any non-failed task — the deliverable lives in the
    // agent's namespace and is found by deliverableKey OR the task:<id> tag, so we
    // don't gate on deliverable_key (CrewAI agents often never set it).
    if (next && content === undefined && d.status !== 'failed' && d.agent_gaii) {
      setContent('loading');
      const v = await offersService.getDeliverableContent({ agentGaii: d.agent_gaii, deliverableKey: d.deliverable_key, taskId: d.task_id }).catch(() => null);
      setContent(v ?? null);
    }
  };
  const submitRating = async () => {
    if (!stars) return;
    setBusy(true);
    try {
      const r = await offersService.rateDeliverable(d.agent, d.task_id, { stars, comment: comment.trim() || undefined });
      if (r?.ok === false) showToast(r?.error?.message || (t('profile.offers.rateFailed') || 'Rating failed'));
      else { showToast(t('profile.offers.rated') || 'Thanks — rated.'); setComment(''); onChanged?.(); }
    } catch (e) { showToast((e && e.message) || (t('profile.offers.rateFailed') || 'Rating failed')); }
    finally { setBusy(false); }
  };

  return html`
    <div class="of-card ${open ? 'of-card--open' : ''}">
      <div class="of-card-head" onClick=${toggle}>
        <div class="of-card-title">
          <span class="of-offer-title">${escHtml(d.title || d.task_id)}</span>
          <span class="of-agent">${escHtml(d.agent)}</span>
        </div>
        <span class="of-status ${STATUS_CLASS[d.status] || ''}">${t('profile.offers.status.' + d.status) || d.status}</span>
      </div>
      ${open ? html`
        <div class="of-detail">
          ${d.verification ? html`<div class="of-mini">${t('profile.offers.expected') || 'Expected'}: ${escHtml(d.verification)}</div>` : null}
          ${d.status === 'failed' ? html`<div class="of-fail">${t('profile.offers.failedMsg') || 'This task failed — no deliverable was produced.'}</div>`
            : content === undefined ? null
            : content === 'loading' ? html`<div class="of-mini">…</div>`
            : content === null ? html`<div class="of-mini">${t('profile.offers.noDeliverableYet') || 'No deliverable yet.'}</div>`
            : html`<div class="of-md"><${DeliverableBody} value=${content} alt=${d.title || d.task_id} /></div>`}

          <div class="of-prov">${t('profile.offers.provenance') || 'From'}: <b>${escHtml(d.agent)}</b> · ${t('profile.offers.task') || 'task'} ${escHtml(String(d.task_id))} · ${t('profile.offers.status.' + d.status) || d.status} · ${dt(d.updated_at)}</div>

          ${d.status === 'done' ? html`
            <div class="of-rate">
              <span class="of-label">${d.rating ? (t('profile.offers.yourRating') || 'Your rating') : (t('profile.offers.rateIt') || 'Rate it')}</span>
              <${Stars} value=${stars} disabled=${busy} onPick=${(n) => setStars(n)} />
              <input class="input-field input-sm of-rate-note" placeholder=${t('profile.offers.ratePlaceholder') || 'Optional note…'} value=${comment} onInput=${(e) => setComment(e.target.value)} />
              <button class="btn-primary btn-sm" disabled=${busy || !stars} onClick=${submitRating}>${t('profile.offers.submitRating') || 'Submit'}</button>
            </div>
          ` : null}
        </div>
      ` : null}
    </div>
  `;
}

function InboxFeed({ showToast }) {
  const [items, setItems] = useState(null);
  const load = useCallback(async () => {
    const r = await offersService.listDeliverables().catch(() => null);
    setItems(r?.data?.deliverables || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const h = () => liveRef.current();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, []);
  return html`
    <div>
      ${items === null ? html`<div class="section-desc">…</div>` : null}
      ${items !== null && items.length === 0 ? html`<div class="empty">${t('profile.offers.inboxEmpty') || 'Nothing has come back yet. Ask an agent something in “What can I do?”.'}</div>` : null}
      ${(items || []).map(d => html`<${DeliverableRow} key=${d.task_id} d=${d} showToast=${showToast} onChanged=${load} />`)}
    </div>
  `;
}

// ── label helpers (i18n lives here, not in the pure grouping module) ──
const needLabel = (key) => t('profile.offers.need.' + key) || key;
const facetLabel = (key) => t('profile.offers.facet.' + key) || key;
const facetValueLabel = (key, v) => {
  const map = { cost: 'cost', latency: 'latency', verification: 'verification', dataHandling: 'dataHandling', format: 'format' };
  return t('profile.offers.' + (map[key] || key) + '.' + v) || v;
};
const axisKeyLabel = (axis, key) => {
  if (axis === 'need') return needLabel(key);
  if (axis === 'auto') return key === 'auto' ? (t('profile.offers.autoSection') || '⏱ Runs automatically') : (t('profile.offers.manualSection') || 'On demand');
  if (key === '∅') return t('profile.offers.ungrouped') || 'Other';
  return key;
};

/** One collapsible group of offer cards. */
function GroupSection({ label, count, collapsed, onToggle, children }) {
  return html`
    <div class="of-group">
      <button class="of-group-head" onClick=${onToggle}>
        <span class="of-group-caret">${collapsed ? '▸' : '▾'}</span>
        <span class="of-group-title">${label}</span>
        <span class="of-group-count">${count}</span>
      </button>
      ${collapsed ? null : html`<div class="of-group-body">${children}</div>`}
    </div>`;
}

export default function OffersTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [view, setView] = useState('do');   // 'do' | 'map' | 'inbox'
  const [feed, setFeed] = useState(null);    // null = loading
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [facets, setFacets] = useState({});  // { facetKey: Set(values) }
  const [axis, setAxis] = useState('need');
  const [sortMode, setSortMode] = useState('standing');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [aiOn, setAiOn] = useState(false);
  const [aiResult, setAiResult] = useState(null);   // null | 'loading' | { ranked, noMatch, brief }

  const load = useCallback(async () => {
    try {
      const r = await offersService.listOffers();
      setFeed(r?.data?.agents || []);
    } catch { setFeed([]); }
  }, []);
  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => { if (session) offersService.aiAvailable().then(setAiOn).catch(() => setAiOn(false)); }, [session]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // Flatten to { entry, offer, agent }.
  const items = [];
  for (const entry of (feed || [])) for (const offer of (entry.offers || [])) items.push({ entry, offer, agent: entry.agent });

  // Text + facet filtering (deterministic, instant).
  const needle = q.trim().toLowerCase();
  const filtered = items.filter(({ entry, offer }) => {
    if (needle && !(offer.title + ' ' + offer.ask + ' ' + (offer.tags || []).join(' ') + ' ' + entry.agent).toLowerCase().includes(needle)) return false;
    return grouping.matchesFacets(offer, facets);
  });

  const availFacets = grouping.availableFacetValues(items);
  const activeFacetCount = Object.values(facets).reduce((n, s) => n + (s ? s.size : 0), 0);

  const toggleFacet = (key, val) => setFacets(prev => {
    const next = { ...prev };
    const set = new Set(next[key] || []);
    if (set.has(val)) set.delete(val); else set.add(val);
    next[key] = set;
    return next;
  });
  const clearFilters = () => { setFacets({}); setQ(''); };
  const toggleCollapse = (key) => setCollapsed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // Builder offer (crew-forge): an offer whose consequence is creating an agent — the "no match → make one" path.
  const builder = items.find(it => (it.offer.consequences || []).some(c => c.type === 'creates-agent'))
    || items.find(it => /forge/i.test(it.agent));
  const buildForNeed = async (brief) => {
    if (!builder) { showToast(t('profile.offers.noBuilder') || 'No agent-builder available. Connect crew-forge first.'); return; }
    setBusy(true);
    try {
      const r = await offersService.ask(builder.entry, builder.offer, brief || q || '');
      if (r?.ok === false) showToast(r.error?.message || (t('profile.offers.askFailed') || 'Ask failed'));
      else showToast((t('profile.offers.buildRequested') || 'Asked {agent} to build an agent for this.').replace('{agent}', builder.agent));
    } catch (e) { showToast((e && e.message) || (t('profile.offers.askFailed') || 'Ask failed')); }
    finally { setBusy(false); }
  };

  // AI need-router: rank the catalogue against the typed need (explicit submit only).
  const runNeedSearch = async () => {
    if (!q.trim()) return;
    setAiResult('loading');
    try {
      const r = await offersService.rankOffersByNeed(q.trim(), items);
      setAiResult(r);
    } catch (e) {
      setAiResult(null);
      const code = e?.code;
      const msg = code === 'NO_API_KEY' ? (t('profile.offers.aiNoKey') || 'Set up an OpenRouter key first (AI settings).')
        : code === 'QUOTA_EXHAUSTED' || code === 'APP_QUOTA_EXHAUSTED' ? (t('profile.offers.aiQuota') || 'Daily AI budget reached.')
        : (e?.message || (t('profile.offers.aiFailed') || 'Need search failed.'));
      showToast(msg);
    }
  };
  const clearAi = () => setAiResult(null);

  const renderCard = (it) => html`<${OfferCard}
    key=${it.agent + '/' + it.offer.id}
    entry=${it.entry} offer=${it.offer}
    showToast=${showToast} confirm=${confirm} busy=${busy} setBusy=${setBusy} onChanged=${load} onGoInbox=${() => setView('inbox')} />`;

  // Sections for the "Do" browse view: a pinned ⏱ Automatiikassa group, then grouped-by-axis (rest).
  const autoItems = grouping.sortOffers(filtered.filter(it => grouping.isAuto(it.offer)), sortMode);
  const restItems = filtered.filter(it => !grouping.isAuto(it.offer));
  const groups = grouping.groupByAxis(restItems, axis).map(g => ({ ...g, items: grouping.sortOffers(g.items, sortMode) }));

  // Mermaid map source (orientation): groups by the chosen axis over the filtered set.
  const mapGroups = grouping.groupByAxis(filtered, axis).map(g => ({ label: axisKeyLabel(axis, g.key), items: g.items }));
  const mermaidSrc = grouping.buildMermaid(t('profile.offers.title') || 'What can I do?', mapGroups);

  const titleByView = view === 'inbox' ? (t('profile.offers.inboxTitle') || 'What came back')
    : view === 'map' ? (t('profile.offers.mapTitle') || 'Map of what you can do')
    : (t('profile.offers.title') || 'What can I do?');
  const descByView = view === 'inbox' ? (t('profile.offers.inboxDesc') || 'Everything your agents delivered — check it and rate it, all in one place.')
    : view === 'map' ? (t('profile.offers.mapDesc') || 'A bird’s-eye map of your offers, grouped — orient here, act in the list.')
    : (t('profile.offers.desc') || 'Everything your agents can do for you — search, then ask.');

  return html`
    <div class="of">
      <div class="section-title">${titleByView}</div>
      <div class="section-desc">${descByView}</div>

      <div class="of-seg">
        <button class="of-seg-btn ${view === 'do' ? 'of-seg-btn--on' : ''}" onClick=${() => setView('do')}>${t('profile.offers.segDo') || 'Do'}</button>
        <button class="of-seg-btn ${view === 'map' ? 'of-seg-btn--on' : ''}" onClick=${() => setView('map')}>${t('profile.offers.segMap') || 'Map'}</button>
        <button class="of-seg-btn ${view === 'inbox' ? 'of-seg-btn--on' : ''}" onClick=${() => setView('inbox')}>${t('profile.offers.segInbox') || 'Inbox'}</button>
      </div>

      ${view === 'inbox' ? html`<${InboxFeed} showToast=${showToast} />` : html`
        <div class="of-toolbar">
          <input class="input-field input-sm of-search" placeholder=${t('profile.offers.searchPlaceholder') || 'What do you want to do?…'} value=${q}
            onInput=${(e) => { setQ(e.target.value); if (aiResult) clearAi(); }}
            onKeyDown=${(e) => { if (e.key === 'Enter' && aiOn) runNeedSearch(); }} />
          ${aiOn ? html`<button class="btn-outline btn-sm of-ai-btn" disabled=${!q.trim() || aiResult === 'loading'} onClick=${runNeedSearch}>✨ ${t('profile.offers.aiSearch') || 'Find by need'}</button>` : null}
        </div>

        ${view === 'do' ? html`
          <div class="of-controls">
            <label class="of-ctrl"><span>${t('profile.offers.groupBy') || 'Group'}</span>
              <select class="input-field input-sm" value=${axis} onChange=${(e) => setAxis(e.target.value)}>
                <option value="need">${t('profile.offers.axis.need') || 'By need'}</option>
                <option value="agent">${t('profile.offers.axis.agent') || 'By agent'}</option>
                <option value="auto">${t('profile.offers.axis.auto') || 'By automation'}</option>
                <option value="tag">${t('profile.offers.axis.tag') || 'By tag'}</option>
                <option value="capability">${t('profile.offers.axis.capability') || 'By capability'}</option>
              </select>
            </label>
            <label class="of-ctrl"><span>${t('profile.offers.sortBy') || 'Sort'}</span>
              <select class="input-field input-sm" value=${sortMode} onChange=${(e) => setSortMode(e.target.value)}>
                <option value="standing">${t('profile.offers.sort.standing') || 'Most valuable'}</option>
                <option value="cost">${t('profile.offers.sort.cost') || 'Cheapest'}</option>
                <option value="speed">${t('profile.offers.sort.speed') || 'Fastest'}</option>
                <option value="name">${t('profile.offers.sort.name') || 'A–Z'}</option>
              </select>
            </label>
          </div>
        ` : null}

        ${Object.keys(availFacets).length ? html`
          <div class="of-facets">
            ${grouping.FACETS.filter(f => availFacets[f.key]).map(f => html`
              <div class="of-facet" key=${f.key}>
                <span class="of-facet-label">${facetLabel(f.key)}</span>
                ${availFacets[f.key].map(v => html`
                  <button class="of-chip ${facets[f.key]?.has(v) ? 'of-chip--on' : ''}" key=${v} onClick=${() => toggleFacet(f.key, v)}>${escHtml(facetValueLabel(f.key, v))}</button>`)}
              </div>`)}
            ${activeFacetCount || needle ? html`<button class="of-link of-clear" onClick=${clearFilters}>${t('profile.offers.clearFilters') || 'Clear'}</button>` : null}
          </div>` : null}

        ${feed === null ? html`<div class="section-desc">…</div>` : null}
        ${feed !== null && items.length === 0 ? html`<div class="empty">${t('profile.offers.empty') || 'None of your agents publish offers yet.'}</div>` : null}

        ${view === 'map' && items.length > 0 ? html`
          <div class="of-mapwrap">
            <${Mermaid} chart=${mermaidSrc} />
            <div class="of-mini">${t('profile.offers.mapNote') || 'Orientation only — switch to Do to open a card.'}</div>
          </div>
        ` : null}

        ${view === 'do' && aiResult && aiResult !== 'loading' ? html`
          <div class="of-ai-results">
            <div class="of-ai-head"><span class="of-label">${t('profile.offers.aiResultsTitle') || 'Best matches for your need'}</span><button class="of-link" onClick=${clearAi}>${t('profile.offers.aiClear') || 'Back to browse'}</button></div>
            ${aiResult.ranked.length === 0 || aiResult.noMatch ? html`
              <div class="of-empty-need">
                <div class="of-mini">${t('profile.offers.aiNoMatch') || 'No existing offer fits this need well.'}</div>
                ${aiResult.brief ? html`<div class="of-brief">${aiResult.brief}</div>` : null}
                ${builder ? html`<button class="btn-primary btn-sm" disabled=${busy} onClick=${() => buildForNeed(aiResult.brief)}>🛠 ${t('profile.offers.buildForNeed') || 'Build an agent for this →'}</button>` : null}
              </div>` : null}
            ${aiResult.ranked.map(({ item, why }) => html`
              <div class="of-ai-item" key=${item.agent + '/' + item.offer.id}>
                ${why ? html`<div class="of-why">💡 ${why}</div>` : null}
                ${renderCard(item)}
              </div>`)}
          </div>
        ` : null}

        ${view === 'do' && aiResult === 'loading' ? html`<div class="section-desc">✨ ${t('profile.offers.aiThinking') || 'Matching your need…'}</div>` : null}

        ${view === 'do' && !aiResult && items.length > 0 ? html`
          ${filtered.length === 0 ? html`
            <div class="of-empty-need">
              <div class="section-desc">${t('profile.offers.noMatch') || 'No offers match.'}</div>
              ${builder ? html`<button class="btn-primary btn-sm" disabled=${busy} onClick=${() => buildForNeed()}>🛠 ${t('profile.offers.buildForNeed') || 'Build an agent for this →'}</button>` : null}
            </div>` : html`
            ${autoItems.length ? html`
              <${GroupSection} label=${t('profile.offers.autoSection') || '⏱ Runs automatically'} count=${autoItems.length}
                collapsed=${collapsed.has('__auto')} onToggle=${() => toggleCollapse('__auto')}>
                ${autoItems.map(renderCard)}
              <//>` : null}
            ${groups.map(g => html`
              <${GroupSection} key=${g.key} label=${axisKeyLabel(axis, g.key)} count=${g.items.length}
                collapsed=${collapsed.has(axis + ':' + g.key)} onToggle=${() => toggleCollapse(axis + ':' + g.key)}>
                ${g.items.map(renderCard)}
              <//>`)}
          `}
        ` : null}
      `}

      <${ConfirmUI} />
    </div>
  `;
}
