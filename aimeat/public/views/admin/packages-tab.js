/**
 * @file packages-tab.js
 * @description Admin dashboard tab for managing packages, template listings, instances,
 *   and template moderation queue. Shows overview stats, recent packages, instance
 *   distribution, pending review queue, and moderation history.
 * @structure
 *   - PackagesAdminTab — main tab component with subtabs for packages/templates/instances/moderation
 *   - ModerationQueue — pending template review queue
 *   - ReviewPanel — expanded review panel for a single pending template
 *   - ModerationHistory — recent moderation decisions
 * @usage
 *   Loaded by admin.js as a nav item component.
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 *   v1.1.0 — 2026-03-20 — add template moderation queue subtab
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { StatsGrid, Empty, Spinner, Badge, ExpandableHelp, dt } from './shared.js';
import * as pkgService from '/js/services/packages.js';
import {
  seedExamples,
  listPendingTemplates,
  reviewTemplate,
  approveTemplate,
  rejectTemplate,
  suspendTemplate,
} from '/js/services/admin.js';

/* ── Review Panel ── */
function ReviewPanel({ item, onDone }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await reviewTemplate(item.id);
        if (!cancelled && res.ok !== false) setDetail(res.data);
      } catch (_) { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  const handleApprove = async () => {
    setActing(true);
    setError('');
    try {
      const res = await approveTemplate(item.id, comment || undefined);
      if (res.ok === false) setError(res.error?.message || 'Failed');
      else onDone();
    } catch (e) { setError(e.message); }
    setActing(false);
  };

  const handleReject = async () => {
    if (!reason.trim()) { setError(t('dashboard.modReasonRequired') || 'Reason is required'); return; }
    setActing(true);
    setError('');
    try {
      const res = await rejectTemplate(item.id, reason);
      if (res.ok === false) setError(res.error?.message || 'Failed');
      else onDone();
    } catch (e) { setError(e.message); }
    setActing(false);
  };

  if (loading) return html`<div class="adm-sub-panel"><${Spinner} text=${t('dashboard.loading')} /></div>`;

  const d = detail || item;
  const components = d.components || d.manifest?.components || [];
  const dryRun = d.dryRunResults || d.dryRun || null;

  return html`
    <div class="adm-sub-panel adm-mod-review">
      <h4 class="adm-mod-review-title">${escHtml(d.name || d.title || '')}</h4>

      <div class="adm-mod-meta">
        ${d.description ? html`<p class="adm-mod-desc">${escHtml(d.description)}</p>` : null}
        <div class="adm-mod-meta-grid">
          ${d.category ? html`<span class="adm-mod-meta-item"><strong>${t('dashboard.pkgCategory') || 'Category'}:</strong> ${escHtml(d.category)}</span>` : null}
          ${d.version ? html`<span class="adm-mod-meta-item"><strong>${t('dashboard.pkgVersion') || 'Version'}:</strong> <code>${escHtml(d.version)}</code></span>` : null}
          ${d.author ? html`<span class="adm-mod-meta-item"><strong>${t('dashboard.pkgAuthor') || 'Author'}:</strong> ${escHtml(d.author)}</span>` : null}
        </div>
        ${d.tags && d.tags.length > 0 ? html`<div class="adm-mod-tags">${d.tags.map(tag => html`<span class="tag">${escHtml(tag)}</span>`)}</div>` : null}
        ${d.changelog ? html`<${ExpandableHelp} title=${t('dashboard.modChangelog') || 'Changelog'}><pre class="adm-mod-pre">${escHtml(d.changelog)}</pre><//>` : null}
      </div>

      ${components.length > 0 ? html`
        <div class="adm-mod-components">
          <h5>${t('dashboard.pkgComponents') || 'Components'} (${components.length})</h5>
          ${components.map(c => html`
            <${ExpandableHelp} title=${escHtml(c.name || c.id || 'Component')}>
              <pre class="adm-mod-pre">${escHtml(typeof c.content === 'string' ? c.content : JSON.stringify(c, null, 2))}</pre>
            <//>
          `)}
        </div>
      ` : null}

      ${dryRun ? html`
        <${ExpandableHelp} title=${t('dashboard.modDryRun') || 'Dry-Run Results'}>
          <pre class="adm-mod-pre">${escHtml(typeof dryRun === 'string' ? dryRun : JSON.stringify(dryRun, null, 2))}</pre>
        <//>
      ` : null}

      ${error ? html`<div class="error-box">${escHtml(error)}</div>` : null}

      <div class="adm-mod-actions">
        <div class="adm-mod-action-group">
          <label class="adm-mod-action-label">${t('dashboard.modComment') || 'Comment (optional)'}</label>
          <input
            class="adm-input adm-mod-input"
            type="text"
            value=${comment}
            onInput=${e => setComment(e.target.value)}
            placeholder=${t('dashboard.modCommentPlaceholder') || 'Optional approval comment...'}
          />
          <button class="btn-success" onClick=${handleApprove} disabled=${acting}>
            ${t('dashboard.modApprove') || 'Approve'}
          </button>
        </div>
        <div class="adm-mod-action-group">
          <label class="adm-mod-action-label">${t('dashboard.modReason') || 'Reason (required)'}</label>
          <input
            class="adm-input adm-mod-input"
            type="text"
            value=${reason}
            onInput=${e => setReason(e.target.value)}
            placeholder=${t('dashboard.modReasonPlaceholder') || 'Reason for rejection...'}
          />
          <button class="btn-danger" onClick=${handleReject} disabled=${acting}>
            ${t('dashboard.modReject') || 'Reject'}
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ── Moderation Queue ── */
function ModerationQueue({ pending, onReload }) {
  const [reviewId, setReviewId] = useState(null);

  if (pending.length === 0) return html`<${Empty} text=${t('dashboard.modNoPending') || 'No pending templates'} />`;

  return html`
    <div>
      <table class="adm-table">
        <thead><tr>
          <th>${t('dashboard.name')}</th>
          <th>${t('dashboard.pkgAuthor') || 'Author'}</th>
          <th>${t('dashboard.modProposedDate') || 'Proposed'}</th>
          <th>${t('dashboard.actions') || 'Actions'}</th>
        </tr></thead>
        <tbody>
          ${pending.map(p => html`
            <tr key=${p.id}>
              <td><strong>${escHtml(p.name || p.title || '')}</strong></td>
              <td>${escHtml(p.author || '')}</td>
              <td>${dt(p.proposedAt || p.createdAt)}</td>
              <td>
                <button
                  class="adm-btn-sm"
                  onClick=${() => setReviewId(reviewId === p.id ? null : p.id)}
                >
                  ${reviewId === p.id ? (t('dashboard.modClose') || 'Close') : (t('dashboard.modReview') || 'Review')}
                </button>
              </td>
            </tr>
            ${reviewId === p.id ? html`
              <tr key=${p.id + '-review'}>
                <td colspan="4">
                  <${ReviewPanel} item=${p} onDone=${() => { setReviewId(null); onReload(); }} />
                </td>
              </tr>
            ` : null}
          `)}
        </tbody>
      </table>
    </div>
  `;
}

/* ── Published Templates with Suspend ── */
function PublishedTemplates({ templates, onReload }) {
  const [suspendId, setSuspendId] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const published = templates.filter(tpl => tpl.status === 'approved' || tpl.status === 'published' || tpl.status === 'active');
  if (published.length === 0) return html`<${Empty} text=${t('dashboard.modNoPublished') || 'No published templates'} />`;

  const handleSuspend = async (id) => {
    if (!suspendReason.trim()) { setError(t('dashboard.modReasonRequired') || 'Reason is required'); return; }
    setActing(true);
    setError('');
    try {
      const res = await suspendTemplate(id, suspendReason);
      if (res.ok === false) setError(res.error?.message || 'Failed');
      else { setSuspendId(null); setSuspendReason(''); onReload(); }
    } catch (e) { setError(e.message); }
    setActing(false);
  };

  return html`
    <table class="adm-table">
      <thead><tr>
        <th>${t('dashboard.pkgTitle') || 'Title'}</th>
        <th>${t('dashboard.pkgAuthor') || 'Author'}</th>
        <th>${t('dashboard.status')}</th>
        <th>${t('dashboard.actions') || 'Actions'}</th>
      </tr></thead>
      <tbody>
        ${published.map(tpl => html`
          <tr key=${tpl.id}>
            <td><strong>${escHtml(tpl.title || tpl.name || '')}</strong></td>
            <td>${escHtml(tpl.author || '')}</td>
            <td><${Badge} type=${tpl.status} /></td>
            <td>
              <button
                class="adm-btn-sm adm-btn-danger"
                onClick=${() => setSuspendId(suspendId === tpl.id ? null : tpl.id)}
              >
                ${t('dashboard.modSuspend') || 'Suspend'}
              </button>
            </td>
          </tr>
          ${suspendId === tpl.id ? html`
            <tr key=${tpl.id + '-suspend'}>
              <td colspan="4">
                <div class="adm-sub-panel adm-mod-suspend-panel">
                  ${error ? html`<div class="error-box">${escHtml(error)}</div>` : null}
                  <label class="adm-mod-action-label">${t('dashboard.modSuspendReason') || 'Suspension reason (required)'}</label>
                  <div class="adm-mod-suspend-row">
                    <input
                      class="adm-input adm-mod-input"
                      type="text"
                      value=${suspendReason}
                      onInput=${e => setSuspendReason(e.target.value)}
                      placeholder=${t('dashboard.modSuspendReasonPlaceholder') || 'Reason for suspension...'}
                    />
                    <button class="btn-danger" onClick=${() => handleSuspend(tpl.id)} disabled=${acting}>
                      ${t('dashboard.modConfirmSuspend') || 'Confirm Suspend'}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ` : null}
        `)}
      </tbody>
    </table>
  `;
}

/* ── Moderation History ── */
function ModerationHistory({ history }) {
  if (!history || history.length === 0) return html`<${Empty} text=${t('dashboard.modNoHistory') || 'No moderation history'} />`;

  return html`
    <table class="adm-table">
      <thead><tr>
        <th>${t('dashboard.name')}</th>
        <th>${t('dashboard.modDecision') || 'Decision'}</th>
        <th>${t('dashboard.modReviewer') || 'Reviewer'}</th>
        <th>${t('dashboard.modReasonCol') || 'Reason'}</th>
        <th>${t('dashboard.date') || 'Date'}</th>
      </tr></thead>
      <tbody>
        ${history.map((h, i) => html`
          <tr key=${i}>
            <td><strong>${escHtml(h.templateName || h.name || '')}</strong></td>
            <td><${Badge} type=${h.decision || h.action || ''} /></td>
            <td>${escHtml(h.reviewer || h.reviewedBy || '')}</td>
            <td>${escHtml(h.reason || h.comment || '')}</td>
            <td>${dt(h.reviewedAt || h.date)}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

/* ── Main Tab ── */
export default function PackagesAdminTab({ data, reload, session }) {
  const [packages, setPackages] = useState([]);
  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');
  const [subtab, setSubtab] = useState('packages');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgRes, instRes, tplRes, pendRes] = await Promise.all([
        pkgService.listPackages({ limit: 50 }),
        pkgService.listInstances({ limit: 50 }),
        pkgService.listTemplates({ limit: 50 }),
        listPendingTemplates().catch(() => ({ ok: false })),
      ]);
      if (pkgRes.ok !== false) setPackages(pkgRes.data?.packages ?? []);
      if (instRes.ok !== false) setInstances(instRes.data?.instances ?? []);
      if (tplRes.ok !== false) setTemplates(tplRes.data?.listings ?? tplRes.data?.templates ?? []);
      if (pendRes.ok !== false) {
        setPending(pendRes.data?.pending ?? pendRes.data?.templates ?? []);
        setHistory(pendRes.data?.history ?? []);
      }
    } catch (_) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Live updates
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);

  if (loading) return html`<${Spinner} text=${t('dashboard.loading')} />`;

  const published = packages.filter(p => p.status === 'published').length;
  const pendingCount = pending.length;
  const stats = [
    { label: t('dashboard.pkgTotalPackages') || 'Total Packages', value: packages.length, color: 'var(--accent, #60a5fa)' },
    { label: t('dashboard.pkgTotalInstances') || 'Total Instances', value: instances.length, color: 'var(--green, #34d399)' },
    { label: t('dashboard.pkgTotalTemplates') || 'Template Listings', value: templates.length, color: 'var(--purple, #a78bfa)' },
    { label: t('dashboard.pkgPending') || 'Pending Review', value: pendingCount, color: 'var(--amber, #fbbf24)' },
  ];

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg('');
    try {
      const res = await seedExamples();
      if (res.ok !== false) {
        const names = (res.data?.seeded ?? []).map(s => s.name).join(', ');
        setSeedMsg(names ? `Seeded: ${names}` : 'Done');
        loadData();
      } else {
        setSeedMsg(res.error?.message ?? 'Failed');
      }
    } catch (e) { setSeedMsg('Error: ' + e.message); }
    setSeeding(false);
  };

  return html`
    <div>
      <${StatsGrid} items=${stats} />

      <div class="adm-card adm-pkg-seed-card">
        ${packages.length === 0 && templates.length === 0
          ? html`<p class="adm-pkg-seed-text">${t('dashboard.pkgNoPackages') || 'No packages yet. Seed example packages to get started.'}</p>`
          : html`<p class="adm-pkg-seed-text">${t('dashboard.pkgReseedHint') || 'Re-seed to update example packages to latest version.'}</p>`
        }
        <button class="adm-btn" onClick=${handleSeed} disabled=${seeding}>
          ${seeding ? (t('dashboard.loading') || 'Loading...') : (t('dashboard.pkgSeedExamples') || 'Seed Example Packages')}
        </button>
        ${seedMsg && html`<p class="adm-pkg-seed-msg">${seedMsg}</p>`}
      </div>

      <div class="adm-subtabs">
        <button class=${'adm-btn' + (subtab === 'packages' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('packages')}>
          ${t('dashboard.pkgPackagesTab') || 'Packages'} (${packages.length})
        </button>
        <button class=${'adm-btn' + (subtab === 'templates' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('templates')}>
          ${t('dashboard.pkgTemplatesTab') || 'Templates'} (${templates.length})
        </button>
        <button class=${'adm-btn' + (subtab === 'instances' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('instances')}>
          ${t('dashboard.pkgInstancesTab') || 'Instances'} (${instances.length})
        </button>
        <button class=${'adm-btn' + (subtab === 'moderation' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('moderation')}>
          ${t('dashboard.modModerationTab') || 'Moderation'}
          ${pendingCount > 0 ? html` <${Badge} type="pending" />` : null}
          ${pendingCount > 0 ? html` (${pendingCount})` : null}
        </button>
      </div>

      ${subtab === 'packages' && html`
        <div class="adm-card">
          <h3>${t('dashboard.pkgAllPackages') || 'All Packages'}</h3>
          ${packages.length === 0 ? html`<${Empty} text=${t('dashboard.pkgNoPackages') || 'No packages yet'} />` : html`
            <table class="adm-table">
              <thead><tr>
                <th>${t('dashboard.name')}</th>
                <th>${t('dashboard.pkgAuthor') || 'Author'}</th>
                <th>${t('dashboard.pkgVersion') || 'Version'}</th>
                <th>${t('dashboard.status')}</th>
                <th>${t('dashboard.pkgCategory') || 'Category'}</th>
                <th>${t('dashboard.created')}</th>
              </tr></thead>
              <tbody>
                ${packages.map(p => html`
                  <tr key=${p.id}>
                    <td><strong>${escHtml(p.name)}</strong></td>
                    <td>${escHtml(p.author || '')}</td>
                    <td><code>${escHtml(p.version || '')}</code></td>
                    <td><${Badge} type=${p.status} /></td>
                    <td>${escHtml(p.category || '')}</td>
                    <td>${dt(p.createdAt)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>
      `}

      ${subtab === 'templates' && html`
        <div class="adm-card">
          <h3>${t('dashboard.pkgAllTemplates') || 'Template Listings'}</h3>
          ${templates.length === 0 ? html`<${Empty} text=${t('dashboard.pkgNoTemplates') || 'No template listings yet'} />` : html`
            <table class="adm-table">
              <thead><tr>
                <th>${t('dashboard.pkgTitle') || 'Title'}</th>
                <th>${t('dashboard.pkgPackage') || 'Package'}</th>
                <th>${t('dashboard.pkgRating') || 'Rating'}</th>
                <th>${t('dashboard.pkgInstalls') || 'Installs'}</th>
                <th>${t('dashboard.pkgFeatured') || 'Featured'}</th>
                <th>${t('dashboard.status')}</th>
              </tr></thead>
              <tbody>
                ${templates.map(tpl => html`
                  <tr key=${tpl.id}>
                    <td><strong>${escHtml(tpl.title || '')}</strong></td>
                    <td>${escHtml(tpl.packageName || tpl.packageGroupId || '')}</td>
                    <td>\u2B50 ${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount ?? 0})</td>
                    <td>${tpl.installCount ?? 0}</td>
                    <td>${tpl.featured ? '\u2705' : '\u2014'}</td>
                    <td><${Badge} type=${tpl.status} /></td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>
      `}

      ${subtab === 'instances' && html`
        <div class="adm-card">
          <h3>${t('dashboard.pkgAllInstances') || 'All Instances'}</h3>
          ${instances.length === 0 ? html`<${Empty} text=${t('dashboard.pkgNoInstances') || 'No instances yet'} />` : html`
            <table class="adm-table">
              <thead><tr>
                <th>${t('dashboard.pkgLabel') || 'Label'}</th>
                <th>${t('dashboard.pkgPackage') || 'Package'}</th>
                <th>${t('dashboard.pkgOwner') || 'Owner'}</th>
                <th>${t('dashboard.pkgVersion') || 'Version'}</th>
                <th>${t('dashboard.status')}</th>
                <th>${t('dashboard.pkgComponents') || 'Components'}</th>
                <th>${t('dashboard.pkgInstalled') || 'Installed'}</th>
              </tr></thead>
              <tbody>
                ${instances.map(inst => html`
                  <tr key=${inst.id}>
                    <td><strong>${escHtml(inst.label || '\u2014')}</strong></td>
                    <td>${escHtml(inst.packageGroupId || '')}</td>
                    <td>${escHtml(inst.owner || '')}</td>
                    <td><code>${escHtml(inst.packageVersion || '')}</code></td>
                    <td><${Badge} type=${inst.status} /></td>
                    <td>${inst.installedComponents?.length ?? 0}</td>
                    <td>${dt(inst.installedAt)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>
      `}

      ${subtab === 'moderation' && html`
        <div>
          <div class="adm-card adm-mod-section">
            <h3>${t('dashboard.modPendingQueue') || 'Pending Review Queue'}
              ${pendingCount > 0 ? html` <${Badge} type="pending" />` : null}
            </h3>
            <${ModerationQueue} pending=${pending} onReload=${loadData} />
          </div>

          <div class="adm-card adm-mod-section">
            <h3>${t('dashboard.modPublishedTemplates') || 'Published Templates'}</h3>
            <${PublishedTemplates} templates=${templates} onReload=${loadData} />
          </div>

          <div class="adm-card adm-mod-section">
            <h3>${t('dashboard.modHistory') || 'Moderation History'}</h3>
            <${ModerationHistory} history=${history} />
          </div>
        </div>
      `}
    </div>
  `;
}
