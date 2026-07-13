/**
 * @file my-company.js
 * @description "Yritykseni" (My Company) view — the Enterprise surface. An owner creates a company
 *   and lists their agents' EXISTING offerings for sale (picked, not typed; specs from
 *   agents.{name}.offers). Anyone can order a listed offering like profile>offers, fulfilled by the
 *   seller's agent: callable offerings invoke the seller's capability and return the result inline;
 *   task-runner offerings queue a task on the seller's agent. Every order is tracked: the buyer sees
 *   "My orders" (status + result), the company owner sees "Orders received". Calls the proprietary
 *   ee/ module's /v1/orgs + /v1/orders API; a Community node returns ENTERPRISE_REQUIRED.
 * @structure MyCompanyView · OfferPicker (list your offerings to sell) · OfferingCard (specs + order)
 *   · OrdersList (orders received / my orders, with live status) · statusChip helper.
 * @usage routed at /v1/my-company; header tab "Yritykseni".
 * @version-history
 *   v0.1.0 — 2026-06-23 — initial (hand-typed)
 *   v0.2.0 — 2026-06-23 — pick existing offerings; order → result/inbox
 *   v0.2.1 — 2026-06-23 — order tracking (my orders + orders received) with live status
 *   v0.3.0 — 2026-06-23 — members & roles + customers + revenue-split receipt
 *   v0.4.0 — 2026-06-23 — company Settings tab (admin): name, Y-tunnus, description, commission %
 *   v0.5.0 — 2026-06-24 — Secretary Phase 6 (slice 3): company Secretary admin subtab — enable +
 *     read-only locked brain + company-admin capabilities + enterprise scopes (GET/POST /v1/orgs/:slug/secretary).
 *   v0.6.0 — 2026-06-24 — Secretary Phase 6 (slice 2): Governance admin subtab — CFO cost & ROI surface
 *     (revenue / orders / cost-per-task / commission income + per-agent table) from GET /v1/orgs/:slug/governance.
 *   v0.7.0 — 2026-06-24 — Secretary Phase 6 (slice 1): Company model admin subtab — prompt-driven builder
 *     (describe → generate in-app / copy-prompt → review → apply) for departments/roles/people/reporting (GET/PUT /v1/orgs/:slug/model).
 *   v0.8.0 — 2026-07-01 — Company Secretary subtab hidden unless the node enables the Secretary feature
 *     (AIMEAT_SECRETARY_ENABLED, read from /v1/site/header-nav `features.secretary`). Governance + model unaffected.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '/js/api.js';
import { setOfferBilling } from '/js/services/offers.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { OfferCardView } from '/components/offer-card-view.js';
import { THEMES, buildPortfolioData } from '/views/portfolio-themes.js';

const html = htm.bind(h);

function statusChip(o) {
  const s = o.kind === 'result' ? 'instant' : (o.status || 'queued');
  const map = { queued: ['stQueued', 'queued'], active: ['stActive', 'active'], done: ['stDone', 'done'], failed: ['stFailed', 'failed'], instant: ['stInstant', 'done'] };
  const [key, cls] = map[s] || ['stQueued', 'queued'];
  return html`<span class="mc-status mc-status--${cls}">${t('myCompany.' + key)}</span>`;
}

/** One order row, in either the owner ("Orders received") or buyer ("My orders") list. */
function OrderRow({ o, view }) {
  return html`
    <li class="mc-order">
      <div class="mc-order-head">
        <span class="mc-order-title">${o.offerTitle}</span>
        ${statusChip(o)}
      </div>
      <div class="mc-order-meta">
        ${view === 'owner'
          ? html`<span>${t('myCompany.orderedBy')}: ${o.buyerOwner}</span>`
          : html`<span>${t('myCompany.fromCompany')}: ${o.orgSlug}</span>`}
        <span>🤖 ${o.agentName}</span>
        <span class="mc-mini">${new Date(o.createdAt).toLocaleString()}</span>
      </div>
      ${o.input && html`<div class="mc-order-input">${t('myCompany.orderedWhat')}: “${o.input}”</div>`}
      ${o.charged > 0 && html`<div class="mc-order-receipt">🧾 ${t('myCompany.receiptLabel')}: ${t('myCompany.charged').replace('{n}', o.charged)}${o.trackingCode ? html` · <span class="mc-mini">${o.trackingCode}</span>` : ''}</div>`}
      ${o.kind === 'result' && o.result != null && html`
        <div class="mc-result"><div class="mc-result-label">${t('myCompany.result')}</div><${DeliverableBody} value=${o.result} alt=${o.offerTitle} /></div>`}
    </li>`;
}

function OrdersList({ orders, view, empty }) {
  if (!orders || orders.length === 0) return html`<p class="mc-empty">${empty}</p>`;
  return html`<ul class="mc-order-list">${orders.map(o => html`<${OrderRow} key=${o.id} o=${o} view=${view} />`)}</ul>`;
}

