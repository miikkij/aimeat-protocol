/**
 * @file knowledge-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Knowledge page in the poster face (design canvas "AIMEAT Admin Knowledge"):
 *   what has been published on this node, the shape of it, and what anybody has decided about it.
 *
 *   IT SHOWED TWENTY OF HOWEVER MANY THERE WERE. GET /v1/admin/knowledge has always paginated and
 *   always returned the count; the page asked for page one, read only `packages`, and drew them as
 *   cards. So an operator moderating a node saw the first twenty and had no way to learn the rest
 *   existed. On the page whose entire job is looking at everything, that is the one failure it
 *   cannot have, and the footer now states the count on every render.
 *
 *   AND A REVIEW LEFT NO MARK. The trail route existed and nothing read it, so submitting a review
 *   reloaded a card that looked exactly as it had. Two operators could not tell that one had
 *   already looked.
 *
 *   THE SHAPE IS A SECTION because a wall of cards structurally cannot be one. By author, by kind,
 *   by how finished: three counts the server already held, and where the data's own two defects
 *   turn out to be visible — one person stored under two spellings, and a maturity word this node
 *   does not define carried by most of the collection.
 * @structure
 *   - AskAi (05) — the knowledge tools, and the paste
 *   - KnowledgeAdminTab (default) — one read, the four sections, and the review panel
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face. One read that carries the count and the shape, a table
 *     with search and real paging in place of the card grid, and the review trail read back.
 *   v1.1.0 — 2026-06-02 — Admin design unification: entry-content textarea
 *     adm-input → adm-textarea (drop redundant resize/font-family inline style);
 *     delete-package button inline color → adm-btn-danger (campsite fix).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Spinner, ErrorBox, useToast, Toast, Row } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getNodeUrl } from '/js/services/auth.js';
import * as api from '/js/services/admin.js';
import { RightNow, WhatIsHere } from './knowledge-tab.shape.js';
import { PackageTable } from './knowledge-tab.list.js';
import { ReviewPanel, CreateForm } from './knowledge-tab.review.js';
import { buildKnowledgePrompt } from './knowledge-tab.prompt.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

/** Section 05: the tools, and the paste. */
function AskAi({ summary }) {
  const paste = buildKnowledgePrompt({ url: getNodeUrl(), total: summary.total });
  return html`
    <section class="og-sec" id="adm-kn-05">
      <div class="og-sec-h">
        <h2>${S('ai.title')}<small>05</small></h2>
        <div class="og-doors">
          <${CopyButton} text=${paste} label=${S('ai.copy')} className="og-door og-door--quiet" />
        </div>
      </div>
      <div class="adm-kn-ai">
        <div>
          <p class="adm-kn-lead">${S('ai.lead', { n: summary.total })}</p>
          ${Row({ title: S('ai.list'), why: S('ai.listWhy'), chip: null, value: 'aimeat_knowledge_list' })}
          ${Row({ title: S('ai.get'), why: S('ai.getWhy'), chip: null, value: 'aimeat_knowledge_get' })}
          ${Row({ title: S('ai.links'), why: S('ai.linksWhy'), chip: null, value: 'aimeat_knowledge_links', last: true })}
        </div>
        <div class="og-box">
          <span class="og-box-label">${S('ai.label')}</span>
          <div class="adm-kn-paste">${paste}</div>
        </div>
      </div>
    </section>`;
}

export default function KnowledgeAdminTab() {
  useViewCSS('/css/views/admin-knowledge.css');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();

  // Deps: the query itself. `showErr` is a new function every render and would loop the effect.
  const load = useCallback(async (opts) => {
    try {
      const r = await api.getKnowledgePackages(opts);
      if (r?.data) { setData(r.data); setFailed(null); }
    } catch (e) {
      console.warn('Failed to load knowledge packages:', e.message);
      setFailed(e.message);
    }
  }, []);

  // One debounce for the search, so typing does not fetch per keystroke.
  useEffect(() => {
    const opts = { ...filters, page, ...(q.trim() ? { q: q.trim() } : {}) };
    const id = setTimeout(() => load(opts), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [q, filters, page, load]);

  useEffect(() => onLiveUpdate(['memory'], () => {
    load({ ...filters, page, ...(q.trim() ? { q: q.trim() } : {}) });
  }), [load, filters, page, q]);

  const refresh = useCallback(() => {
    load({ ...filters, page, ...(q.trim() ? { q: q.trim() } : {}) });
  }, [load, filters, page, q]);

  /**
   * A filter change always returns to page one: page three of the old filter means nothing.
   *
   * `applyFilter({})` used to be the "all" chip, and merging an empty patch changes nothing — so
   * the chip did nothing, and an author picked in section 02 could not be undone at all without
   * reloading the page. Clearing is its own verb now, and every applied filter is shown as a chip
   * that removes itself: a filter a reader cannot see is a filter they cannot get out of.
   */
  const applyFilter = useCallback((patch) => {
    setFilters(f => {
      const next = { ...f, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false) delete next[k];
      return next;
    });
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => { setFilters({}); setPage(1); }, []);

  const submitReview = useCallback(async (packageId, form) => {
    setBusy(true);
    try {
      await api.reviewKnowledgePackage(packageId, form.reason, form.action, form.customText || undefined);
      showOk(S('review.saved'));
      setOpened(null);
      refresh();
    } catch (e) {
      console.warn('Review was refused:', e.message);
      showErr(e.message);
    } finally { setBusy(false); }
  }, [refresh, showErr, showOk]);

  const create = useCallback(async (form) => {
    setBusy(true);
    try {
      await api.createSystemKnowledge({
        name: form.name, content_type: form.content_type, tags: form.tags,
        maturity: form.maturity, visibility: form.visibility,
        catalog_listed: form.catalog_listed,
        entries: form.entries.filter(e => e.title.trim()),
      });
      setCreating(false);
      refresh();
    } catch (e) {
      console.warn('Creating a package was refused:', e.message);
      showErr(e.message);
    } finally { setBusy(false); }
  }, [refresh, showErr]);

  if (failed && !data) return html`<${ErrorBox} message=${failed} />`;
  if (!data) return html`<${Spinner} text=${S('loading')} />`;

  return html`<div class="adm-kn">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    ${opened
    ? html`<${ReviewPanel} pkg=${opened} busy=${busy}
        onClose=${() => setOpened(null)} onSubmit=${submitReview} />`
    : html`
      <${RightNow} data=${data} onShowFlagged=${() => setCreating(true)} />
      <${WhatIsHere} data=${data}
        onPickAuthor=${(key) => applyFilter({ author_key: filters.author_key === key ? undefined : key })}
        onPickKind=${(kind) => applyFilter({ content_type: filters.content_type === kind ? undefined : kind })} />
      <${PackageTable} data=${data} q=${q} onQ=${(v) => { setQ(v); setPage(1); }}
        filters=${filters} onFilter=${applyFilter} onClear=${clearFilters}
        onPage=${setPage} onOpen=${setOpened} />
      ${creating ? html`<${CreateForm} onCreate=${create} onCancel=${() => setCreating(false)} busy=${busy} />` : null}
      <${AskAi} summary=${data.summary} />`}
  </div>`;
}
