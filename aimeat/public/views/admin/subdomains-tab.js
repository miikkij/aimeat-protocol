/**
 * @file subdomains-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Subdomains page in the poster face (design canvas "AIMEAT Admin
 *   Subdomains"): the numeral strip, the search and the four filters that make a hundred and fifty
 *   addresses findable, one row per mapping with its state chip and a quiet delete, the add form
 *   with what the door refuses, and the empty state. The writes go through the same routes as
 *   before.
 *
 * @structure
 *   - SubdomainsAdminTab (default): load, filter, and the three sections
 *   - ownerOf / targetOwnerOf: who mapped it against whose app it is
 *   - AddForm: the address, what it serves, the target, and the preview of what is being made
 *   - Refusals: the four things the route answers no to, in its own words
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face: the table becomes rows, search and filters arrive (a
 *     hundred and fifty mappings had neither), the Type and Created by columns go (one repeated
 *     the same word on every row, the other the same identity — it shows now only when it differs
 *     from the app's owner), the per-row red button becomes a quiet word, and the checkbox becomes
 *     the state chip that is itself the switch.
 *   v1.1.0 — 2026-09-05 — The globe emoji before a subdomain link goes: no emoji anywhere in the interface.
 *   v1.0.0 — 2026-06-12 — Initial: subdomain routing (operator-only management)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { dt, num, Spinner, ErrorBox } from './shared.js';
import { swallowed } from '/js/swallowed.js';
import { Modal } from '/components/Modal.js';
import * as adminService from '/js/services/admin.js';

const S = (key, params) => t('admin.subdomains.' + key, params);

/** The owner half of a GHII ("alice@node" → "alice"); a bare name is returned as it is. */
function ownerOf(ghii) { return String(ghii || '').split('@')[0]; }
/** The owner half of an app target ("alice/notes.html" → "alice"). */
function targetOwnerOf(target) { return String(target || '').split('/')[0]; }

/** The day a mapping was made. The hour is in the delete dialog, where it helps; in a list of a
 *  hundred and fifty rows it is forty characters of noise. */
