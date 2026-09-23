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
 *   v2.3.0 -- 2026-09-22 -- Composed from the shared component set: a section with a numeral band,
 *     the toolbar for the search and the four filters, each mapping a shared list row with its
 *     switch and a danger word, the form from shared fields (the domain as the address field's
 *     suffix), and the delete in the shared dialog; the page's own sheet is gone.
 *   v2.2.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v2.1.0 -- 2026-09-13 -- Compose list and add-form headings from the shared B1 shape.
 *   v2.0.1 — 2026-09-13 — The delete dialog's actions sit in the dialog's footer.
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
import { dt, num, Spinner, ErrorBox } from './shared.js';
import { swallowed } from '/js/swallowed.js';
import { Section, Columns, Stack, Text, Action, Chip, ListRow, NumeralBand, Toolbar, Field, Surface, Dialog } from '/components/poster-parts.js';
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

export default function SubdomainsAdminTab() {
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

  const row = (s) => {
    // Who mapped it is worth a line only when it is not the owner of the app it serves: on a node
    // where one person publishes everything, that column was the same 45 characters on every row.
    const mappedBy = ownerOf(s.createdBy);
    const foreign = s.kind === 'app' && mappedBy && targetOwnerOf(s.target) !== mappedBy;
    return html`<${ListRow} key=${s.subdomain} density="compact" muted=${!s.enabled}
      name=${`${s.subdomain}${apex}`} href=${siteUrl(s.subdomain)} external
      detail=${s.target + (foreign ? ' · ' + S('mappedBy', { who: mappedBy }) : '')}
      value=${html`<${Stack} direction="horizontal" align="center" density="compact">
        ${s.kind === 'redirect' ? html`<${Chip} tone="muted">${S('markRedirect')}<//>` : null}
        <span>${day(s.createdAt)}</span>
      <//>`}
      actions=${html`
        <${Action} kind="tab" semantics="switch" selected=${!!s.enabled}
          onClick=${() => toggleEnabled(s)}>${s.enabled ? S('stateOn') : S('stateOff')}<//>
        <${Action} kind="text" tone="danger"
          onClick=${() => setDeleting({ subdomain: s.subdomain, target: s.target, kind: s.kind, createdAt: s.createdAt, typed: '' })}>${S('delete')}<//>`} />`;
  };

  const rule = (title, why) => html`<${ListRow} density="compact" name=${title} detail=${why} detailKind="text" />`;

  return html`
    <div>

      <${Section} title=${S('listTitle')} count="01" description=${S('lead')}
        actions=${html`<${Action} kind=${!showCreate && sites.length > 0 ? 'primary' : 'secondary'}
          onClick=${() => { setShowCreate(!showCreate); setFormError(null); }}>
          ${showCreate ? t('common.cancel') : S('add')}
        <//>`}>

        <${NumeralBand} tone="plain" size="small" items=${[
    { label: S('stripAddresses'), value: num(counts.total), note: S('stripAddressesSub') },
    { label: S('stripApps'), value: num(counts.apps), note: S('stripAppsSub') },
    { label: S('stripRedirects'), value: num(counts.redirects), note: S('stripRedirectsSub') },
    { label: S('stripOff'), value: num(counts.off), note: S('stripOffSub') },
  ]} />

        ${error && html`<${ErrorBox} message=${error} />`}

        ${loading ? html`<${Spinner} />` : sites.length === 0 ? html`
          <${Stack}>
            <${Text} kind="heading">${S('emptyTitle')}<//>
            <${Text} tone="muted">${S('emptyBody')} <${Text} kind="mono">sanomat${apex}<//><//>
            <${Stack} direction="wrap" align="center">
              <${Action} kind=${showCreate ? 'secondary' : 'primary'} onClick=${() => setShowCreate(true)}>${S('emptyAdd')}<//>
            <//>
            <${Text} kind="caption" tone="muted">${S('dnsNote')}<//>
          <//>
        ` : html`
          <${Toolbar} label=${S('listTitle')}
            search=${{ ariaLabel: S('findPlaceholder'), placeholder: S('findPlaceholder'), value: find, onInput: e => setFind(e.target.value) }}
            filters=${[
    { id: 'all', label: S('filterAll'), selected: filter === 'all', onClick: () => setFilter('all') },
    { id: 'apps', label: S('filterApps'), selected: filter === 'apps', onClick: () => setFilter('apps') },
    { id: 'redirects', label: S('filterRedirects'), selected: filter === 'redirects', onClick: () => setFilter('redirects') },
    { id: 'off', label: S('filterOff'), selected: filter === 'off', onClick: () => setFilter('off') },
  ]} />

          <div>${shown.map(row)}</div>

          <${Stack} direction="wrap" align="between">
            <${Text} kind="caption" tone="muted">${S('shown', { n: num(shown.length), total: num(counts.total) })}<//>
            <${Text} kind="mono" tone="muted">${S('sortNote')}<//>
          <//>
        `}
      <//>

      ${showCreate && html`
        <${Section} title=${S('add')} count="02">
          <${Columns} layout="leading" collapse=${900} density="roomy">
            <${Stack} density="roomy">
              <${Field} label=${S('fieldAddress')} value=${form.subdomain} placeholder="sanomat" hint=${S('addressHint')}
                suffix=${apex} passwordManager=${false} onInput=${e => setForm({ ...form, subdomain: e.target.value })} />

              <${Stack} density="compact">
                <${Text} kind="label">${S('fieldKind')}<//>
                <${Stack} direction="wrap" align="center" density="compact" role="radiogroup" label=${S('fieldKind')}>
                  <${Action} kind="tab" semantics="radio" selected=${form.kind === 'app'}
                    onClick=${() => setForm({ ...form, kind: 'app' })}>${S('kindApp')}<//>
                  <${Action} kind="tab" semantics="radio" selected=${form.kind === 'redirect'}
                    onClick=${() => setForm({ ...form, kind: 'redirect' })}>${S('kindRedirect')}<//>
                <//>
                <${Text} kind="caption" tone="muted">${S('kindHint')}<//>
              <//>

              <${Field} label=${S('target')} value=${form.target} passwordManager=${false}
                placeholder=${form.kind === 'app' ? S('targetHintApp') : S('targetHintRedirect')}
                hint=${form.kind === 'app' ? S('targetHintAppLong') : S('targetHintRedirectLong')}
                error=${formError || undefined}
                onInput=${e => setForm({ ...form, target: e.target.value })} />

              ${form.subdomain.trim() && form.target.trim() ? html`
                <${Surface} kind="box">
                  <${Stack} density="compact">
                    <${Text} kind="label">${S('previewLabel')}<//>
                    <${Text} kind="mono">${form.subdomain.trim().toLowerCase()}${apex}<//>
                    <${Text} kind="mono" tone="muted">${form.kind === 'app'
    ? S('previewServes', { target: form.target.trim() })
    : S('previewRedirects', { target: form.target.trim() })}<//>
                  <//>
                <//>` : null}

              <${Stack} direction="wrap" align="center">
                <${Action} kind="primary" disabled=${saving || !form.subdomain.trim() || !form.target.trim()}
                  onClick=${create}>${S('mapIt')}<//>
                <${Action} onClick=${() => setShowCreate(false)}>${t('common.cancel')}<//>
              <//>
            <//>

            <div>
              <${Text} kind="label">${S('refusesTitle')}<//>
              <${ListRow} density="compact" name=${S('refuseReserved')}
                detail="www · mail · api · admin · static · cdn · portal · app · apps · docs · status · mcp · portfolio · co" />
              ${rule(S('refuseTaken'), S('refuseTakenWhy'))}
              ${rule(S('refuseNoApp'), S('refuseNoAppWhy'))}
              ${rule(S('refuseRestricted'), S('refuseRestrictedWhy'))}
            </div>
          <//>
        <//>
      `}

      <${Dialog} open=${!!deleting} onClose=${() => setDeleting(null)} title=${S('deleteTitle')}
        actions=${deleting && html`
          <${Action} onClick=${() => setDeleting(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" tone="danger" disabled=${deleting.typed !== deleting.subdomain} onClick=${doDelete}>${S('delete')}<//>`}>
        ${deleting && html`
          <${Stack}>
            <${Text}>${S('deleteLead')}<//>
            ${deleting.kind === 'app' ? html`<${Text}>${S('deleteAppNote')}<//>` : null}
            <${Surface} kind="box" density="compact">
              <${Stack} density="compact">
                <${Text} kind="mono">${deleting.subdomain}${apex}<//>
                <${Text} kind="mono" tone="muted">${deleting.kind === 'app' ? S('previewServes', { target: deleting.target }) : S('previewRedirects', { target: deleting.target })} · ${dt(deleting.createdAt)}<//>
              <//>
            <//>
            <${Field} label=${S('deleteTypeLabel')} value=${deleting.typed} placeholder=${deleting.subdomain}
              hint=${S('deleteHint')} passwordManager=${false}
              onInput=${e => setDeleting({ ...deleting, typed: e.target.value })} />
          <//>
        `}
      <//>
    </div>
  `;
}
