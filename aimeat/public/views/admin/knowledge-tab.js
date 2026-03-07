import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Spinner, Empty } from './shared.js';
import * as adminService from '/js/services/admin.js';

const CONTENT_TYPES = ['document', 'research', 'idea', 'plan', 'dataset', 'tutorial', 'collection', 'article', 'story', 'fiction'];
const MATURITY_OPTS = ['draft', 'review', 'published'];

export default function KnowledgeAdminTab({ data, reload }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewForm, setReviewForm] = useState({ reason: 'routine_review', action: 'approve', customText: '' });

  /* ── Create form state ── */
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', content_type: 'document', tags: '', maturity: 'published',
    visibility: 'public', catalog_listed: true,
    entries: [{ title: '', content: '' }],
  });

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await adminService.getKnowledgePackages({ flagged: showFlaggedOnly || undefined });
      setPackages(resp?.data?.packages || []);
    } catch { setPackages([]); }
    finally { setLoading(false); }
  }, [showFlaggedOnly]);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  /* ── Submit review ── */
  const submitReview = useCallback(async (packageId) => {
    try {
      await adminService.reviewKnowledgePackage(
        packageId, reviewForm.reason, reviewForm.action, reviewForm.customText || undefined
      );
      setReviewingId(null);
      loadPackages();
    } catch (err) {
      console.error('Review failed:', err);
    }
  }, [reviewForm, loadPackages]);

  /* ── Create system package ── */
  const createPackage = useCallback(async () => {
    if (!form.name.trim()) return;
    if (form.entries.every(e => !e.title.trim())) return;
    setCreating(true);
    try {
      const result = await adminService.createSystemKnowledge({
        name: form.name,
        content_type: form.content_type,
        tags: form.tags,
        maturity: form.maturity,
        visibility: form.visibility,
        catalog_listed: form.catalog_listed,
        entries: form.entries.filter(e => e.title.trim()),
      });
      if (result?.data?.package_id) {
        setShowCreate(false);
        setForm({ name: '', content_type: 'document', tags: '', maturity: 'published', visibility: 'public', catalog_listed: true, entries: [{ title: '', content: '' }] });
        loadPackages();
      }
    } catch (err) { console.error('Create failed:', err); }
    finally { setCreating(false); }
  }, [form, loadPackages]);

  /* ── Delete package ── */
  const deletePackage = useCallback(async (packageId) => {
    if (!confirm(t('knowledge.operator.confirmDelete'))) return;
    try {
      await adminService.deleteKnowledgePackage(packageId);
      loadPackages();
    } catch (err) { console.error('Delete failed:', err); }
  }, [loadPackages]);

  /* ── Entry management ── */
  const addEntry = () => setForm(f => ({ ...f, entries: [...f.entries, { title: '', content: '' }] }));
  const removeEntry = (i) => setForm(f => ({ ...f, entries: f.entries.filter((_, idx) => idx !== i) }));
  const updateEntry = (i, field, val) => setForm(f => ({
    ...f, entries: f.entries.map((e, idx) => idx === i ? { ...e, [field]: val } : e),
  }));

  if (loading) return html`<${Spinner} text="Loading..." />`;

  return html`
    <div class="adm-section">

      <!-- ═══ SYSTEM KNOWLEDGE SECTION ═══ -->
      <div style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 0.25rem;">${t('knowledge.operator.systemSection')}</h3>
        <p style="font-size: 0.8rem; color: var(--text-dim); margin: 0 0 0.75rem 0;">
          ${t('knowledge.operator.systemDesc')}
        </p>

        <button class="adm-btn-action" onClick=${() => setShowCreate(!showCreate)}>
          + ${t('knowledge.operator.createPackage')}
        </button>

        ${showCreate && html`
          <div class="adm-card" style="margin-top: 0.75rem;">
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">

              <!-- Name -->
              <input value=${form.name}
                onInput=${e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder=${t('knowledge.operator.createForm.name')}
                style="background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 8px 12px; border-radius: 6px;" />

              <!-- Type + Maturity row -->
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <select value=${form.content_type}
                  onChange=${e => setForm(f => ({ ...f, content_type: e.target.value }))}
                  style="flex: 1; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 8px; border-radius: 6px;">
                  ${CONTENT_TYPES.map(ct => html`
                    <option value=${ct}>${t('knowledge.contentTypes.' + ct)}</option>
                  `)}
                </select>
                <select value=${form.maturity}
                  onChange=${e => setForm(f => ({ ...f, maturity: e.target.value }))}
                  style="flex: 1; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 8px; border-radius: 6px;">
                  ${MATURITY_OPTS.map(m => html`
                    <option value=${m}>${t('knowledge.maturity.' + m)}</option>
                  `)}
                </select>
              </div>

              <!-- Tags -->
              <input value=${form.tags}
                onInput=${e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder=${t('knowledge.operator.createForm.tags')}
                style="background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 8px 12px; border-radius: 6px;" />

              <!-- Visibility -->
              <select value=${form.visibility}
                onChange=${e => setForm(f => ({ ...f, visibility: e.target.value, catalog_listed: e.target.value !== 'operator' }))}
                style="background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 8px; border-radius: 6px;">
                <option value="public">${t('knowledge.operator.createForm.visibilityPublic')}</option>
                <option value="operator">${t('knowledge.operator.createForm.visibilityOperator')}</option>
              </select>

              <!-- Catalog toggle -->
              ${form.visibility !== 'operator' && html`
                <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-dim);">
                  <input type="checkbox" checked=${form.catalog_listed}
                    onChange=${e => setForm(f => ({ ...f, catalog_listed: e.target.checked }))} />
                  ${t('knowledge.operator.createForm.catalogListed')}
                </label>
              `}

              <!-- Entries -->
              <div style="border-top: 1px solid var(--glass-border); padding-top: 0.5rem; margin-top: 0.25rem;">
                ${form.entries.map((entry, i) => html`
                  <div key=${i} style="margin-bottom: 0.5rem; padding: 0.5rem; background: var(--bg-card); border-radius: 6px;">
                    <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem;">
                      <input value=${entry.title}
                        onInput=${e => updateEntry(i, 'title', e.target.value)}
                        placeholder=${t('knowledge.operator.createForm.entryTitle')}
                        style="flex: 1; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 6px 10px; border-radius: 4px;" />
                      ${form.entries.length > 1 && html`
                        <button class="adm-btn-sm" style="color: #e74c3c;" onClick=${() => removeEntry(i)}>
                          ${t('knowledge.operator.createForm.removeEntry')}
                        </button>
                      `}
                    </div>
                    <textarea value=${entry.content}
                      onInput=${e => updateEntry(i, 'content', e.target.value)}
                      placeholder=${t('knowledge.operator.createForm.entryContent')}
                      rows="3"
                      style="width: 100%; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); padding: 6px 10px; border-radius: 4px; resize: vertical; font-family: inherit;" />
                  </div>
                `)}
                <button class="adm-btn-sm" onClick=${addEntry} style="margin-top: 0.25rem;">
                  + ${t('knowledge.operator.createForm.addEntry')}
                </button>
              </div>

              <!-- Submit -->
              <button class="adm-btn-action" onClick=${createPackage} disabled=${creating}
                style="margin-top: 0.25rem;">
                ${creating ? '...' : t('knowledge.operator.createForm.submit')}
              </button>
            </div>
          </div>
        `}
      </div>

      <!-- ═══ ALL PACKAGES SECTION ═══ -->
      <h3 style="margin-bottom: 0.5rem;">${t('knowledge.operator.allPackages')}</h3>

      <label style="margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-dim);">
        <input type="checkbox" checked=${showFlaggedOnly}
          onChange=${(e) => setShowFlaggedOnly(e.target.checked)} />
        ${t('knowledge.operator.showFlaggedOnly')}
      </label>

      ${packages.length === 0 && html`<${Empty} text=${t('knowledge.operator.noPackages')} />`}

      <div class="adm-card-grid">
        ${packages.map(pkg => html`
          <div class="adm-card" key=${pkg.key}>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
              <strong>${escHtml(pkg.name)}</strong>
              <${Badge} type=${pkg.content_type} />
              ${pkg.is_system && html`
                <span style="background: rgba(52,152,219,0.2); color: #3498db; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem;">
                  System
                </span>
              `}
              ${pkg.flag_count > 0 && html`
                <span style="background: rgba(231,76,60,0.2); color: #e74c3c; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem;">
                  ${t('knowledge.operator.flags').replace('{count}', String(pkg.flag_count))}
                </span>
              `}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem;">
              <span>by ${escHtml(pkg.author)}</span>
              ${' · '}
              <span>${t('knowledge.visibility.' + (pkg.visibility || 'public'))}</span>
              ${' · '}
              <span>${t('knowledge.maturity.' + (pkg.maturity || 'draft'))}</span>
              ${pkg.entries_count ? ' · ' + pkg.entries_count + ' entries' : ''}
              ${pkg.created ? ' · ' + (pkg.created || '').slice(0, 10) : ''}
            </div>
            ${(pkg.tags || []).length > 0 && html`
              <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
                ${pkg.tags.map(tag => html`
                  <span key=${tag} style="background: var(--glass-bg); padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; color: var(--text-dim);">
                    ${escHtml(tag)}
                  </span>
                `)}
              </div>
            `}
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button class="adm-btn-sm" onClick=${() => setReviewingId(reviewingId === pkg.package_id ? null : pkg.package_id)}>
                ${t('knowledge.operator.review')}
              </button>
              <button class="adm-btn-sm" style="color: #e74c3c;" onClick=${() => deletePackage(pkg.package_id)}>
                ${t('knowledge.operator.deletePackage')}
              </button>
            </div>

            ${reviewingId === pkg.package_id && html`
              <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--glass-border);">
                <div style="margin-bottom: 0.5rem;">
                  <label style="font-size: 0.8rem; color: var(--text-dim);">${t('knowledge.operator.reasonLabel')}:</label>
                  <select value=${reviewForm.reason}
                    onChange=${(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
                    style="margin-left: 0.5rem; padding: 0.25rem; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); border-radius: 4px;">
                    <option value="routine_review">${t('knowledge.operator.reasons.routine_review')}</option>
                    <option value="legal_compliance">${t('knowledge.operator.reasons.legal_compliance')}</option>
                    <option value="community_report">${t('knowledge.operator.reasons.community_report')}</option>
                    <option value="content_quality">${t('knowledge.operator.reasons.content_quality')}</option>
                    <option value="storage_issue">${t('knowledge.operator.reasons.storage_issue')}</option>
                    <option value="custom">${t('knowledge.operator.reasons.custom')}</option>
                  </select>
                </div>
                ${reviewForm.reason === 'custom' && html`
                  <div style="margin-bottom: 0.5rem;">
                    <input type="text" placeholder=${t('knowledge.operator.customReason')}
                      value=${reviewForm.customText}
                      onChange=${(e) => setReviewForm({ ...reviewForm, customText: e.target.value })}
                      style="width: 100%; padding: 0.35rem; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); border-radius: 4px;" />
                  </div>
                `}
                <div style="margin-bottom: 0.5rem;">
                  <label style="font-size: 0.8rem; color: var(--text-dim);">${t('knowledge.operator.actionLabel')}:</label>
                  <select value=${reviewForm.action}
                    onChange=${(e) => setReviewForm({ ...reviewForm, action: e.target.value })}
                    style="margin-left: 0.5rem; padding: 0.25rem; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-bright); border-radius: 4px;">
                    <option value="approve">${t('knowledge.operator.actions.approve')}</option>
                    <option value="flag">${t('knowledge.operator.actions.flag')}</option>
                    <option value="delist">${t('knowledge.operator.actions.delist')}</option>
                    <option value="restrict">${t('knowledge.operator.actions.restrict')}</option>
                    <option value="note">${t('knowledge.operator.actions.note')}</option>
                  </select>
                </div>
                <button class="adm-btn-action" onClick=${() => submitReview(pkg.package_id)}>
                  ${t('knowledge.operator.submitReview')}
                </button>
              </div>
            `}
          </div>
        `)}
      </div>
    </div>
  `;
}
