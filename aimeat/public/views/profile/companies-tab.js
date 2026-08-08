/**
 * @file companies-tab.js
 * @description Profile tab: the company registry. Register a company (which claims
 *   {slug}.co.<apex> the same way publishing an app claims an apps subdomain), edit its
 *   legal identity — the one every later invoice prefills its seller from — and choose
 *   what the address serves: one of your own published apps, a redirect, or nothing yet.
 *   Live: re-fetches on the aimeat-live-update event when the companies domain ticks.
 * @version-history
 *   v1.2.0 — 2026-08-08 — Front page extracted to companies-front-page.js (adds the
 *     portfolio kind); the identity section gained its AI hand-off prompt.
 *   v1.1.0 — 2026-08-07 — SmtpSection: the company's own sending identity (write-only password).
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
import { CopyButton } from '/components/CopyButton.js';
import { FrontPageSection } from './companies-front-page.js';
import { buildSettingsPrompt } from './companies-prompts.js';

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

/**
 * A company's own sending identity. The password is write-only by design: the server never
 * returns it, so the field starts empty and an empty field on save means "keep the stored one".
 * The badge tells the user whether one is stored, which is the only thing they need to know.
 */
function SmtpSection({ company, showToast }) {
  const [smtp, setSmtp] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ host: '', port: '587', secure: false, username: '', password: '', from_address: '', from_name: '', reply_to: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet(`/v1/companies/${company.id}/smtp`);
      const row = res?.data?.smtp ?? null;
      setSmtp(row);
      if (row) {
        setForm({
          host: row.host ?? '', port: String(row.port ?? 587), secure: !!row.secure,
          username: row.username ?? '', password: '',
          from_address: row.fromAddress ?? '', from_name: row.fromName ?? '', reply_to: row.replyTo ?? '',
        });
      }
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setLoaded(true);
  }, [company.id, showToast]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const body = {
        host: form.host.trim(), port: parseInt(form.port, 10) || 587, secure: !!form.secure,
        username: form.username.trim() || null,
        from_address: form.from_address.trim(),
        from_name: form.from_name.trim() || null,
        reply_to: form.reply_to.trim() || null,
      };
      if (form.password) body.password = form.password;
      const res = await apiPut(`/v1/companies/${company.id}/smtp`, body);
      setSmtp(res?.data?.smtp ?? null);
      setForm((prev) => ({ ...prev, password: '' }));
      showToast?.(t('profile.companies.smtpSaved'), 'success');
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company.id, form, showToast]);

  const remove = useCallback(async () => {
    if (!confirm(t('profile.companies.smtpConfirmRemove'))) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/companies/${company.id}/smtp`);
      setSmtp(null);
      setForm({ host: '', port: '587', secure: false, username: '', password: '', from_address: '', from_name: '', reply_to: '' });
      showToast?.(t('profile.companies.smtpRemoved'), 'success');
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company.id, showToast]);

  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm((prev) => ({ ...prev, [k]: v })); };

  if (!loaded) return html`<p class="pf-co-hint">${t('common.loading')}</p>`;

  return html`
    <h4>${t('profile.companies.smtpTitle')}</h4>
    <p class="pf-co-hint">${t('profile.companies.smtpHint')}</p>
    <p class="pf-co-hint">
      ${smtp
        ? html`<span class="pf-co-badge free">${t('profile.companies.smtpActive').replace('{host}', smtp.host)}</span>`
        : html`<span class="pf-co-badge">${t('profile.companies.smtpInactive')}</span>`}
    </p>
    <div class="pf-co-grid">
      <label class="pf-co-field"><span>${t('profile.companies.smtp.host')}</span>
        <input value=${form.host} placeholder="smtp.example.com" onInput=${set('host')} /></label>
      <label class="pf-co-field"><span>${t('profile.companies.smtp.port')}</span>
        <input value=${form.port} inputmode="numeric" onInput=${set('port')} /></label>
      <label class="pf-co-field"><span>${t('profile.companies.smtp.username')}</span>
        <input value=${form.username} autocomplete="off" onInput=${set('username')} /></label>
      <label class="pf-co-field"><span>${t('profile.companies.smtp.password')}</span>
        <input type="password" value=${form.password} autocomplete="new-password"
               placeholder=${smtp?.passwordSet ? t('profile.companies.smtp.passwordKept') : ''}
               onInput=${set('password')} /></label>
      <label class="pf-co-field"><span>${t('profile.companies.smtp.fromAddress')}</span>
        <input value=${form.from_address} placeholder="laskutus@yritys.fi" onInput=${set('from_address')} /></label>
      <label class="pf-co-field"><span>${t('profile.companies.smtp.fromName')}</span>
        <input value=${form.from_name} onInput=${set('from_name')} /></label>
      <label class="pf-co-field"><span>${t('profile.companies.smtp.replyTo')}</span>
        <input value=${form.reply_to} onInput=${set('reply_to')} /></label>
      <label class="pf-co-field pf-co-check"><span>${t('profile.companies.smtp.secure')}</span>
        <input type="checkbox" checked=${form.secure} onChange=${set('secure')} /></label>
    </div>
    <div class="pf-co-row">
      <button class="btn-primary" disabled=${busy} onClick=${save}>${t('profile.companies.smtpSave')}</button>
      ${smtp && html`<button class="btn-outline" disabled=${busy} onClick=${remove}>${t('profile.companies.smtpRemove')}</button>`}
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
  const savedFront = company.frontPage;
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
      : savedFront.kind === 'portfolio'
        ? t('profile.companies.servingPortfolio')
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
          <${FrontPageSection} company=${company} apps=${apps} busy=${busy} setBusy=${setBusy}
            onSaved=${onChanged} showToast=${showToast} />

          <h4>${t('profile.companies.identityTitle')}</h4>
          <p class="pf-co-hint">${t('profile.companies.identityHint')}</p>
          ${/* The third AI hand-off: a chat with the AIMEAT connector asks for these values one
               batch at a time and writes them itself, which beats typing twelve fields — and it
               is told never to invent one, because these land on real invoices. */ ''}
          <div class="pf-co-row">
            <${CopyButton} text=${buildSettingsPrompt(company)} className="btn-outline"
              label=${t('profile.companies.promptSettings')}
              copiedLabel=${t('profile.companies.promptCopied')} />
          </div>
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
          </div>

          <${SmtpSection} company=${company} showToast=${showToast} />

          <div class="pf-co-row pf-co-danger-row">
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