/** Customers: who used the company's agents, which agents, how many times, total spend. */
function CustomersPanel({ slug }) {
  const [customers, setCustomers] = useState(null);
  useEffect(() => {
    apiGet(`/v1/orgs/${encodeURIComponent(slug)}/customers`).then(r => setCustomers(r.data?.customers ?? [])).catch(() => setCustomers([]));
  }, [slug]);
  if (customers === null) return html`<div class="mc-center"><div class="spinner"></div></div>`;
  if (!customers.length) return html`<p class="mc-empty">${t('myCompany.noCustomers')}</p>`;
  return html`
    <ul class="mc-cust-list">
      ${customers.map(c => html`
        <li class="mc-cust" key=${c.buyerOwner || c.buyerGhii}>
          <div class="mc-cust-head">
            <span class="mc-cust-name">${c.buyerOwner || c.buyerGhii}</span>
            <span class="mc-cust-spend">${c.totalCharged} ${t('myCompany.morsels')}</span>
          </div>
          <div class="mc-cust-meta">${t('myCompany.orderCount')}: ${c.orderCount} · ${t('myCompany.lastOrder')}: ${new Date(c.lastOrderAt).toLocaleDateString()}</div>
          <div class="mc-off-meta">${Object.entries(c.agents).map(([a, n]) => html`<span class="mc-chip" key=${a}>🤖 ${a} ×${n}</span>`)}</div>
        </li>`)}
    </ul>`;
}

/** Members & roles: list members, invite by username, set role, remove (admins manage). */
function MembersPanel({ slug, creatorOwner, viewerRole }) {
  const canManage = viewerRole === 'admin';
  const [members, setMembers] = useState(null);
  const [owner, setOwner] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { const r = await apiGet(`/v1/orgs/${encodeURIComponent(slug)}/members`); setMembers(r.data?.members ?? []); } catch { setMembers([]); } }, [slug]);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await apiPost(`/v1/orgs/${encodeURIComponent(slug)}/members`, { owner: owner.trim().toLowerCase(), role }); setOwner(''); await load(); }
    catch (e) { setErr(e.message || 'Failed'); } finally { setBusy(false); }
  }
  async function changeRole(m, r) { try { await apiPatch(`/v1/orgs/${encodeURIComponent(slug)}/members/${encodeURIComponent(m.owner)}`, { role: r }); await load(); } catch (e) { setErr(e.message || ''); } }
  async function remove(m) { try { await apiDelete(`/v1/orgs/${encodeURIComponent(slug)}/members/${encodeURIComponent(m.owner)}`); await load(); } catch (e) { setErr(e.message || ''); } }
  const roleOpts = html`
    <option value="admin">${t('myCompany.roleAdmin')}</option>
    <option value="member">${t('myCompany.roleMember')}</option>
    <option value="visitor">${t('myCompany.roleVisitor')}</option>`;
  if (members === null) return html`<div class="mc-center"><div class="spinner"></div></div>`;
  return html`
    <ul class="mc-member-list">
      ${members.map(m => {
        const isCreator = m.owner === creatorOwner;
        return html`
          <li class="mc-member" key=${m.owner}>
            <span class="mc-member-name">${m.owner}${isCreator ? html` <span class="mc-mini">(${t('myCompany.creator')})</span>` : ''}</span>
            <div class="flex-row-wrap">
              <select class="input-field input-sm" value=${m.role} disabled=${isCreator || !canManage} onChange=${(e) => changeRole(m, e.target.value)}>${roleOpts}</select>
              ${canManage && !isCreator && html`<button class="btn-ghost btn-sm mc-remove" onClick=${() => remove(m)}>${t('myCompany.removeMember')}</button>`}
            </div>
          </li>`;
      })}
    </ul>
    ${err && html`<p class="mc-error">${err}</p>`}
    ${canManage && html`
      <form class="mc-form" onSubmit=${add}>
        <h3 class="mc-form-title">${t('myCompany.addMember')}</h3>
        <div class="flex-row-wrap mc-manage-row">
          <input class="input-field input-sm" placeholder=${t('myCompany.memberUsername')} value=${owner} onInput=${(e) => setOwner(e.target.value)} required />
          <select class="input-field input-sm" value=${role} onChange=${(e) => setRole(e.target.value)}>${roleOpts}</select>
          <button class="btn-primary btn-sm" type="submit" disabled=${busy}>${t('myCompany.addMemberBtn')}</button>
        </div>
      </form>`}`;
}

