/**
 * Admin Dashboard — Services Tab
 * Manage installed service extensions and their instances.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, DataTable, Empty, ExpandableHelp } from './shared.js';
import { getExtensionInstances, createExtensionInstance, updateExtensionInstance, deleteExtensionInstance } from '/js/services/admin.js';

const inputStyle = 'background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px';

export default function ServicesTab({ data, reload }) {
  const extensions = data.extensions?.extensions || [];
  const [selected, setSelected] = useState(null);
  const [instances, setInstances] = useState([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [newConfig, setNewConfig] = useState('');

  // Load instances when an extension is selected
  useEffect(() => {
    if (!selected) return;
    setLoadingInstances(true);
    getExtensionInstances(selected.name)
      .then(res => {
        setInstances(res.data?.instances || []);
      })
      .catch(() => setInstances([]))
      .finally(() => setLoadingInstances(false));
  }, [selected]);

  // ── Create instance handler ──
  async function handleCreate() {
    if (!newId.trim()) return;
    const body = { id: newId.trim() };
    if (newConfig.trim()) {
      try {
        body.config = JSON.parse(newConfig);
      } catch {
        alert(t('dashboard.errorLabel') + ': Invalid JSON');
        return;
      }
    }
    try {
      await createExtensionInstance(selected.name, body);
      setNewId('');
      setNewConfig('');
      setShowCreate(false);
      // Reload instances
      const res = await getExtensionInstances(selected.name);
      setInstances(res.data?.instances || []);
      reload();
    } catch (e) {
      alert(t('dashboard.errorLabel') + ': ' + e.message);
    }
  }

  // ── Toggle instance status ──
  async function handleToggleStatus(inst) {
    const newStatus = inst.status === 'active' ? 'paused' : 'active';
    try {
      await updateExtensionInstance(selected.name, inst.id, { status: newStatus });
      const res = await getExtensionInstances(selected.name);
      setInstances(res.data?.instances || []);
      reload();
    } catch (e) {
      alert(t('dashboard.errorLabel') + ': ' + e.message);
    }
  }

  // ── Delete instance ──
  async function handleDelete(inst) {
    if (!confirm(t('dashboard.servicesDeleteConfirm') + ': ' + inst.id + '?')) return;
    try {
      await deleteExtensionInstance(selected.name, inst.id);
      const res = await getExtensionInstances(selected.name);
      setInstances(res.data?.instances || []);
      reload();
    } catch (e) {
      alert(t('dashboard.errorLabel') + ': ' + e.message);
    }
  }

  // ── Detail view ──
  if (selected) {
    const instHeaders = [
      'ID',
      t('dashboard.status'),
      t('dashboard.owner'),
      t('dashboard.createdAt'),
      t('dashboard.actions'),
    ];

    const instRows = instances.map(inst => [
      escHtml(inst.id),
      html`<${Badge} type=${inst.status === 'active' ? 'healthy' : 'warning'} />`,
      escHtml(inst.createdBy || inst.created_by || '\u2014'),
      dt(inst.createdAt || inst.created_at),
      html`<div style="display:flex;gap:4px">
        <button class="adm-btn-sm" onClick=${() => handleToggleStatus(inst)}>
          ${t('dashboard.servicesStatusToggle')}
        </button>
        <button class="adm-btn-sm adm-btn-danger" onClick=${() => handleDelete(inst)}>
          ${t('dashboard.deleteLabel')}
        </button>
      </div>`,
    ]);

    return html`
      <div>
        <button class="adm-btn-action" onClick=${() => { setSelected(null); setInstances([]); setShowCreate(false); }}
          style="margin-bottom:12px">
          ${t('dashboard.servicesBack')}
        </button>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <h3 style="margin:0">${escHtml(selected.name)}</h3>
          <${Badge} type=${selected.status === 'active' ? 'healthy' : 'warning'} />
        </div>

        <button class="adm-btn-action" onClick=${() => setShowCreate(!showCreate)}
          style="margin-bottom:12px">
          ${t('dashboard.servicesCreateInstance')}
        </button>

        ${showCreate && html`
          <div class="adm-card" style="margin-bottom:16px;padding:16px;display:flex;flex-direction:column;gap:8px">
            <label>${t('dashboard.servicesInstanceId')}</label>
            <input type="text" value=${newId} onInput=${e => setNewId(e.target.value)}
              style=${inputStyle} placeholder="my-instance-01" />
            <label>${t('dashboard.servicesInstanceConfig')}</label>
            <textarea value=${newConfig} onInput=${e => setNewConfig(e.target.value)}
              style=${inputStyle + ';min-height:60px;font-family:monospace'} placeholder='{"key": "value"}' />
            <button class="adm-btn-action" onClick=${handleCreate}
              style="align-self:flex-start;margin-top:4px">
              ${t('dashboard.servicesCreateInstance')}
            </button>
          </div>
        `}

        ${loadingInstances
          ? html`<p>${t('dashboard.loading')}...</p>`
          : instances.length === 0
            ? html`<${Empty} text=${t('dashboard.servicesNoInstances')} />`
            : html`<${DataTable} headers=${instHeaders} rows=${instRows} scroll=${true} />`
        }
      </div>
    `;
  }

  // ── Overview ──
  const totalExtensions = extensions.length;
  const activeExtensions = extensions.filter(e => e.status === 'active').length;
  const totalInstances = extensions.reduce((sum, e) => sum + (e.instanceCount || e.instance_count || 0), 0);

  const statsItems = [
    { label: t('dashboard.servicesTotal'), value: totalExtensions },
    { label: t('dashboard.servicesActive'), value: activeExtensions, color: 'var(--green, #22c55e)' },
    { label: t('dashboard.servicesInstances'), value: totalInstances },
  ];

  const headers = [
    t('dashboard.servicesName'),
    t('dashboard.servicesVersion'),
    t('dashboard.status'),
    t('dashboard.servicesActionsCount'),
    t('dashboard.servicesInstancesCount'),
    t('dashboard.actions'),
  ];

  const rows = extensions.map(ext => [
    escHtml(ext.name),
    escHtml(ext.version || '\u2014'),
    html`<${Badge} type=${ext.status === 'active' ? 'healthy' : 'warning'} />`,
    ext.actionCount || ext.action_count || 0,
    ext.instanceCount || ext.instance_count || 0,
    html`<button class="adm-btn-sm" onClick=${() => setSelected(ext)}>
      ${t('dashboard.servicesManage')}
    </button>`,
  ]);

  return html`
    <${ExpandableHelp} title=${t('dashboard.servicesHelpTitle')}>
      <p>${t('dashboard.servicesHelpDetail')}</p>
    <//>
    <${StatsGrid} items=${statsItems} />
    <p style="color:var(--text-dim);margin:8px 0 16px">${t('dashboard.servicesExplain')}</p>
    ${extensions.length === 0
      ? html`<${Empty} text=${t('dashboard.servicesNoExtensions')} />`
      : html`<${DataTable} headers=${headers} rows=${rows} scroll=${true} />`
    }
  `;
}
