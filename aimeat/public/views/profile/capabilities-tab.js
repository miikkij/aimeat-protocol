import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { getSession } from '/js/services/auth.js';

export default function CapabilitiesTab() {
  const [caps, setCaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCap, setNewCap] = useState({ id: '', name: '', summary: '', callable: false, visibility: 'private', tags: '' });

  const loadCaps = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    try {
      const res = await session.fetch('/v1/capabilities?owner=' + encodeURIComponent(session.ghii || session.owner));
      setCaps(res.data?.capabilities || []);
    } catch { setCaps([]); }
    setLoading(false);
  }, []);

  useEffect(() => { loadCaps(); }, [loadCaps]);

  useEffect(() => {
    const handler = () => loadCaps();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadCaps]);

  const handleCreate = async () => {
    const session = getSession();
    if (!session) return;
    try {
      await session.fetch('/v1/capabilities', {
        method: 'POST',
        body: JSON.stringify({
          id: newCap.id || undefined,
          name: newCap.name,
          summary: newCap.summary,
          callable: newCap.callable,
          visibility: newCap.visibility,
          source: { type: 'manual', ref: 'manual', version: '1.0.0' },
          tags: newCap.tags ? newCap.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
        }),
      });
      setCreating(false);
      setNewCap({ id: '', name: '', summary: '', callable: false, visibility: 'private', tags: '' });
      loadCaps();
    } catch (e) {
      alert(e.message || 'Failed to create');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('capabilities.deleteConfirm'))) return;
    const session = getSession();
    if (!session) return;
    try {
      await session.fetch('/v1/capabilities/' + encodeURIComponent(id), { method: 'DELETE' });
      loadCaps();
    } catch (e) {
      alert(e.message || 'Failed to delete');
    }
  };

  if (loading) return html`<${Spinner} />`;

  return html`
    <div class="pf-section">
      <div class="section-title">${t('capabilities.title')}</div>
      <div class="section-desc">${caps.length} ${t('capabilities.title').toLowerCase()}</div>

      <div style="margin:12px 0">
        <button class="btn-primary" onClick=${() => setCreating(!creating)}>
          ${creating ? t('common.cancel') : t('capabilities.create')}
        </button>
      </div>

      ${creating ? html`
        <div class="pf-card" style="margin-bottom:16px;padding:16px">
          <div style="display:grid;gap:8px;max-width:400px">
            <input placeholder="ID (optional)" value=${newCap.id} onInput=${e => setNewCap({ ...newCap, id: e.target.value })} style="padding:6px 10px;border:1px solid var(--border);border-radius:6px" />
            <input placeholder=${t('capabilities.name')} value=${newCap.name} onInput=${e => setNewCap({ ...newCap, name: e.target.value })} style="padding:6px 10px;border:1px solid var(--border);border-radius:6px" />
            <textarea placeholder=${t('capabilities.summary')} value=${newCap.summary} onInput=${e => setNewCap({ ...newCap, summary: e.target.value })} rows="2" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px" />
            <input placeholder="Tags (comma-separated)" value=${newCap.tags} onInput=${e => setNewCap({ ...newCap, tags: e.target.value })} style="padding:6px 10px;border:1px solid var(--border);border-radius:6px" />
            <label style="display:flex;align-items:center;gap:6px;font-size:.85rem">
              <input type="checkbox" checked=${newCap.callable} onChange=${e => setNewCap({ ...newCap, callable: e.target.checked })} />
              ${t('capabilities.callable')}
            </label>
            <select value=${newCap.visibility} onChange=${e => setNewCap({ ...newCap, visibility: e.target.value })} style="padding:6px 10px;border:1px solid var(--border);border-radius:6px">
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
            <button class="btn-primary" onClick=${handleCreate} disabled=${!newCap.name}>
              ${t('capabilities.create')}
            </button>
          </div>
        </div>
      ` : ''}

      ${!caps.length ? html`<div class="pf-empty">${t('capabilities.noCapabilities')}</div>` : ''}

      ${caps.map(c => {
        const s = c.stats || {};
        return html`
          <div class="pf-card" style="margin-bottom:8px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <strong>${escHtml(c.name)}</strong>
                <span style="margin-left:8px;font-size:.72rem;padding:2px 6px;border-radius:4px;background:var(--bg-dim);color:var(--text-dim)">${c.source?.type || 'manual'}</span>
                ${c.status !== 'active' ? html`<span style="margin-left:4px;font-size:.72rem;padding:2px 6px;border-radius:4px;background:#fecaca;color:#991b1b">${c.status}</span>` : ''}
                ${c.callable ? html`<span style="margin-left:4px;font-size:.72rem">⚡ ${t('capabilities.callable')}</span>` : ''}
              </div>
              <div style="display:flex;gap:4px">
                ${c.source?.type === 'manual' ? html`
                  <button class="btn-ghost btn-danger" style="font-size:.75rem;padding:2px 8px" onClick=${() => handleDelete(c.id)}>
                    ${t('capabilities.delete')}
                  </button>
                ` : ''}
              </div>
            </div>
            ${c.summary ? html`<div style="font-size:.8rem;color:var(--text-dim);margin-top:4px">${escHtml(c.summary)}</div>` : ''}
            <div style="display:flex;gap:16px;margin-top:8px;font-size:.75rem;color:var(--text-muted)">
              <span>${t('capabilities.invocations')}: ${s.totalInvocations || 0}</span>
              <span>${t('capabilities.errors')}: ${s.errorCount || 0}</span>
              <span>${t('capabilities.vouchCount')}: ${c.trust?.vouchCount || 0}</span>
              ${c.visibility === 'public' ? html`<span>🌐 Public</span>` : html`<span>🔒 Private</span>`}
            </div>
            ${(c.tags || []).length ? html`<div style="margin-top:6px">${c.tags.map(tag => html`<span class="tag" style="font-size:.7rem;margin-right:4px">${escHtml(tag)}</span>`)}</div>` : ''}
          </div>
        `;
      })}
    </div>
  `;
}