/** Company settings (admin only): logo, name, Y-tunnus, description, commission, directory visibility. */
function SettingsPanel({ org, onSaved }) {
  const [name, setName] = useState(org.name || '');
  const [businessId, setBusinessId] = useState(org.businessId || '');
  const [description, setDescription] = useState(org.description || '');
  const [commission, setCommission] = useState(org.commissionPercent ?? 20);
  const [logo, setLogo] = useState(org.logo || '');
  const [listed, setListed] = useState(org.listed !== false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  // Upload the logo to public storage (under the admin's GAII), then store its public URL on the
  // company. Reuses the generic /v1/storage endpoint — the backend stays protocol-only.
  async function uploadLogo(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setErr(t('myCompany.logoTooBig')); return; }
    setUploading(true); setErr(''); setOk(false);
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
      const key = `org-${org.slug}-logo-${Date.now()}.${ext}`;
      await apiPost('/v1/storage', { key, visibility: 'public', mime_type: file.type || 'image/png', data: b64 });
      const ghii = window.AIMEAT?.auth?.getSession?.()?.ghii;
      setLogo(`/v1/pub/${encodeURIComponent(ghii)}/${encodeURIComponent(key)}`);
    } catch (e) { setErr(e.message || 'Upload failed'); }
    finally { setUploading(false); }
  }

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk(false);
    try {
      const r = await apiPatch(`/v1/orgs/${encodeURIComponent(org.slug)}`, {
        name: name.trim(), businessId: businessId.trim(), description: description.trim(),
        commissionPercent: Number(commission), logo: logo || null, listed,
      });
      setOk(true);
      if (onSaved) await onSaved(r.data?.org);
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setBusy(false); }
  }
  return html`
    <form class="mc-form mc-settings" onSubmit=${save}>
      <div class="mc-label">${t('myCompany.logo')}
        <div class="mc-logo-row">
          ${logo
            ? html`<img class="mc-logo-preview" src=${logo} alt=${t('myCompany.logo')} />`
            : html`<div class="mc-logo-empty">${t('myCompany.noLogo')}</div>`}
          <div class="flex-row-wrap">
            <label class="btn-outline btn-sm mc-upload-btn">
              ${uploading ? t('myCompany.uploading') : t('myCompany.uploadLogo')}
              <input type="file" accept="image/*" class="mc-file-hidden" disabled=${uploading} onChange=${(e) => uploadLogo(e.target.files?.[0])} />
            </label>
            ${logo && html`<button type="button" class="btn-ghost btn-sm" onClick=${() => { setLogo(''); setOk(false); }}>${t('myCompany.removeLogo')}</button>`}
          </div>
        </div>
      </div>
      <label class="mc-label">${t('myCompany.name')}
        <input class="mc-input" value=${name} onInput=${(e) => { setName(e.target.value); setOk(false); }} required /></label>
      <label class="mc-label">${t('myCompany.businessId')}
        <input class="mc-input" value=${businessId} placeholder="1234567-8" onInput=${(e) => { setBusinessId(e.target.value); setOk(false); }} /></label>
      <span class="mc-mini">${t('myCompany.businessIdHint')}</span>
      <label class="mc-label">${t('myCompany.description')}
        <textarea class="mc-input" rows="3" value=${description} onInput=${(e) => { setDescription(e.target.value); setOk(false); }}></textarea></label>
      <label class="mc-label">${t('myCompany.commission')}
        <input class="mc-input mc-price-input" type="number" min="0" max="100" value=${commission} onInput=${(e) => { setCommission(e.target.value); setOk(false); }} /></label>
      <span class="mc-mini">${t('myCompany.commissionHint')}</span>
      <label class="mc-checkbox-row">
        <input type="checkbox" checked=${listed} onChange=${(e) => { setListed(e.target.checked); setOk(false); }} />
        <span>${t('myCompany.listedLabel')}</span>
      </label>
      <span class="mc-mini">${t('myCompany.listedHint')}</span>
      ${err && html`<p class="mc-error">${err}</p>`}
      ${ok && html`<p class="mc-saved">${t('myCompany.settingsSaved')}</p>`}
      <button class="btn-primary" type="submit" disabled=${busy || uploading}>${t('myCompany.saveSettings')}</button>
    </form>`;
}

/** Compose the prompt the user takes to their AI to generate the portfolio HTML (prompt-driven). */
function buildPortfolioPrompt(org, offerings, c) {
  const origin = (typeof window !== 'undefined' && window.location.origin) || '';
  const lines = [];
  lines.push(`Build a single self-contained HTML file: a professional, responsive public portfolio / landing page for the company "${org.name}" on the AIMEAT platform.`);
  lines.push('Requirements: ONE .html file, all CSS inline in a <style> tag, no external JS/CSS/font dependencies (system fonts only), mobile-friendly, accessible, tasteful.');
  if (c.includeInfo) {
    lines.push('', 'Company information to feature:', `- Name: ${org.name}`);
    if (org.businessId) lines.push(`- Business ID (Y-tunnus): ${org.businessId}`);
    if (org.description) lines.push(`- About: ${org.description}`);
  }
  if (c.useLogo && org.logo) lines.push(`- Logo image (use it in the header): ${origin}${org.logo}`);
  if (c.includeOfferings && offerings.length) {
    lines.push('', 'Services for sale (present them attractively as cards, include each price):');
    for (const o of offerings) {
      const price = o.offer?.price?.morsels ? `${o.offer.price.morsels} morsels` : 'contact for pricing';
      lines.push(`- ${o.offer?.title} — ${price} (fulfilled by agent ${o.agentName})${o.offer?.ask ? `: ${o.offer.ask}` : ''}`);
    }
  }
  lines.push('', `Desired look & feel: ${(c.lookDescription || '').trim() || 'clean, modern, trustworthy, professional'}`);
  lines.push('', 'Output ONLY the HTML, starting with <!DOCTYPE html>. No explanations, no markdown fences.');
  return lines.join('\n');
}

