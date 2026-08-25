/**
 * @file discovery-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Discovery tab — whether this node can be found in a search engine,
 *   how it describes itself when it is, and what the operator still has to go and do.
 *
 *   The question an operator actually has is "am I findable, and what is left". Nothing answered it:
 *   the settings that decide it sat among two hundred others in the Config tab as raw dot-paths, and
 *   the only way to know whether a verification tag was reaching the page was to view source. So the
 *   status here is read from what is BEING SERVED rather than from the configuration, and the steps
 *   are a checked list rather than a paragraph of advice — a step is only green once the thing it
 *   asks for is visible from outside.
 *
 * @structure
 *   DiscoveryTab (default) — status, node identity, the steps, and the per-app list
 *   The app list and the steps live in ./discovery-tab.apps.js and ./discovery-tab.steps.js;
 *   this file holds the shell, the status read and the identity editor.
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, ErrorBox, Badge, ExpandableHelp, useToast, Toast } from './shared.js';
import * as adminService from '/js/services/admin.js';
import { DiscoverySteps } from './discovery-tab.steps.js';
import { DiscoveryApps } from './discovery-tab.apps.js';

/** The `seo.*` settings this tab edits, in the order an operator meets them. */
const IDENTITY_FIELDS = [
  { path: 'seo.site_name',         key: 'siteName',      type: 'text' },
  { path: 'seo.site_description',  type: 'textarea',     key: 'siteDescription' },
  { path: 'seo.og_image',          key: 'ogImage',       type: 'text' },
  { path: 'seo.organization_name', key: 'orgName',       type: 'text' },
  { path: 'seo.organization_url',  key: 'orgUrl',        type: 'text' },
  { path: 'seo.same_as',           key: 'sameAs',        type: 'lines' },
  { path: 'seo.twitter_site',      key: 'twitterSite',   type: 'text' },
];

/** One row of the status read-out, with the document it is a fact about. */
function StatusRow({ label, value, tone, href }) {
  return html`<div class="adm-seo-row">
    <span class="adm-seo-row-label">${label}</span>
    <span class="adm-seo-row-value">
      ${tone ? html`<${Badge} type=${tone} label=${value} />` : value}
    </span>
    ${href ? html`<a class="adm-seo-row-link" href=${href} target="_blank" rel="noopener">${t('dashboard.seo.open')}</a>` : null}
  </div>`;
}

/**
 * What a search result and a shared link would look like right now. Rendered from the SERVED
 * values, so an operator sees the effect of what they typed rather than the text they typed.
 */
function IdentityPreview({ identity }) {
  return html`<div class="adm-seo-preview">
    <div class="adm-seo-preview-serp">
      <div class="adm-seo-preview-url">${identity.organization_url}</div>
      <div class="adm-seo-preview-title">${identity.site_name}</div>
      <div class="adm-seo-preview-desc">${identity.site_description}</div>
    </div>
    <div class="adm-seo-preview-card">
      ${identity.og_image
        ? html`<img class="adm-seo-preview-img" src=${identity.og_image} alt="" loading="lazy" />`
        : html`<div class="adm-seo-preview-img adm-seo-preview-img-empty">${t('dashboard.seo.noImage')}</div>`}
      <div class="adm-seo-preview-card-body">
        <div class="adm-seo-preview-title">${identity.site_name}</div>
        <div class="adm-seo-preview-desc">${identity.site_description}</div>
      </div>
    </div>
  </div>`;
}

