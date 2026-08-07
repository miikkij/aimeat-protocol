/**
 * @file companies-tab.js
 * @description Profile tab: the company registry. Register a company (which claims
 *   {slug}.co.<apex> the same way publishing an app claims an apps subdomain), edit its
 *   legal identity — the one every later invoice prefills its seller from — and choose
 *   what the address serves: one of your own published apps, a redirect, or nothing yet.
 *   Live: re-fetches on the aimeat-live-update event when the companies domain ticks.
 * @version-history
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { listApps } from '/js/services/apps.js';

/** Trade name → address label. Mirrors the server's slugify so the preview does not lie. */
function slugify(name) {
  return String(name || '').toLowerCase()
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

const IDENTITY_FIELDS = [
  ['business_id', 'businessId'], ['vat_id', 'vatId'],
  ['street_address', 'streetAddress'], ['postal_code', 'postalCode'],
  ['city', 'city'], ['country', 'country'],
  ['email', 'email'], ['phone', 'phone'],
  ['iban', 'iban'], ['bic', 'bic'],
  ['einvoice_address', 'einvoiceAddress'], ['einvoice_operator', 'einvoiceOperator'],
];

function CreateForm({ onCreated, showToast }) {
  const [name, setName] = useState('');
  const [availability, setAvailability] = useState(null);
  const [busy, setBusy] = useState(false);
  const slug = slugify(name);

  useEffect(() => {
    if (slug.length < 2) { setAvailability(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet(`/v1/companies/available?slug=${encodeURIComponent(slug)}`);
        if (!cancelled) setAvailability(res?.data ?? null);
        // eslint-disable-next-line aimeat/no-silent-catch -- the check is advisory (the create call arbitrates); an unreachable check just shows no badge rather than a scary error while typing
      } catch { if (!cancelled) setAvailability(null); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [slug]);

  const create = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiPost('/v1/companies', { name: name.trim() });
      setName('');
      onCreated(res?.data?.company);
    } catch (e) {
      showToast?.(e?.message || String(e), 'error');
    }
    setBusy(false);
  }, [name, onCreated, showToast]);

  return html`
    <div class="card pf-co-create">
      <h3 class="section-title">${t('profile.companies.newTitle')}</h3>
      <p class="section-desc">${t('profile.companies.newDesc')}</p>
      <div class="pf-co-row">
        <label class="pf-co-field">
          <span>${t('profile.companies.name')}</span>
          <input value=${name} onInput=${(e) => setName(e.target.value)}
                 placeholder=${t('profile.companies.namePlaceholder')} />
        </label>
        <button class="btn-primary" disabled=${busy || slug.length < 2 || availability?.available === false}
                onClick=${create}>
          ${busy ? t('profile.companies.creating') : t('profile.companies.create')}
        </button>
      </div>
      ${slug.length >= 2 && html`
        <p class="pf-co-preview">
          ${t('profile.companies.addressPreview')}: <code>${availability?.address || slug}</code>
          ${availability && html`<span class="pf-co-badge ${availability.available ? 'free' : 'taken'}">
            ${availability.available ? t('profile.companies.free') : t(`profile.companies.reason.${availability.reason}`)}
          </span>`}
        </p>
      `}
    </div>
  `;
}

function CompanyCard({ company, apps, onChanged, showToast }) {
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState(() => {
    const init = {};
    for (const [wire, rec] of IDENTITY_FIELDS) init[wire] = company[rec] ?? '';
    return init;
  });
  const [front, setFront] = useState(company.frontPage);
  const savedFront = company.frontPage;
  useEffect(() => { setFront(savedFront); }, [savedFront]);
  const [busy, setBusy] = useState(false);

  const saveIdentity = useCallback(async () => {
    setBusy(true);
    try {
      const body = { name: company.name };
      for (const [wire] of IDENTITY_FIELDS) body[wire] = identity[wire] === '' ? null : identity[wire];
      await apiPut(`/v1/companies/${company.id}`, body);
      showToast?.(t('profile.companies.saved'), 'success');
      onChanged();
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company, identity, onChanged, showToast]);

  const saveFront = useCallback(async (next) => {
    setBusy(true);
    try {
      await apiPut(`/v1/companies/${company.id}/front-page`, { kind: next.kind, target: next.target });
      setFront(next);
      showToast?.(t('profile.companies.frontSaved'), 'success');
      onChanged();
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company, onChanged, showToast]);

  const remove = useCallback(async () => {
    // Deleting a company frees its public address, so the confirm is the point, not friction.
    if (!confirm(t('profile.companies.confirmDelete').replace('{name}', company.name))) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/companies/${company.id}`);
      showToast?.(t('profile.companies.deleted'), 'success');
      onChanged();
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company, onChanged, showToast]);

  // The header reports the SAVED record, never the editor's pending selection: a failed save
  // must not leave the card claiming the address serves something it does not.
  const serving = savedFront.kind === 'app'
    ? t('profile.companies.servingApp').replace('{app}', savedFront.target)
    : savedFront.kind === 'redirect'
      ? t('profile.companies.servingRedirect').replace('{url}', savedFront.target)
      : t('profile.companies.servingNone');

  return html`
    <div class="card pf-co-card">
      <div class="pf-co-head" onClick=${() => setOpen(!open)}>
        <div>
          <b>${company.name}</b>
          <div class="pf-co-address">
            ${company.address
              ? html`<a href=${company.address} target="_blank" rel="noopener">${company.address}</a>`
              : html`<span class="pf-co-muted">${company.slug}</span>`}
            ${company.co_origin_enabled === false && html`<span class="pf-co-badge taken">${t('profile.companies.originOff')}</span>`}
          </div>
        </div>
        <span class="pf-co-serving">${serving}</span>
      </div>

      ${open && html`
        <div class="pf-co-body">
          <h4>${t('profile.companies.frontTitle')}</h4>
          <p class="pf-co-hint">${t('profile.companies.frontHint')}</p>
          <div class="pf-co-row">
            <select value=${front.kind} onChange=${(e) => setFront({ kind: e.target.value, target: '' })}>
              <option value="none">${t('profile.companies.frontNone')}</option>
              <option value="app">${t('profile.companies.frontApp')}</option>
              <option value="redirect">${t('profile.companies.frontRedirect')}</option>
            </select>
            ${front.kind === 'app' && html`
              <select value=${front.target} onChange=${(e) => setFront({ kind: 'app', target: e.target.value })}>
                <option value="">${t('profile.companies.pickApp')}</option>
                ${apps.map((a) => html`<option key=${a.filename} value=${`${a.owner}/${a.filename}`}>${a.name || a.filename}</option>`)}
              </select>
            `}
            ${front.kind === 'redirect' && html`
              <input value=${front.target} placeholder="https://..."
                     onInput=${(e) => setFront({ kind: 'redirect', target: e.target.value })} />
            `}
            <button class="btn-outline" disabled=${busy} onClick=${() => saveFront(front)}>
              ${t('profile.companies.setFront')}
            </button>
          </div>

          <h4>${t('profile.companies.identityTitle')}</h4>
          <p class="pf-co-hint">${t('profile.companies.identityHint')}</p>
          ${/* Functional update: several fields can change before one re-render (autofill, a
               password manager, an agent driving the form), and the spread-from-render form
               made each write clobber the previous — only the last field survived. */ ''}
          <div class="pf-co-grid">
            ${IDENTITY_FIELDS.map(([wire]) => html`
              <label class="pf-co-field" key=${wire}>
                <span>${t(`profile.companies.field.${wire}`)}</span>
                <input value=${identity[wire]}
                       onInput=${(e) => { const v = e.target.value; setIdentity((prev) => ({ ...prev, [wire]: v })); }} />
              </label>
            `)}
          </div>
          <div class="pf-co-row">
            <button class="btn-primary" disabled=${busy} onClick=${saveIdentity}>${t('profile.companies.save')}</button>
            <button class="btn-danger" disabled=${busy} onClick=${remove}>${t('profile.companies.delete')}</button>
          </div>
        </div>
      `}
    </div>
  `;
}

export function CompaniesTab({ showToast, session }) {
  const [companies, setCompanies] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiGet('/v1/companies');
      setCompanies(res?.data?.companies ?? []);
    } catch (e) {
      setError(e?.message || String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Only YOUR apps: the server refuses a front page that is not yours, so offering
    // someone else's here would promise something the save cannot deliver.
    const owner = session?.owner;
    listApps().then(
      (list) => setApps((Array.isArray(list) ? list : []).filter((a) => !owner || a.owner === owner)),
      () => setApps([]));
  }, [load, session]);

  useEffect(() => {
    const handler = (e) => {
      const domains = e.detail?.domains;
      if (!domains || domains.has('companies')) load();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  return html`
    <div class="pf-co">
      <h2 class="section-title">${t('profile.companies.title')}</h2>
      <p class="section-desc">${t('profile.companies.desc')}</p>

      <${CreateForm} showToast=${showToast} onCreated=${() => load()} />

      ${loading && html`<${Spinner} />`}
      ${error && html`<p class="pf-co-error">${error}</p>`}
      ${!loading && companies.length === 0 && html`<p class="pf-co-hint">${t('profile.companies.empty')}</p>`}
      ${companies.map((c) => html`
        <${CompanyCard} key=${c.id} company=${c} apps=${apps} showToast=${showToast} onChanged=${load} />
      `)}
    </div>
  `;
}
