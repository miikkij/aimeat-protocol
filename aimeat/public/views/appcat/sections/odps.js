/**
 * @file public/views/appcat/sections/odps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The EXCHANGE & ODPS section of the app detail view, for an own published app: whether
 *   the app sells anything on the marketplace ("On the marketplace: 1 of 2 tools", "Not on the
 *   marketplace (2 tools declared)", or no sellable tools yet, and how many flagged tools cannot be
 *   listed), and the app-level ODPS defaults every tool inherits: the data holder (written only with
 *   a legal name), logo, brand slogan, governance profile, portfolio priority, language, licence area
 *   and applicable law, and the owner's provenance attestation. The defaults are saved onto the root
 *   of the same manifest the Monetize section edits (tools-manifest.js). As the old catalogue's
 *   js/odps.js odpsStatusInner, defaultsForm, readOdpsAppDefaults and monetize.js odpsSaveDefaults.
 * @structure meta · OdpsSection({ d }) · DefaultsForm({ d, m })
 * @usage loaded by the detail view: import('./sections/odps.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the market state as a short
 *     state on its ground (Note state size="small"), the flagged-but-blocked count as the chapter's grey
 *     line; the defaults form in the old 2-column grids (a third field under the first), the
 *     provenance in its statement box, its door row and the status line that keeps its room.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's js/odps.js.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud, Actions } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { x } from '/views/appcat/i18n.js';
import { useToolsManifest, patchManifest, manifestNow, writeManifest, blockedReason } from '/views/appcat/sections/tools-manifest.js';
import { optionsOf } from '/views/appcat/sections/odps-tool.js';

const html = htm.bind(h);

export const meta = { id: 'odps', title: 'odps.title', show: (d) => !!d.isOwnPublished };

const GOVERNANCE = ['', 'structured', 'enforced', 'automated', 'audit_ready'];
const PRIORITIES = ['', 'critical', 'high', 'medium', 'low'];

/** The market line: how many of the app's tools are on the market, and how many cannot be. */
function StatusLine({ doc }) {
  const tools = (doc && doc.tools) || [];
  if (!tools.length) return html`<${Note} kind="state" size="small">${x('odps.noTools')}<//>`;
  const flagged = tools.filter((t) => t.exchange);
  const blocked = flagged.filter((t) => !!blockedReason(t));
  const live = flagged.length - blocked.length;
  return html`
    ${live > 0
      ? html`<${Note} kind="state" size="small" tone="fine">${x('odps.statusOn', { live, total: tools.length })}<//>`
      : html`<${Note} kind="state" size="small">${x('odps.statusOff', { total: tools.length })}<//>`}
    ${blocked.length ? html`<${Note} kind="quiet" chapter>${x('odps.statusBlocked', { n: blocked.length })}<//>` : null}`;
}

function formOf(doc) {
  const o = (doc && doc.odps) || {};
  const holder = o.dataHolder || {};
  const lic = o.license || {};
  const p = (doc && doc.provenance) || {};
  return {
    legalName: holder.legalName || '', businessId: holder.businessID || '', email: holder.email || '',
    url: holder.URL || '', country: holder.addressCountry || '', logo: o.logoURL || '', slogan: o.brandSlogan || '',
    governance: o.governanceProfile || '', priority: o.portfolioPriority || '', language: o.language || 'en',
    geo: (lic.geographicalArea || []).join(', '), laws: lic.applicableLaws || '',
    source: p.source || '', legalBasis: p.legalBasis || '', consent: p.consentStatus || '', retention: p.retention || '',
  };
}

/** The form read into { odps, provenance }; an empty part is left out. */
function readDefaults(f) {
  const v = (s) => (s || '').trim();
  const holder = {};
  if (v(f.legalName)) holder.legalName = v(f.legalName);
  if (v(f.businessId)) holder.businessID = v(f.businessId);
  if (v(f.email)) holder.email = v(f.email);
  if (v(f.url)) holder.URL = v(f.url);
  if (v(f.country)) holder.addressCountry = v(f.country);
  const license = {};
  const geo = v(f.geo).split(',').map((s) => s.trim()).filter(Boolean);
  if (geo.length) license.geographicalArea = geo;
  if (v(f.laws)) license.applicableLaws = v(f.laws);
  const odps = {};
  if (holder.legalName) odps.dataHolder = holder; // legalName is ODPS-required inside dataHolder
  if (Object.keys(license).length) odps.license = license;
  if (v(f.logo)) odps.logoURL = v(f.logo);
  if (v(f.slogan)) odps.brandSlogan = v(f.slogan);
  if (v(f.governance)) odps.governanceProfile = v(f.governance);
  if (v(f.priority)) odps.portfolioPriority = v(f.priority);
  if (/^[a-z]{2}$/.test(v(f.language))) odps.language = v(f.language);
  const prov = {};
  if (v(f.source)) prov.source = v(f.source);
  if (v(f.legalBasis)) prov.legalBasis = v(f.legalBasis);
  if (v(f.consent)) prov.consentStatus = v(f.consent);
  if (v(f.retention)) prov.retention = v(f.retention);
  return { odps: Object.keys(odps).length ? odps : undefined, provenance: Object.keys(prov).length ? prov : undefined };
}

/** The app-level ODPS defaults, collapsed until "ODPS defaults for this app" opens them. */
function DefaultsForm({ d, m }) {
  const [f, setF] = useState(() => formOf(m.doc));
  const [status, setStatus] = useState('');
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const field = (key, label, placeholder, type) => html`<${TextField} type=${type} label=${label} value=${f[key]}
    placeholder=${placeholder} onInput=${(val) => set({ [key]: val })} />`;

  const save = async () => {
    const now = manifestNow();
    if (now.busy || !now.doc) return;
    const vals = readDefaults(f);
    const next = { ...now.doc, tools: now.doc.tools.slice() };
    if (vals.odps) next.odps = vals.odps; else delete next.odps;
    if (vals.provenance) next.provenance = vals.provenance; else delete next.provenance;
    patchManifest({ busy: true });
    setStatus('…');
    try {
      await writeManifest(next);
      patchManifest({ doc: next, busy: false });
      setStatus('');
      d.notice(x('odps.defaultsSaved'), 'success');
    } catch (e) {
      patchManifest({ busy: false });
      setStatus(x('monetize.saveFailed') + ': ' + e.message);
      d.notice(x('monetize.saveFailed') + ': ' + e.message, 'error');
    }
  };

  // The old form: 2-column grids, a third field wrapping under the first (the country, the language),
  // the provenance in its own box, then its door row and its status line.
  return html`<${Fields} plain chapter>
    <${Note} kind="quiet" chapter>${x('odps.defaultsHint')}<//>
    <${Fields} plain chapter cols=${2}>
      ${field('legalName', x('odps.legalName'), 'Overscale Solutions Oy')}
      ${field('businessId', x('odps.businessId'), '3312345-6')}
    <//>
    <${Fields} plain chapter cols=${2}>
      ${field('email', x('odps.holderEmail'), 'sales@example.org', 'email')}
      ${field('url', x('odps.holderUrl'), 'https://example.org', 'url')}
      ${field('country', x('odps.country'), 'FI')}
    <//>
    <${Fields} plain chapter cols=${2}>
      ${field('logo', x('odps.logoUrl'), 'https://example.org/logo.png', 'url')}
      ${field('slogan', x('odps.brandSlogan'), '')}
    <//>
    <${Fields} plain chapter cols=${2}>
      <${Select} label=${x('odps.governance')} options=${optionsOf(GOVERNANCE)} value=${f.governance} onChange=${(val) => set({ governance: val })} />
      <${Select} label=${x('odps.priority')} options=${optionsOf(PRIORITIES)} value=${f.priority} onChange=${(val) => set({ priority: val })} />
      ${field('language', x('odps.language'), 'en')}
    <//>
    <${Fields} plain chapter cols=${2}>
      ${field('geo', x('odps.geoArea'), 'EU, EEA')}
      ${field('laws', x('odps.applicableLaws'), 'Finnish law')}
    <//>
    <${Box} tone="statement">
      <${Label} block>${x('odps.attestation')}<//>
      <${Note} kind="quiet" chapter>${x('odps.attestationHint')}<//>
      <${Fields} plain chapter cols=${2}>
        ${field('source', x('odps.source'), 'PRH open company register (YTJ v3)')}
        ${field('legalBasis', x('odps.legalBasis'), 'Public register')}
        ${field('consent', x('odps.consentStatus'), 'not applicable')}
        ${field('retention', x('odps.retention'), '30 days')}
      <//>
    <//>
    <${Actions} chapter>
      <${Loud} control disabled=${m.busy} onClick=${save}>${x('odps.saveDefaults')}<//>
      <${Action} small onClick=${() => patchManifest({ defaultsOpen: false })}>${x('odps.close')}<//>
    <//>
    <${Note} kind="report" chapter keep tone="busy">${status}<//>
  <//>`;
}

export default function OdpsSection({ d }) {
  const m = useToolsManifest(d);
  if (m.state === 'off' || m.ref !== d.ref) return null;
  const lede = html`<${Note} kind="lead" chapter>${x('odps.hint')}<//>`;
  if (m.state === 'loading') return html`${lede}<${Note} kind="quiet" size="small" inline>…<//>`;
  return html`
    ${lede}
    <${StatusLine} doc=${m.doc} />
    <${Actions} chapter>
      <${Action} small expanded=${m.defaultsOpen} onClick=${() => patchManifest({ defaultsOpen: !m.defaultsOpen })}>
        ${m.defaultsOpen ? x('odps.close') : x('odps.editDefaults')}
      <//>
    <//>
    ${m.defaultsOpen ? html`<${DefaultsForm} key=${m.doc && m.doc.updatedAt} d=${d} m=${m} />` : null}`;
}
