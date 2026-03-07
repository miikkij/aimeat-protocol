import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, Spinner, Empty } from './shared.js';
import * as adminService from '/js/services/admin.js';

export default function KnowledgeAdminTab({ data, reload }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewForm, setReviewForm] = useState({ reason: 'routine_review', action: 'approve', customText: '' });

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await adminService.getKnowledgePackages({ flagged: showFlaggedOnly || undefined });
      setPackages(resp?.data?.packages || []);
    } catch { setPackages([]); }
    finally { setLoading(false); }
  }, [showFlaggedOnly]);

  useEffect(() => { loadPackages(); }, [loadPackages]);

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

  if (loading) return html`<${Spinner} text="Loading knowledge packages..." />`;

  return html`
    <div class="adm-section">
      <h3>${t('knowledge.operator.tabLabel')}</h3>

      <label class="adm-toggle" style="margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
        <input type="checkbox" checked=${showFlaggedOnly}
          onChange=${(e) => setShowFlaggedOnly(e.target.checked)} />
        Show flagged only
      </label>

      ${packages.length === 0 && html`<${Empty} text="No knowledge packages found" />`}

      ${packages.map(pkg => html`
        <div class="adm-card" key=${pkg.key} style="margin-bottom: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
            <strong>${escHtml(pkg.name)}</strong>
            <${Badge} type=${pkg.content_type} />
            <span style="font-size: 0.75rem; color: var(--text-muted);">by ${escHtml(pkg.author)}</span>
            ${pkg.flag_count > 0 && html`
              <span style="background: rgba(231,76,60,0.2); color: #e74c3c; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem;">
                ${pkg.flag_count} flags
              </span>
            `}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            Visibility: ${pkg.visibility} | Created: ${pkg.created?.slice(0, 10)}
          </div>
          <button class="adm-btn" onClick=${() => setReviewingId(reviewingId === pkg.package_id ? null : pkg.package_id)}>
            ${t('knowledge.operator.review')}
          </button>

          ${reviewingId === pkg.package_id && html`
            <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--input-bg); border-radius: 8px;">
              <div style="margin-bottom: 0.5rem;">
                <label style="font-size: 0.8rem;">Reason:</label>
                <select value=${reviewForm.reason} onChange=${(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
                  style="margin-left: 0.5rem; padding: 0.25rem;">
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
                  <input type="text" placeholder="Custom reason..."
                    value=${reviewForm.customText}
                    onChange=${(e) => setReviewForm({ ...reviewForm, customText: e.target.value })}
                    style="width: 100%; padding: 0.35rem;" />
                </div>
              `}
              <div style="margin-bottom: 0.5rem;">
                <label style="font-size: 0.8rem;">Action:</label>
                <select value=${reviewForm.action} onChange=${(e) => setReviewForm({ ...reviewForm, action: e.target.value })}
                  style="margin-left: 0.5rem; padding: 0.25rem;">
                  <option value="approve">${t('knowledge.operator.actions.approve')}</option>
                  <option value="flag">${t('knowledge.operator.actions.flag')}</option>
                  <option value="delist">${t('knowledge.operator.actions.delist')}</option>
                  <option value="restrict">${t('knowledge.operator.actions.restrict')}</option>
                  <option value="note">${t('knowledge.operator.actions.note')}</option>
                </select>
              </div>
              <button class="adm-btn" onClick=${() => submitReview(pkg.package_id)}>Submit Review</button>
            </div>
          `}
        </div>
      `)}
    </div>
  `;
}
