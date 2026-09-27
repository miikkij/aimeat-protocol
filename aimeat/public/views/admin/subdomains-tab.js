/**
 * @file subdomains-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Subdomains page in the poster face (design canvas "AIMEAT Admin
 *   Subdomains"): the numeral strip, the search and the four filters that make a hundred and fifty
 *   addresses findable, one row per mapping with its state chip and a quiet delete, the add form
 *   with what the door refuses, and the empty state. The writes go through the same routes as
 *   before. The page draws library components only and writes no class (admin page group G3).
 *
 * @structure
 *   - SubdomainsAdminTab (default): load, filter, and the three sections
 *   - ownerOf / targetOwnerOf: who mapped it against whose app it is
 *   - AddForm: the address, what it serves, the target, and the preview of what is being made
 *   - Refusals: the four things the route answers no to, in its own words
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 -- 2026-09-27 -- Library components only: Section, FigureStrip, SearchLine and the filter
 *     Tabs, the mappings as a List (the state Mark is the switch, the delete a danger Action), the
 *     form in TextField, Choice, Box and FormActions, the refusals as Readings, the dialog's footer as
 *     Action and Loud; admin-subdomains.css goes.
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
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { dt, num, Spinner, ErrorBox } from './shared.js';
import { swallowed } from '/js/swallowed.js';
import { Modal } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { FormActions } from '/components/Field.js';
import { EmptyState } from '/components/EmptyState.js';
import { Readings } from '/components/Readings.js';
import { List, Row as ListRow, Name, Who, When, Doors, SearchLine } from '/components/List.js';
import { Row, Stack, Beside } from '/components/Layout.js';
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

/** The names the route keeps for itself, in the order it lists them, in the typewriter face. */
const KEPT = html`<${Code}>www · mail · api · admin · static · cdn · portal · app · apps · docs · status · mcp · portfolio · co<//>`;

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
    return html`
      <${ListRow} key=${s.subdomain} faded=${!s.enabled} hover>
        <${Name} code href=${siteUrl(s.subdomain)} newTab
          tag=${s.kind === 'redirect' ? S('markRedirect') : null}>${s.subdomain}<${Tinted} tone="dim">${apex}<//><//>
        <${Who} sub=${foreign ? S('mappedBy', { who: mappedBy }) : null} warn>
          <${Code}>${s.kind === 'app'
    ? html`<${Tinted} tone="dim">${targetOwnerOf(s.target)}/<//>${String(s.target).slice(targetOwnerOf(s.target).length + 1)}`
    : s.target}<//>
        <//>
        <${When}>${day(s.createdAt)}<//>
        <${Doors}>
          <${Mark} tone=${s.enabled ? 'sun' : 'dim'} onClick=${() => toggleEnabled(s)}>${s.enabled ? S('stateOn') : S('stateOff')}<//>
          <${Action} small row tone="danger"
            onClick=${() => setDeleting({ subdomain: s.subdomain, target: s.target, kind: s.kind, createdAt: s.createdAt, typed: '' })}>${S('delete')}<//>
        <//>
      <//>`;
  };

  const toggleCreate = () => { setShowCreate(!showCreate); setFormError(null); };

  return html`
    <${Fragment}>
      <${Section} first num="01" title=${S('listTitle')}
        doors=${!showCreate && sites.length > 0
    ? html`<${Loud} control onClick=${toggleCreate}>${S('add')}<//>`
    : html`<${Action} small soft onClick=${toggleCreate}>${showCreate ? t('common.cancel') : S('add')}<//>`}>
        <${Note} kind="lead">${S('lead')}<//>

        <${FigureStrip} wrap items=${[
    { key: 'total', n: num(counts.total), label: S('stripAddresses'), sub: S('stripAddressesSub') },
    { key: 'apps', n: num(counts.apps), label: S('stripApps'), sub: S('stripAppsSub') },
    { key: 'redirects', n: num(counts.redirects), label: S('stripRedirects'), sub: S('stripRedirectsSub') },
    { key: 'off', n: num(counts.off), label: S('stripOff'), sub: S('stripOffSub') },
  ]} />

        ${error && html`<${ErrorBox} message=${error} />`}

        ${loading ? html`<${Spinner} />` : sites.length === 0 ? html`
          <${EmptyState} title=${S('emptyTitle')}
            action=${html`<${Loud} control onClick=${() => setShowCreate(true)}>${S('emptyAdd')}<//>`}>
            <${Note}>${S('emptyBody')} <${Code}>sanomat${apex}<//><//>
          <//>
          <${Note}>${S('dnsNote')}<//>
        ` : html`
          <${Row} wrap justify="between" align="end">
            <${SearchLine} beside find text value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
            <${Tabs} tone="filter" value=${filter} onSelect=${setFilter} items=${[
    { value: 'all', label: S('filterAll') },
    { value: 'apps', label: S('filterApps') },
    { value: 'redirects', label: S('filterRedirects') },
    { value: 'off', label: S('filterOff') },
  ]} />
          <//>

          <${List} cols="name-who-when-doors">
            ${shown.map(row)}
          <//>

          <${Row} wrap justify="between" align="baseline" above="medium">
            <${Note} kind="meta" inline>${S('shown', { n: num(shown.length), total: num(counts.total) })}<//>
            <${Note} kind="meta" inline mono>${S('sortNote')}<//>
          <//>
        `}
      <//>

      ${showCreate && html`
        <${Section} num="02" title=${S('add')}>
          <${Beside} wide side=${html`
            <${Stack} gap="none">
              <${Label} block>${S('refusesTitle')}<//>
              <${Readings} rows=${[
    { key: 'reserved', name: S('refuseReserved'), why: KEPT },
    { key: 'taken', name: S('refuseTaken'), why: S('refuseTakenWhy') },
    { key: 'noapp', name: S('refuseNoApp'), why: S('refuseNoAppWhy') },
    { key: 'restricted', name: S('refuseRestricted'), why: S('refuseRestrictedWhy'), last: true },
  ]} />
            <//>`}>
            <${Stack} gap="large">
              <${TextField} code label=${S('fieldAddress')} hint=${S('addressHint')} value=${form.subdomain} placeholder="sanomat"
                onInput=${(v) => setForm({ ...form, subdomain: v })}
                actions=${html`<${Note} kind="meta" inline mono>${apex}<//>`} />

              <${Choice} tone="filter" label=${S('fieldKind')} hint=${S('kindHint')} value=${form.kind}
                onChange=${(v) => setForm({ ...form, kind: v })}
                options=${[['app', S('kindApp')], ['redirect', S('kindRedirect')]]} />

              <${TextField} code label=${S('target')} value=${form.target}
                placeholder=${form.kind === 'app' ? S('targetHintApp') : S('targetHintRedirect')}
                hint=${form.kind === 'app' ? S('targetHintAppLong') : S('targetHintRedirectLong')}
                message=${formError ? { text: formError, error: true } : undefined}
                onInput=${(v) => setForm({ ...form, target: v })} />

              ${form.subdomain.trim() && form.target.trim() ? html`
                <${Box} tone="dim">
                  <${Label} block>${S('previewLabel')}<//>
                  <${Code}>${form.subdomain.trim().toLowerCase()}${apex}<//>
                  <${Note} kind="meta" mono>${form.kind === 'app'
    ? S('previewServes', { target: form.target.trim() })
    : S('previewRedirects', { target: form.target.trim() })}<//>
                <//>` : null}

              <${FormActions}>
                <${Loud} control disabled=${saving || !form.subdomain.trim() || !form.target.trim()}
                  onClick=${create}>${S('mapIt')}<//>
                <${Action} small soft onClick=${() => setShowCreate(false)}>${t('common.cancel')}<//>
              <//>
            <//>
          <//>
        <//>
      `}

      <${Modal} open=${!!deleting} onClose=${() => setDeleting(null)} title=${S('deleteTitle')}
        footer=${deleting && html`
          <${Action} onClick=${() => setDeleting(null)}>${t('common.cancel')}<//>
          <${Loud} control danger disabled=${deleting.typed !== deleting.subdomain} onClick=${doDelete}>${S('delete')}<//>`}>
        ${deleting && html`
          <${Stack} gap="medium">
            <${Note} kind="lead">${S('deleteLead')}<//>
            ${deleting.kind === 'app' ? html`<${Note} kind="lead">${S('deleteAppNote')}<//>` : null}
            <${Box} tone="dim">
              <${Code}>${deleting.subdomain}${apex}<//>
              <${Note} kind="meta" mono>${deleting.kind === 'app' ? S('previewServes', { target: deleting.target }) : S('previewRedirects', { target: deleting.target })} · ${dt(deleting.createdAt)}<//>
            <//>
            <${TextField} code label=${S('deleteTypeLabel')} hint=${S('deleteHint')} value=${deleting.typed} placeholder=${deleting.subdomain}
              onInput=${(v) => setDeleting({ ...deleting, typed: v })} />
          <//>
        `}
      <//>
    <//>
  `;
}