/** Company portfolio builder (admin) — prompt-driven, mirrors the profile portfolio with company focus. */
function PortfolioPanel({ org, offerings }) {
  const [cfg, setCfg] = useState(undefined); // undefined=loading, null=none, object
  const [includeOfferings, setIncludeOfferings] = useState(true);
  const [includeInfo, setIncludeInfo] = useState(true);
  const [useLogo, setUseLogo] = useState(!!org.logo);
  const [look, setLook] = useState('');
  const [themeId, setThemeId] = useState('minimal');
  const [prompt, setPrompt] = useState('');
  const [htmlIn, setHtmlIn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/portfolio/config`).then(r => {
      const c = r.data?.config; setCfg(c || null);
      if (c) { setIncludeOfferings(c.includeOfferings !== false); setIncludeInfo(c.includeInfo !== false); setUseLogo(c.useLogo !== false && !!org.logo); setLook(c.lookDescription || ''); if (c.themeId) setThemeId(c.themeId); }
    }).catch(() => setCfg(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Load portfolio config when the company changes; org.logo is only read to seed the initial useLogo default and must not re-trigger a config refetch that would clobber in-progress edits.
  }, [org.slug]);

  const choices = () => ({ includeOfferings, includeInfo, useLogo, lookDescription: look });
  function renderTheme() {
    const theme = THEMES.find(x => x.id === themeId) || THEMES[0];
    return theme.render(buildPortfolioData(org, offerings, choices()));
  }
  function previewTheme() {
    const url = URL.createObjectURL(new Blob([renderTheme()], { type: 'text/html' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function publishTheme() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await apiPut(`/v1/orgs/${encodeURIComponent(org.slug)}/portfolio/publish`, { html: renderTheme() });
      apiPut(`/v1/orgs/${encodeURIComponent(org.slug)}/portfolio/config`, { ...choices(), themeId }).catch(() => {});
      setCfg(r.data?.portfolio); setMsg(t('myCompany.pfPublished'));
    } catch (e) { setErr(e.message || 'Publish failed'); }
    finally { setBusy(false); }
  }

  function generate() {
    setPrompt(buildPortfolioPrompt(org, offerings, { includeOfferings, includeInfo, useLogo, lookDescription: look }));
    apiPut(`/v1/orgs/${encodeURIComponent(org.slug)}/portfolio/config`, { includeOfferings, includeInfo, useLogo, lookDescription: look }).catch(() => {});
  }
  async function copyPrompt() { try { await navigator.clipboard.writeText(prompt); setMsg(t('myCompany.pfCopied')); } catch { /* clipboard blocked */ } }
  async function publish() {
    if (!htmlIn.trim()) { setErr(t('myCompany.pfNeedHtml')); return; }
    setBusy(true); setErr(''); setMsg('');
    try { const r = await apiPut(`/v1/orgs/${encodeURIComponent(org.slug)}/portfolio/publish`, { html: htmlIn }); setCfg(r.data?.portfolio); setMsg(t('myCompany.pfPublished')); setHtmlIn(''); }
    catch (e) { setErr(e.message || 'Publish failed'); }
    finally { setBusy(false); }
  }
  async function unpublish() {
    setBusy(true); setErr('');
    try { const r = await apiDelete(`/v1/orgs/${encodeURIComponent(org.slug)}/portfolio`); setCfg(r.data?.portfolio); }
    catch (e) { setErr(e.message || ''); }
    finally { setBusy(false); }
  }

  if (cfg === undefined) return html`<div class="mc-center"><div class="spinner"></div></div>`;
  const published = cfg?.enabled && cfg?.publicUrl;

  return html`
    <div class="mc-portfolio">
      <p class="section-desc">${t('myCompany.pfIntro')}</p>
      ${published && html`
        <div class="mc-pf-live">
          <span class="mc-saved">${t('myCompany.pfLive')}</span>
          <div class="flex-row-wrap">
            <a class="btn-outline btn-sm" href=${cfg.publicUrl} target="_blank">${t('myCompany.pfVisit')}</a>
            <button class="btn-ghost btn-sm mc-remove" disabled=${busy} onClick=${unpublish}>${t('myCompany.pfUnpublish')}</button>
          </div>
          ${cfg.publishedAt && html`<span class="mc-mini">${t('myCompany.pfLastPublished')}: ${new Date(cfg.publishedAt).toLocaleString()}${cfg.htmlSizeKb ? ` · ${cfg.htmlSizeKb} KB` : ''}</span>`}
        </div>`}

      <h3 class="mc-form-title">${t('myCompany.pfStep1')}</h3>
      <label class="mc-checkbox-row"><input type="checkbox" checked=${includeInfo} onChange=${e => setIncludeInfo(e.target.checked)} /><span>${t('myCompany.pfIncludeInfo')}</span></label>
      <label class="mc-checkbox-row"><input type="checkbox" checked=${includeOfferings} onChange=${e => setIncludeOfferings(e.target.checked)} /><span>${t('myCompany.pfIncludeOfferings')} (${offerings.length})</span></label>
      <label class="mc-checkbox-row"><input type="checkbox" checked=${useLogo} disabled=${!org.logo} onChange=${e => setUseLogo(e.target.checked)} /><span>${t('myCompany.pfUseLogo')}${!org.logo ? ` — ${t('myCompany.pfNoLogo')}` : ''}</span></label>

      <h3 class="mc-form-title">${t('myCompany.pfThemeHeading')}</h3>
      <p class="mc-mini">${t('myCompany.pfThemeHint')}</p>
      <div class="mc-theme-row">
        ${THEMES.map(th => html`<button type="button" key=${th.id} class="mc-theme-btn ${themeId === th.id ? 'active' : ''}" onClick=${() => setThemeId(th.id)}>${th.name}</button>`)}
      </div>
      <div class="flex-row-wrap">
        <button type="button" class="btn-outline btn-sm" onClick=${previewTheme}>${t('myCompany.pfPreview')}</button>
        <button type="button" class="btn-primary btn-sm" disabled=${busy} onClick=${publishTheme}>${t('myCompany.pfPublishTheme')}</button>
      </div>

      <h3 class="mc-form-title">${t('myCompany.pfOrAi')}</h3>
      <label class="mc-label">${t('myCompany.pfLook')}
        <textarea class="mc-input" rows="3" value=${look} placeholder=${t('myCompany.pfLookPlaceholder')} onInput=${e => setLook(e.target.value)}></textarea></label>
      <button type="button" class="btn-outline btn-sm" onClick=${generate}>${t('myCompany.pfGenerate')}</button>

      ${prompt && html`
        <h3 class="mc-form-title">${t('myCompany.pfStep2')}</h3>
        <p class="mc-mini">${t('myCompany.pfStep2Hint')}</p>
        <textarea class="mc-input mc-pf-prompt" rows="8" readonly>${prompt}</textarea>
        <button class="btn-outline btn-sm" onClick=${copyPrompt}>${t('myCompany.pfCopyPrompt')}</button>

        <h3 class="mc-form-title">${t('myCompany.pfStep3')}</h3>
        <textarea class="mc-input mc-pf-html" rows="6" value=${htmlIn} placeholder="<!DOCTYPE html>…" onInput=${e => setHtmlIn(e.target.value)}></textarea>
        <div><button class="btn-primary btn-sm" disabled=${busy} onClick=${publish}>${t('myCompany.pfPublish')}</button></div>`}

      ${err && html`<p class="mc-error">${err}</p>`}
      ${msg && html`<p class="mc-saved">${msg}</p>`}
    </div>`;
}

/** A catalog entry: the SAME offer card format as profile>offers + owner controls + an order box. */
function OfferingCard({ o, orgOwner, slug, onOrdered, onChanged, callerOwner, role }) {
  const offer = o.offer;
  const isOwn = (o.agentOwner ?? orgOwner) === callerOwner; // I own the underlying agent/offering
  const isAdmin = role === 'admin';
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  // Controls — own offering: edit price/visibility; admin/own: remove from catalog.
  const [editMode, setEditMode] = useState(false);
  const [price, setPrice] = useState(offer.price?.morsels ?? 0);
  const [vis, setVis] = useState(offer.visibility ?? 'private');
  const [saving, setSaving] = useState(false);

  const visLabel = (v) => t('myCompany.vis' + (v || 'private').charAt(0).toUpperCase() + (v || 'private').slice(1));
  const ownerOf = (ghii) => String(ghii || '').split('@')[0];

  async function order() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await apiPost(`/v1/orgs/${encodeURIComponent(orgOwner)}/${encodeURIComponent(slug)}/use`,
        { agentName: o.agentName, offerId: o.offerId, input: input.trim() || undefined });
      setResult(res.data); setInput('');
      if (onOrdered) await onOrdered();
    } catch (e) { setErr(e.message || 'Order failed'); }
    finally { setBusy(false); }
  }

  async function saveBilling() {
    setSaving(true); setErr('');
    try {
      const p = Number(price) > 0 ? { morsels: Math.floor(Number(price)), unit: 'per-call' } : null;
      await setOfferBilling(o.agentName, o.offerId, { price: p, visibility: vis });
      // record who last edited the company's listing (surfaced as "last saved by")
      await apiPatch(`/v1/orgs/${encodeURIComponent(slug)}/offerings`, { agentName: o.agentName, offerId: o.offerId }).catch(() => {});
      setEditMode(false);
      if (onChanged) await onChanged();
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function removeFromCatalog() {
    setSaving(true); setErr('');
    try {
      await apiDelete(`/v1/orgs/${encodeURIComponent(slug)}/offerings`, { agentName: o.agentName, offerId: o.offerId });
      if (onChanged) await onChanged();
    } catch (e) { setErr(e.message || 'Remove failed'); setSaving(false); }
  }

  const manage = editMode
    ? html`
      <div class="mc-manage">
        <span class="of-label">${t('myCompany.manage')}</span>
        <div class="flex-row-wrap mc-manage-row">
          <select class="input-field input-sm" value=${vis} onChange=${(e) => setVis(e.target.value)}>
            <option value="private">${t('myCompany.visPrivate')}</option>
            <option value="unlisted">${t('myCompany.visUnlisted')}</option>
            <option value="public">${t('myCompany.visPublic')}</option>
          </select>
          <input class="input-field input-sm mc-price-input" type="number" min="0" value=${price} onInput=${(e) => setPrice(e.target.value)} />
          <span class="mc-mini">${t('myCompany.morsels')}</span>
          <button class="btn-primary btn-sm" disabled=${saving} onClick=${saveBilling}>${t('myCompany.savePrice')}</button>
          <button class="btn-ghost btn-sm" disabled=${saving} onClick=${() => { setEditMode(false); setPrice(offer.price?.morsels ?? 0); setVis(offer.visibility ?? 'private'); }}>${t('myCompany.cancel')}</button>
        </div>
        ${vis === 'private' && html`<div class="mc-mini mc-warn">${t('myCompany.privateHint')}</div>`}
      </div>`
    : html`
      <div class="mc-manage">
        <div class="mc-manage-head">
          <span class="of-label">${t('myCompany.manage')}</span>
          <div class="flex-row-wrap">
            ${isOwn && html`<button class="btn-outline btn-sm" onClick=${() => setEditMode(true)}>${t('myCompany.edit')}</button>`}
            ${(isAdmin || isOwn) && html`<button class="btn-ghost btn-sm mc-remove" disabled=${saving} onClick=${removeFromCatalog}>${t('myCompany.removeFromCatalog')}</button>`}
          </div>
        </div>
        <div class="mc-config">
          ${!isOwn && html`<span class="mc-mini">${t('myCompany.byMember')}: <b>${o.agentOwner}</b></span>`}
          <span><b>${t('myCompany.visibilityLabel')}:</b> ${visLabel(offer.visibility)}</span>
          <span><b>${t('myCompany.priceLabel')}:</b> ${offer.price?.morsels ? `${offer.price.morsels} ${t('myCompany.morsels')}` : t('myCompany.notForSale')}</span>
          ${o.lastEditedBy
            ? html`<span class="mc-mini">${t('myCompany.lastSavedBy')}: <b>${ownerOf(o.lastEditedBy)}</b>${o.lastEditedAt ? ` · ${new Date(o.lastEditedAt).toLocaleString()}` : ''}</span>`
            : html`<span class="mc-mini">${t('myCompany.neverEdited')}</span>`}
        </div>
      </div>`;

  const actions = html`
    ${manage}
    <div class="mc-not-callable">${o.callable ? t('myCompany.callable') : t('myCompany.viaInbox')}</div>
    <textarea class="input-field input-sm of-input" rows="2" value=${input}
      placeholder=${t('myCompany.usePlaceholder')} onInput=${(e) => setInput(e.target.value)}></textarea>
    <div class="flex-row-wrap">
      <button class="btn-primary btn-sm" disabled=${busy} onClick=${order}>${t('myCompany.use')}</button>
    </div>
    ${err && html`<p class="mc-error">${err}</p>`}
    ${result && html`
      <div class="mc-result">
        ${result.kind === 'result'
          ? html`<div class="mc-result-msg">${t('myCompany.orderPlacedResult')}</div><div class="mc-result-label">${t('myCompany.result')}</div><${DeliverableBody} value=${result.result} alt=${offer.title} format=${offer.deliverable?.format} />`
          : html`<div class="mc-result-msg">${t('myCompany.orderPlacedTask').replace('{agent}', o.agentName)}</div>`}
        ${result.receipt?.charged > 0 && html`<div class="mc-receipt">${t('myCompany.charged').replace('{n}', result.receipt.charged)} → ${t('myCompany.byMember')} +${result.receipt.memberCut ?? 0} · ${t('myCompany.wallet')} +${result.receipt.orgCut ?? result.receipt.toOrgWallet ?? 0}</div>`}
      </div>`}
  `;

  return html`<li class="mc-cat-item"><${OfferCardView} entry=${{ agent: o.agentName, online: o.online }} offer=${offer} actions=${actions} /></li>`;
}

function OfferPicker({ slug, alreadyListed, onListed }) {
  const [agents, setAgents] = useState(null); // [{ name, offers: [] }]
  const [busy, setBusy] = useState('');
  useEffect(() => {
    Promise.all([apiGet('/v1/offers').catch(() => ({})), apiGet('/v1/agents').catch(() => ({}))]).then(([offR, agR]) => {
      const offersByAgent = {};
      for (const a of (offR.data?.agents ?? [])) offersByAgent[a.agent] = a.offers ?? [];
      const names = (agR.data?.agents ?? agR.data ?? []).map(a => a.name || String(a.gaii || '').split('#')[0]).filter(Boolean);
      for (const k of Object.keys(offersByAgent)) if (!names.includes(k)) names.push(k);
      setAgents(names.map(name => ({ name, offers: offersByAgent[name] ?? [] })));
    });
  }, []);
  async function list(agentName, offerId) {
    setBusy(agentName + '/' + offerId);
    try { await apiPost(`/v1/orgs/${encodeURIComponent(slug)}/offerings`, { agentName, offerId }); await onListed(); }
    catch (e) { alert(e.message || 'Failed'); }
    finally { setBusy(''); }
  }
  if (agents === null) return html`<div class="mc-center"><div class="spinner"></div></div>`;
  if (agents.length === 0) return html`<p class="mc-empty">${t('myCompany.noOffersToList')}</p>`;
  return html`
    <div class="mc-pick-agents">
      ${agents.map(ag => html`
        <div class="mc-pick-agent" key=${ag.name}>
          <div class="mc-pick-agent-name">🤖 ${ag.name}</div>
          ${ag.offers.length === 0
            ? html`<div class="mc-mini mc-pick-none">${t('myCompany.agentNoOfferings')}</div>`
            : html`<ul class="mc-pick-list">
                ${ag.offers.map(offer => {
                  const key = ag.name + '/' + offer.id;
                  const listed = alreadyListed.has(key);
                  return html`
                    <li class="mc-pick-item" key=${key}>
                      <div>
                        <div class="mc-off-title">${offer.title}</div>
                        <div class="mc-off-meta">${offer.price?.morsels ? html`<span class="mc-chip">${offer.price.morsels} ${t('myCompany.morsels')}</span>` : null}${offer.deliverable?.format ? html`<span class="mc-chip">📦 ${offer.deliverable.format}</span>` : null}<span class="mc-chip">${offer.visibility || 'private'}</span></div>
                      </div>
                      ${listed ? html`<span class="mc-listed">${t('myCompany.listed')}</span>`
                        : html`<button class="btn-outline btn-sm" disabled=${busy === key} onClick=${() => list(ag.name, offer.id)}>${t('myCompany.putUpForSale')}</button>`}
                    </li>`;
                })}
              </ul>`}
        </div>`)}
    </div>`;
}

export default function MyCompanyView() {
  useViewCSS('/css/views/my-company.css');
  const callerOwner = (typeof window !== 'undefined' && window.AIMEAT?.auth?.getSession?.()?.owner) || '';

  const [state, setState] = useState('loading');
  const [orgs, setOrgs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [offerings, setOfferings] = useState([]);
  const [ordersReceived, setOrdersReceived] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [subTab, setSubTab] = useState('catalog');
  const [myOrders, setMyOrders] = useState(null);
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [newBusinessId, setNewBusinessId] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadOrgs() {
    setState('loading');
    try { const res = await apiGet('/v1/orgs'); setOrgs(res.data?.orgs ?? []); setState('ready'); }
    catch (e) {
      if (e.code === 'ENTERPRISE_REQUIRED') setState('enterprise');
      else if (e.status === 401) setState('unauth');
      else { setErrMsg(e.message || 'Failed to load'); setState('error'); }
    }
  }
  useEffect(() => { loadOrgs(); }, []);

  async function loadOrders(org) {
    try { const r = await apiGet(`/v1/orgs/${encodeURIComponent(org.slug)}/orders`); setOrdersReceived(r.data?.orders ?? []); }
    catch { setOrdersReceived([]); }
  }
  async function openOrg(org) {
    setSelected(org); setOfferings([]); setOrdersReceived([]); setShowPicker(false); setSubTab('catalog');
    try {
      const res = await apiGet(`/v1/orgs/${encodeURIComponent(org.creatorOwner)}/${encodeURIComponent(org.slug)}/offerings`);
      setOfferings(res.data?.offerings ?? []);
    } catch (e) { setErrMsg(e.message || ''); }
    loadOrders(org);
  }
  async function afterOrder() {
    if (selected) { await loadOrders(selected); await loadOrgs(); }
    if (showMyOrders) await loadMyOrders();
  }
  async function loadMyOrders() {
    try { const r = await apiGet('/v1/orders'); setMyOrders(r.data?.orders ?? []); }
    catch { setMyOrders([]); }
  }
  function toggleMyOrders() {
    const next = !showMyOrders; setShowMyOrders(next);
    if (next) loadMyOrders();
  }

  async function createOrg(e) {
    e.preventDefault(); setErrMsg(''); setBusy(true);
    try {
      const res = await apiPost('/v1/orgs', { slug: newSlug.trim().toLowerCase(), name: newName.trim(), businessId: newBusinessId.trim() || undefined });
      setNewSlug(''); setNewName(''); setNewBusinessId(''); await loadOrgs();
      if (res.data?.org) await openOrg(res.data.org);
    } catch (e) { setErrMsg(e.message || 'Create failed'); }
    finally { setBusy(false); }
  }

  if (state === 'loading') return html`<div class="mc-container"><div class="mc-center"><div class="spinner"></div></div></div>`;
  if (state === 'enterprise') return html`<div class="mc-container"><div class="mc-card mc-stub"><h1 class="mc-title">${t('myCompany.title')}</h1><p class="mc-stub-badge">${t('myCompany.enterpriseBadge')}</p><p class="mc-desc">${t('myCompany.enterpriseRequired')}</p></div></div>`;
  if (state === 'unauth') return html`<div class="mc-container"><div class="mc-card"><h1 class="mc-title">${t('myCompany.title')}</h1><p class="mc-desc">${t('myCompany.loginRequired')}</p></div></div>`;
  if (state === 'error') return html`<div class="mc-container"><div class="mc-card"><h1 class="mc-title">${t('myCompany.title')}</h1><p class="mc-error">${errMsg}</p></div></div>`;

  const listedKeys = new Set(offerings.map(o => o.agentName + '/' + o.offerId));

  return html`
    <div class="mc-container">
      <header class="mc-header">
        <div class="mc-header-row">
          <h1 class="mc-title">${t('myCompany.title')}</h1>
          <button class="btn-outline btn-sm" onClick=${toggleMyOrders}>${showMyOrders ? t('myCompany.done') : t('myCompany.myOrders')}</button>
        </div>
        <p class="mc-desc">${t('myCompany.desc')}</p>
      </header>
      ${errMsg && html`<p class="mc-error">${errMsg}</p>`}

      ${showMyOrders && html`
        <div class="mc-card">
          <h2 class="mc-col-title">${t('myCompany.myOrders')}</h2>
          ${myOrders === null ? html`<div class="mc-center"><div class="spinner"></div></div>`
            : html`<${OrdersList} orders=${myOrders} view="buyer" empty=${t('myCompany.noMyOrders')} />`}
        </div>`}

      <div class="mc-grid">
        <aside class="mc-col">
          <h2 class="mc-col-title">${t('myCompany.yourCompanies')}</h2>
          ${orgs.length === 0 && html`<p class="mc-empty">${t('myCompany.noCompanies')}</p>`}
          <ul class="mc-org-list">
            ${orgs.map(org => html`<li key=${org.slug}>
              <button class="mc-org-item ${selected?.slug === org.slug ? 'active' : ''}" onClick=${() => openOrg(org)}>
                <span class="mc-org-name">${org.name}</span>
                <span class="mc-org-meta">${org.goii} · ${(org.wallet?.balance ?? 0)} ${t('myCompany.morsels')}</span>
              </button></li>`)}
          </ul>
          <form class="mc-form" onSubmit=${createOrg}>
            <h3 class="mc-form-title">${t('myCompany.createCompany')}</h3>
            <label class="mc-label">${t('myCompany.slug')}
              <input class="mc-input" value=${newSlug} placeholder="overscale" onInput=${(e) => setNewSlug(e.target.value)} required /></label>
            <label class="mc-label">${t('myCompany.name')}
              <input class="mc-input" value=${newName} placeholder="Overscale Solutions Oy" onInput=${(e) => setNewName(e.target.value)} required /></label>
            <label class="mc-label">${t('myCompany.businessIdOptional')}
              <input class="mc-input" value=${newBusinessId} placeholder="1234567-8" onInput=${(e) => setNewBusinessId(e.target.value)} /></label>
            <button class="btn-primary" type="submit" disabled=${busy}>${t('myCompany.create')}</button>
          </form>
        </aside>

        <section class="mc-col">
          ${!selected && html`<p class="mc-empty">${t('myCompany.selectHint')}</p>`}
          ${selected && html`
            <div class="mc-detail-head">
              <div class="mc-head-id">
                ${selected.logo && html`<img class="mc-head-logo" src=${selected.logo} alt=${selected.name} />`}
                <div>
                  <h2 class="mc-col-title">${selected.name}${selected.listed === false ? html` <span class="mc-mini mc-warn">· ${t('myCompany.unlistedBadge')}</span>` : ''}</h2>
                  ${selected.businessId
                    ? html`<span class="mc-mini">${t('myCompany.businessId')}: ${selected.businessId}</span>`
                    : (selected.role === 'admin' ? html`<span class="mc-mini mc-warn">${t('myCompany.noBusinessId')}</span>` : null)}
                </div>
              </div>
              <span class="mc-wallet">${t('myCompany.wallet')}: <strong>${selected.wallet?.balance ?? 0}</strong> ${t('myCompany.morsels')}</span>
            </div>

            <div class="mc-subtabs">
              ${['catalog', ...(selected.role === 'admin' ? ['orders', 'customers', 'portfolio', 'settings'] : []), 'members'].map(id => html`
                <button class="mc-subtab ${subTab === id ? 'active' : ''}" key=${id} onClick=${() => setSubTab(id)}>${t('myCompany.tab' + id.charAt(0).toUpperCase() + id.slice(1))}</button>`)}
              <span class="mc-role-chip">${t('myCompany.role' + (selected.role || 'member').charAt(0).toUpperCase() + (selected.role || 'member').slice(1))}</span>
            </div>

            ${subTab === 'catalog' && html`
              <div class="mc-section-head">
                <h3 class="mc-form-title">${t('myCompany.offerings')}</h3>
                <button class="btn-outline btn-sm" onClick=${() => setShowPicker(s => !s)}>${showPicker ? t('myCompany.done') : t('myCompany.addFromOffers')}</button>
              </div>
              ${showPicker && html`<div class="mc-picker"><p class="mc-pick-hint">${t('myCompany.pickHint')}</p><${OfferPicker} slug=${selected.slug} alreadyListed=${listedKeys} onListed=${() => openOrg(selected)} /></div>`}
              ${offerings.length === 0 && !showPicker && html`<p class="mc-empty">${t('myCompany.noOfferings')}</p>`}
              <ul class="mc-off-list">
                ${offerings.map(o => html`<${OfferingCard} key=${o.agentName + '/' + o.offerId} o=${o} orgOwner=${selected.creatorOwner} slug=${selected.slug} callerOwner=${callerOwner} role=${selected.role} onOrdered=${afterOrder} onChanged=${() => openOrg(selected)} />`)}
              </ul>`}

            ${subTab === 'orders' && html`<${OrdersList} orders=${ordersReceived} view="owner" empty=${t('myCompany.noOrdersReceived')} />`}
            ${subTab === 'customers' && html`<${CustomersPanel} slug=${selected.slug} />`}
            ${subTab === 'portfolio' && html`<${PortfolioPanel} org=${selected} offerings=${offerings} />`}
            ${subTab === 'settings' && html`<${SettingsPanel} org=${selected} onSaved=${(updated) => {
              // Update in place (no loadOrgs → no loading flash that would remount the panel and drop the "saved ✓").
              if (!updated) return;
              setSelected(s => ({ ...s, ...updated }));
              setOrgs(list => list.map(o => (o.slug === updated.slug && o.creatorOwner === updated.creatorOwner) ? { ...o, ...updated } : o));
            }} />`}
            ${subTab === 'members' && html`<${MembersPanel} slug=${selected.slug} creatorOwner=${selected.creatorOwner} viewerRole=${selected.role} />`}
          `}
        </section>
      </div>
    </div>`;
}
