/**
 * @file companies-front-page.js
 * @description The "what does this address serve" section of a company card: the kind selector,
 *   the app picker, the redirect field, and — for kind 'portfolio' — the editor that publishes
 *   a standalone HTML page straight to the company's address.
 *
 *   It also carries two of the tab's three AI hand-offs. A founder who does not want to write
 *   HTML copies the portfolio prompt into a chat with the AIMEAT connector, and the chat
 *   publishes the page itself; the app prompt does the same for a published app. The button
 *   sits next to the thing it builds, so the choice and the help are the same decision.
 *
 * @structure FrontPageSection({ company, apps, busy, onSaved, showToast })
 * @usage html`<${FrontPageSection} company=${c} apps=${apps} onSaved=${reload} />`
 * @version-history
 *   v1.0.0 — 2026-08-08 — Extracted from companies-tab.js; adds the portfolio kind + AI prompts.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { CopyButton } from '/components/CopyButton.js';
import { buildPortfolioPrompt, buildAppPrompt } from './companies-prompts.js';

/** The published page, as the settings row reports it. */
function PortfolioEditor({ company, busy, setBusy, onSaved, showToast }) {
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet(`/v1/companies/${company.id}/portfolio`);
      setStatus(res?.data?.portfolio ?? null);
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setLoaded(true);
  }, [company.id, showToast]);

  useEffect(() => { load(); }, [load]);

  const publish = useCallback(async () => {
    const doc = draft.trim();
    if (!doc) return;
    setBusy(true);
    try {
      const res = await apiPut(`/v1/companies/${company.id}/portfolio`, { html: doc });
      setStatus(res?.data?.portfolio ?? null);
      setDraft('');
      showToast?.(t('profile.companies.portfolioPublished'), 'success');
      onSaved();
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company.id, draft, onSaved, setBusy, showToast]);

  const remove = useCallback(async () => {
    if (!confirm(t('profile.companies.portfolioConfirmRemove'))) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/companies/${company.id}/portfolio`);
      setStatus({ published: false, sizeBytes: 0, updatedAt: null });
      showToast?.(t('profile.companies.portfolioRemoved'), 'success');
      onSaved();
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company.id, onSaved, setBusy, showToast]);

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDraft(await file.text());
    e.target.value = '';
  }, []);

  if (!loaded) return null;

  return html`
    <div class="pf-co-portfolio">
      <p class="pf-co-hint">
        ${status?.published
          ? html`<span class="pf-co-badge free">${t('profile.companies.portfolioLive')
              .replace('{kb}', Math.max(1, Math.round((status.sizeBytes || 0) / 1024)))}</span>`
          : html`<span class="pf-co-badge">${t('profile.companies.portfolioNone')}</span>`}
      </p>
      <p class="pf-co-hint">${t('profile.companies.portfolioHint')}</p>

      <div class="pf-co-row">
        <${CopyButton} text=${buildPortfolioPrompt(company)} className="btn-outline"
          label=${t('profile.companies.promptPortfolio')}
          copiedLabel=${t('profile.companies.promptCopied')} />
        <label class="btn-ghost pf-co-file">
          ${t('profile.companies.portfolioPickFile')}
          <input type="file" accept="text/html,.html,.htm" onChange=${onFile} />
        </label>
      </div>

      <label class="pf-co-field">
        <span>${t('profile.companies.portfolioHtml')}</span>
        <textarea class="pf-co-html" rows="8" spellcheck="false" value=${draft}
                  placeholder=${'<!doctype html>…'}
                  onInput=${(e) => setDraft(e.target.value)}></textarea>
      </label>
      <div class="pf-co-row">
        <button class="btn-primary" disabled=${busy || !draft.trim()} onClick=${publish}>
          ${t('profile.companies.portfolioPublish')}
        </button>
        ${status?.published && html`
          <button class="btn-outline" disabled=${busy} onClick=${remove}>
            ${t('profile.companies.portfolioRemove')}
          </button>`}
      </div>
    </div>
  `;
}

export function FrontPageSection({ company, apps, busy, setBusy, onSaved, showToast }) {
  // The editor's pending selection, reset whenever the SAVED record changes — the header
  // reports what is live, this reports what you are about to set.
  const saved = company.frontPage;
  const [front, setFront] = useState(saved);
  useEffect(() => { setFront(saved); }, [saved]);

  const save = useCallback(async (next) => {
    setBusy(true);
    try {
      await apiPut(`/v1/companies/${company.id}/front-page`, { kind: next.kind, target: next.target });
      showToast?.(t('profile.companies.frontSaved'), 'success');
      onSaved();
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [company.id, onSaved, setBusy, showToast]);

  return html`
    <h4>${t('profile.companies.frontTitle')}</h4>
    <p class="pf-co-hint">${t('profile.companies.frontHint')}</p>
    <div class="pf-co-row">
      <select value=${front.kind} onChange=${(e) => setFront({ kind: e.target.value, target: '' })}>
        <option value="none">${t('profile.companies.frontNone')}</option>
        <option value="portfolio">${t('profile.companies.frontPortfolio')}</option>
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
      ${/* 'portfolio' publishes through its own editor below, which sets the front page as part
           of publishing — so the button would be a second way to do the same thing. */ ''}
      ${front.kind !== 'portfolio' && html`
        <button class="btn-outline" disabled=${busy} onClick=${() => save(front)}>
          ${t('profile.companies.setFront')}
        </button>
      `}
      ${front.kind === 'app' && html`
        <${CopyButton} text=${buildAppPrompt(company)} className="btn-ghost"
          label=${t('profile.companies.promptApp')}
          copiedLabel=${t('profile.companies.promptCopied')} />
      `}
    </div>

    ${front.kind === 'portfolio' && html`
      <${PortfolioEditor} company=${company} busy=${busy} setBusy=${setBusy}
        onSaved=${onSaved} showToast=${showToast} />
    `}
  `;
}