function day(iso) {
  try { return fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (err) { swallowed('subdomains: day', err); return ''; }
}

/** The magnifier, drawn rather than imported: the page has no icon set of its own. */
const FindIcon = () => html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M16 16 L21 21"></path></svg>`;

export default function SubdomainsAdminTab() {
  useViewCSS('/css/views/admin-subdomains.css');
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ subdomain: '', kind: 'app', target: '' });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState('all');
  // Type-to-confirm delete state: { subdomain, target, kind, createdAt, typed }
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await adminService.getSubdomainSites();
      setSites(resp?.data?.sites || []);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const create = useCallback(async () => {
    setFormError(null);
    setSaving(true);
    try {
      await adminService.createSubdomainSite({
        subdomain: form.subdomain.trim().toLowerCase(),
        kind: form.kind,
        target: form.target.trim(),
      });
      setShowCreate(false);
      setForm({ subdomain: '', kind: 'app', target: '' });
      load();
    } catch (err) {
      setFormError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const toggleEnabled = useCallback(async (site) => {
    try {
      await adminService.updateSubdomainSite(site.subdomain, { enabled: !site.enabled });
      load();
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, [load]);

  const doDelete = useCallback(async () => {
    if (!deleting || deleting.typed !== deleting.subdomain) return;
    try {
      await adminService.deleteSubdomainSite(deleting.subdomain);
      setDeleting(null);
      load();
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(null);
    }
  }, [deleting, load]);

  // Public URL for a mapping, and the apex it hangs under, both from the page's own host.
  const siteUrl = (sub) => `${location.protocol}//${sub}.${location.host}/`;
  const apex = `.${location.host}`;

  const counts = useMemo(() => ({
    total: sites.length,
    apps: sites.filter(s => s.kind === 'app').length,
    redirects: sites.filter(s => s.kind === 'redirect').length,
    off: sites.filter(s => !s.enabled).length,
  }), [sites]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    // The footer says a-z by address, so the list is sorted here rather than trusting the order
    // the storage happened to return.
    return [...sites].sort((a, b) => String(a.subdomain).localeCompare(String(b.subdomain))).filter(s => {
      if (filter === 'apps' && s.kind !== 'app') return false;
      if (filter === 'redirects' && s.kind !== 'redirect') return false;
      if (filter === 'off' && s.enabled) return false;
      if (!q) return true;
      return String(s.subdomain).toLowerCase().includes(q) || String(s.target).toLowerCase().includes(q);
    });
  }, [sites, find, filter]);

  const chip = (id, label) => html`
    <button type="button" class="adm-subs-chip ${filter === id ? 'on' : ''}" onClick=${() => setFilter(id)}>${label}</button>`;

  const row = (s) => {
    // Who mapped it is worth a line only when it is not the owner of the app it serves: on a node
    // where one person publishes everything, that column was the same 45 characters on every row.
    const mappedBy = ownerOf(s.createdBy);
    const foreign = s.kind === 'app' && mappedBy && targetOwnerOf(s.target) !== mappedBy;
    return html`
      <div class="adm-subs-row ${s.enabled ? '' : 'is-off'}" key=${s.subdomain}>
        <a class="adm-subs-name" href=${siteUrl(s.subdomain)} target="_blank" rel="noopener">
          ${s.subdomain}<em>${apex}</em>${s.kind === 'redirect' ? html`<span class="adm-subs-kind">${S('markRedirect')}</span>` : null}
        </a>
        <span class="adm-subs-target">
          ${s.kind === 'app'
    ? html`<i>${targetOwnerOf(s.target)}/</i>${String(s.target).slice(targetOwnerOf(s.target).length + 1)}`
    : s.target}
          ${foreign ? html`<span class="adm-subs-who">${S('mappedBy', { who: mappedBy })}</span>` : null}
        </span>
        <span class="adm-subs-made">${day(s.createdAt)}</span>
        <span class="adm-subs-acts">
          <button type="button" class="adm-subs-state ${s.enabled ? '' : 'is-off'}"
            onClick=${() => toggleEnabled(s)}>${s.enabled ? S('stateOn') : S('stateOff')}</button>
          <button type="button" class="adm-subs-kill"
            onClick=${() => setDeleting({ subdomain: s.subdomain, target: s.target, kind: s.kind, createdAt: s.createdAt, typed: '' })}>${S('delete')}</button>
        </span>
      </div>`;
  };

  return html`
    <div class="og adm-subs">

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${S('listTitle')}<small>01</small></h2>
          <div class="og-doors">
            <button type="button"
              class=${!showCreate && sites.length > 0 ? 'adm-btn' : 'og-door og-door--quiet'}
              onClick=${() => { setShowCreate(!showCreate); setFormError(null); }}>
              ${showCreate ? t('common.cancel') : S('add')}
            </button>
          </div></div>
        <p class="adm-subs-lead">${S('lead')}</p>

        <div class="og-strip">
          <div><b>${num(counts.total)}</b><span>${S('stripAddresses')}</span><small>${S('stripAddressesSub')}</small></div>
          <div><b>${num(counts.apps)}</b><span>${S('stripApps')}</span><small>${S('stripAppsSub')}</small></div>
          <div><b>${num(counts.redirects)}</b><span>${S('stripRedirects')}</span><small>${S('stripRedirectsSub')}</small></div>
          <div><b>${num(counts.off)}</b><span>${S('stripOff')}</span><small>${S('stripOffSub')}</small></div>
        </div>

        ${error && html`<${ErrorBox} message=${error} />`}

        ${loading ? html`<${Spinner} />` : sites.length === 0 ? html`
          <div class="adm-subs-empty">
            <h3>${S('emptyTitle')}</h3>
            <p>${S('emptyBody')} <code>sanomat${apex}</code></p>
            <button class="adm-btn" onClick=${() => setShowCreate(true)}>${S('emptyAdd')}</button>
          </div>
          <p class="adm-subs-note">${S('dnsNote')}</p>
        ` : html`
          <div class="adm-subs-tools">
            <div class="adm-subs-find">
              <${FindIcon} />
              <input type="text" value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
            </div>
            <div class="adm-subs-chips">
              ${chip('all', S('filterAll'))}
              ${chip('apps', S('filterApps'))}
              ${chip('redirects', S('filterRedirects'))}
              ${chip('off', S('filterOff'))}
            </div>
          </div>

          <div class="adm-subs-rows">
            ${shown.map(row)}
          </div>

          <div class="adm-subs-foot">
            <span>${S('shown', { n: num(shown.length), total: num(counts.total) })}</span>
            <span class="adm-subs-sort">${S('sortNote')}</span>
          </div>
        `}
      </section>

      ${showCreate && html`
        <section class="og-sec">
          <div class="og-sec-h"><h2>${S('add')}<small>02</small></h2></div>
          <div class="adm-subs-two">
            <div>
              <div class="adm-subs-field">
                <div class="adm-subs-lbl">${S('fieldAddress')}</div>
                <div class="adm-subs-fld">
                  <input type="text" value=${form.subdomain} placeholder="sanomat"
                    onInput=${e => setForm({ ...form, subdomain: e.target.value })} />
                  <span class="adm-subs-suffix">${apex}</span>
                </div>
                <p class="adm-subs-hint">${S('addressHint')}</p>
              </div>

              <div class="adm-subs-field">
                <div class="adm-subs-lbl">${S('fieldKind')}</div>
                <div class="adm-subs-chips">
                  <button type="button" class="adm-subs-chip ${form.kind === 'app' ? 'on' : ''}"
                    onClick=${() => setForm({ ...form, kind: 'app' })}>${S('kindApp')}</button>
                  <button type="button" class="adm-subs-chip ${form.kind === 'redirect' ? 'on' : ''}"
                    onClick=${() => setForm({ ...form, kind: 'redirect' })}>${S('kindRedirect')}</button>
                </div>
                <p class="adm-subs-hint">${S('kindHint')}</p>
              </div>

              <div class="adm-subs-field">
                <div class="adm-subs-lbl">${S('target')}</div>
                <div class="adm-subs-fld">
                  <input type="text" value=${form.target}
                    placeholder=${form.kind === 'app' ? S('targetHintApp') : S('targetHintRedirect')}
                    onInput=${e => setForm({ ...form, target: e.target.value })} />
                </div>
                <p class="adm-subs-hint">${form.kind === 'app' ? S('targetHintAppLong') : S('targetHintRedirectLong')}</p>
                ${formError && html`<p class="adm-subs-err">${formError}</p>`}
              </div>

              ${form.subdomain.trim() && form.target.trim() ? html`
                <div class="adm-subs-prev">
                  <div class="adm-subs-prev-l">${S('previewLabel')}</div>
                  <span class="adm-subs-prev-u">${form.subdomain.trim().toLowerCase()}${apex}</span>
                  <span class="adm-subs-prev-a">${form.kind === 'app'
    ? S('previewServes', { target: form.target.trim() })
    : S('previewRedirects', { target: form.target.trim() })}</span>
                </div>` : null}

              <div class="adm-subs-act">
                <button class="adm-btn" disabled=${saving || !form.subdomain.trim() || !form.target.trim()}
                  onClick=${create}>${S('mapIt')}</button>
                <button type="button" class="og-door og-door--quiet" onClick=${() => setShowCreate(false)}>${t('common.cancel')}</button>
              </div>
            </div>

            <div>
              <div class="adm-subs-lbl">${S('refusesTitle')}</div>
              <div class="adm-subs-rule">
                <b>${S('refuseReserved')}</b>
                <span class="adm-subs-kept">www · mail · api · admin · static · cdn · portal · app · apps · docs · status · mcp · portfolio · co</span>
              </div>
              <div class="adm-subs-rule"><b>${S('refuseTaken')}</b>${S('refuseTakenWhy')}</div>
              <div class="adm-subs-rule"><b>${S('refuseNoApp')}</b>${S('refuseNoAppWhy')}</div>
              <div class="adm-subs-rule"><b>${S('refuseRestricted')}</b>${S('refuseRestrictedWhy')}</div>
            </div>
          </div>
        </section>
      `}

      <${Modal} open=${!!deleting} onClose=${() => setDeleting(null)} title=${S('deleteTitle')}>
        ${deleting && html`
          <div class="adm-subs-ask">
            <p>${S('deleteLead')}</p>
            ${deleting.kind === 'app' ? html`<p>${S('deleteAppNote')}</p>` : null}
            <span class="adm-subs-ask-what">${deleting.subdomain}${apex}
              <em>${deleting.kind === 'app' ? S('previewServes', { target: deleting.target }) : S('previewRedirects', { target: deleting.target })} · ${dt(deleting.createdAt)}</em>
            </span>
            <div class="adm-subs-lbl">${S('deleteTypeLabel')}</div>
            <div class="adm-subs-fld">
              <input type="text" value=${deleting.typed} placeholder=${deleting.subdomain}
                onInput=${e => setDeleting({ ...deleting, typed: e.target.value })} />
            </div>
            <p class="adm-subs-hint">${S('deleteHint')}</p>
            <div class="adm-subs-act">
              <button class="adm-btn" disabled=${deleting.typed !== deleting.subdomain} onClick=${doDelete}>${S('delete')}</button>
              <button type="button" class="og-door og-door--quiet" onClick=${() => setDeleting(null)}>${t('common.cancel')}</button>
            </div>
          </div>
        `}
      <//>
    </div>
  `;
}