export default function DiscoveryTab() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  // Only the fields the operator has actually touched, so an unedited field is never resaved.
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const resp = await adminService.getSeoStatus();
      setStatus(resp?.data || null);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Every tab showing server data re-reads on the live-update event. This one especially: the app
  // states below change when an owner flips their own switch, from a surface that is not this page.
  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const setIndexing = useCallback(async (on) => {
    setSaving(true);
    try {
      await adminService.saveConfig([{ path: 'seo.indexing', value: on ? 'on' : 'off' }]);
      showSuccess(on ? t('dashboard.seo.indexingOnOk') : t('dashboard.seo.indexingOffOk'));
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [load, showSuccess, showError]);

  const saveIdentity = useCallback(async () => {
    const changes = Object.entries(edits).map(([path, value]) => ({ path, value }));
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await adminService.saveConfig(changes);
      setEdits({});
      showSuccess(t('dashboard.seo.identitySaved'));
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [edits, load, showSuccess, showError]);

  if (error) return html`<${ErrorBox} message=${error} />`;
  if (!status) return html`<${Spinner} text=${t('dashboard.seo.loading')} />`;

  const off = status.indexing === 'off';
  const current = (field) => {
    if (edits[field.path] !== undefined) return edits[field.path];
    const map = {
      'seo.site_name': status.identity.site_name,
      'seo.site_description': status.identity.site_description,
      'seo.og_image': status.identity.og_image,
      'seo.organization_name': status.identity.organization_name,
      'seo.organization_url': status.identity.organization_url,
      'seo.same_as': status.identity.same_as,
      'seo.twitter_site': status.identity.twitter_site || '',
    };
    return map[field.path] ?? '';
  };
  const edit = (field, raw) => setEdits(prev => ({
    ...prev,
    [field.path]: field.type === 'lines'
      ? String(raw).split('\n').map(s => s.trim()).filter(Boolean)
      : raw,
  }));

  return html`<div class="adm-seo">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${ExpandableHelp} title=${t('dashboard.seo.helpTitle')}>
      <p>${t('dashboard.seo.helpBody')}</p>
    <//>

    <section class="adm-card">
      <h3>${t('dashboard.seo.statusTitle')}</h3>
      <p class="adm-muted">${t('dashboard.seo.statusIntro')}</p>

      <div class="adm-seo-master">
        <div>
          <strong>${off ? t('dashboard.seo.masterOff') : t('dashboard.seo.masterOn')}</strong>
          <div class="adm-muted">${off ? t('dashboard.seo.masterOffHint') : t('dashboard.seo.masterOnHint')}</div>
        </div>
        <button class=${off ? 'btn-primary' : 'btn-outline'} disabled=${saving}
                onClick=${() => setIndexing(off)}>
          ${off ? t('dashboard.seo.turnOn') : t('dashboard.seo.turnOff')}
        </button>
      </div>

      <${StatusRow} label=${t('dashboard.seo.rowRobots')}
                    value=${status.robots.content_signal}
                    href=${status.robots.url} />
      <${StatusRow} label=${t('dashboard.seo.rowTraining')}
                    value=${status.robots.training_crawlers_blocked
                      ? t('dashboard.seo.trainingBlocked') : t('dashboard.seo.trainingAllowed')}
                    tone=${status.robots.training_crawlers_blocked ? 'amber' : 'green'} />
      <${StatusRow} label=${t('dashboard.seo.rowSitemap')}
                    value=${t('dashboard.seo.pagesCount', { n: status.sitemap.page_count })}
                    href=${status.sitemap.url} />
      <${StatusRow} label=${t('dashboard.seo.rowSitemapIndex')}
                    value=${t('dashboard.seo.hostsCount', {
                      n: status.sitemap.app_host_count, total: status.apps.total,
                    })}
                    href=${status.sitemap.index_url} />
      <${StatusRow} label=${t('dashboard.seo.rowIndexnow')}
                    value=${status.indexnow.key_configured
                      ? (status.indexnow.last_submitted_at
                        ? t('dashboard.seo.indexnowLast', { at: status.indexnow.last_submitted_at, n: status.indexnow.last_url_count })
                        : t('dashboard.seo.indexnowNeverSent'))
                      : t('dashboard.seo.indexnowNoKey')}
                    tone=${status.indexnow.key_configured ? 'green' : 'amber'} />
    </section>

    <section class="adm-card">
      <h3>${t('dashboard.seo.identityTitle')}</h3>
      <p class="adm-muted">${t('dashboard.seo.identityIntro')}</p>

      ${IDENTITY_FIELDS.map(field => html`
        <label class="adm-seo-field" key=${field.path}>
          <span class="adm-seo-field-label">${t(`dashboard.seo.f_${field.key}`)}</span>
          ${field.type === 'textarea'
            ? html`<textarea rows="3" value=${current(field)}
                             onInput=${e => edit(field, e.target.value)} />`
            : field.type === 'lines'
              ? html`<textarea rows="3" value=${(current(field) || []).join('\n')}
                               onInput=${e => edit(field, e.target.value)} />`
              : html`<input type="text" value=${current(field)}
                            onInput=${e => edit(field, e.target.value)} />`}
          <span class="adm-seo-field-hint">${t(`dashboard.seo.h_${field.key}`)}</span>
        </label>
      `)}

      <div class="adm-seo-actions">
        <button class="btn-primary" disabled=${saving || Object.keys(edits).length === 0}
                onClick=${saveIdentity}>
          ${t('dashboard.seo.saveIdentity')}
        </button>
        ${Object.keys(edits).length > 0
          ? html`<button class="btn-ghost" onClick=${() => setEdits({})}>${t('dashboard.seo.discard')}</button>`
          : null}
      </div>

      <h4>${t('dashboard.seo.previewTitle')}</h4>
      <p class="adm-muted">${t('dashboard.seo.previewIntro')}</p>
      <${IdentityPreview} identity=${status.identity} />
    </section>

    <${DiscoverySteps} status=${status} onChanged=${load} />
    <${DiscoveryApps} status=${status} onChanged=${load} />
  </div>`;
}
