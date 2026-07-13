/**
 * @file inline-panels.js
 * @description Inline preview panels for the profile landing page.
 *   Expand below menu sections to show quick previews of agents, memory,
 *   boards, and packages. Each panel fetches data lazily and listens for
 *   SSE live-update events while open.
 * @structure
 *   - InlinePanel — container with header, close button, animated expand
 *   - AgentsPanel, MemoryPanel, BoardsPanel, PackagesPanel — content panels
 * @version-history
 *   v1.0.0 — 2026-03-18 — Initial inline panel implementation
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { listAgents } from '/js/services/agents.js';
import * as memoryService from '/js/services/memory.js';
import { listSubscriptions } from '/js/services/boards.js';
import { listInstances, listPackages } from '/js/services/packages.js';
import { Spinner } from './shared.js';

/* ───── Panel registry ───── */

const PANELS = {
  packages: { icon: '\u{1F4E6}', titleKey: 'profile.landing.packagesExt' },
  agents:   { icon: '\u{1F916}', titleKey: 'profile.tabs.agents' },
  memory:   { icon: '\u{1F9E0}', titleKey: 'profile.tabs.memory' },
  boards:   { icon: '\u{1F4CB}', titleKey: 'profile.tabs.boards' },
};

/* ───── Panel container ───── */

export function InlinePanel({ panelId, onClose, switchTab, session }) {
  const cfg = PANELS[panelId];

  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const panelRef = useRef(null);

  /* Smooth scroll into view after opening */
  useEffect(() => {
    if (panelRef.current) {
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [panelId]);

  if (!cfg) return null;

  return html`
    <div class="pf-inline-panel open" ref=${panelRef}>
      <div class="pf-inline-panel-header">
        <div class="pf-inline-panel-title">${cfg.icon} ${t(cfg.titleKey)}</div>
        <button class="pf-inline-panel-close" onClick=${onClose}>\u2715</button>
      </div>
      <div class="pf-inline-panel-body">
        ${panelId === 'agents'   && html`<${AgentsPanel} session=${session} switchTab=${switchTab} />`}
        ${panelId === 'memory'   && html`<${MemoryPanel} session=${session} switchTab=${switchTab} />`}
        ${panelId === 'boards'   && html`<${BoardsPanel} session=${session} switchTab=${switchTab} />`}
        ${panelId === 'packages' && html`<${PackagesPanel} session=${session} switchTab=${switchTab} />`}
      </div>
    </div>
  `;
}

/* ───── SSE hook (shared by all panels) ───── */

function useLiveUpdate(loadFn) {
  const ref = useRef(loadFn);
  ref.current = loadFn;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);
}

/* ───── Agents panel ───── */

function AgentsPanel({ session, switchTab }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await listAgents(session.owner);
      setAgents(Array.isArray(list) ? list.slice(0, 5) : []);
    } catch { setAgents([]); }
    setLoading(false);
  }, [session.owner]);

  useEffect(() => { load(); }, [load]);
  useLiveUpdate(load);

  if (loading) return html`<div class="pf-panel-loading"><${Spinner} /></div>`;

  return html`
    ${agents.length === 0 && html`
      <div class="pf-panel-empty">
        <div class="pf-panel-empty-icon">\u{1F517}</div>
        <div class="pf-panel-empty-text">${t('profile.landing.connectAgent')}</div>
      </div>
    `}
    ${agents.map(a => html`
      <div class="pf-view-item" key=${a.gaii}>
        <div class="pf-view-item-icon">
          <span class="pf-agent-dot${a.lastSeen ? ' pf-dot-online' : ''}"></span>
        </div>
        <div class="pf-view-item-content">
          <div class="pf-view-item-title">${escHtml(a.name || 'Agent')}</div>
          <div class="pf-view-item-desc">${escHtml(a.gaii || '')}</div>
        </div>
      </div>
    `)}
    <div class="pf-panel-footer">
      <a class="pf-panel-link" onClick=${(e) => { e.preventDefault(); switchTab('agents'); }}>
        ${t('profile.landing.viewAll')} \u2192
      </a>
    </div>
  `;
}

/* ───── Memory panel ───── */

function MemoryPanel({ switchTab }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await memoryService.listMemories();
      setItems(Array.isArray(list) ? list.slice(0, 3) : []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveUpdate(load);

  if (loading) return html`<div class="pf-panel-loading"><${Spinner} /></div>`;

  return html`
    ${items.length === 0 && html`
      <div class="pf-panel-empty">
        <div class="pf-panel-empty-icon">\u{1F9E0}</div>
        <div class="pf-panel-empty-text">${t('profile.memory.empty')}</div>
      </div>
    `}
    ${items.map(m => html`
      <div class="pf-view-item" key=${m.key}>
        <div class="pf-view-item-icon">\u{1F4C4}</div>
        <div class="pf-view-item-content">
          <div class="pf-view-item-title">${escHtml(m.key)}</div>
          ${m.visibility && html`
            <span class="pf-view-item-vis pf-vis-${m.visibility}">${m.visibility}</span>
          `}
        </div>
      </div>
    `)}
    <div class="pf-panel-footer">
      <a class="pf-panel-link" onClick=${(e) => { e.preventDefault(); switchTab('memory'); }}>
        ${t('profile.landing.viewAll')} \u2192
      </a>
    </div>
  `;
}

/* ───── Boards panel ───── */

function BoardsPanel({ switchTab }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await listSubscriptions();
      setBoards(Array.isArray(list) ? list.slice(0, 4) : []);
    } catch { setBoards([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveUpdate(load);

  if (loading) return html`<div class="pf-panel-loading"><${Spinner} /></div>`;

  return html`
    ${boards.length === 0 && html`
      <div class="pf-panel-empty">
        <div class="pf-panel-empty-icon">\u{1F4CB}</div>
        <div class="pf-panel-empty-text">${t('profile.boards.empty')}</div>
      </div>
    `}
    ${boards.map(b => html`
      <div class="pf-view-item" key=${b.id || b.boardId}>
        <div class="pf-view-item-content">
          <div class="pf-view-item-title">${escHtml(b.name || b.boardId || 'Board')}</div>
          ${b.description && html`<div class="pf-view-item-desc">${escHtml(b.description)}</div>`}
        </div>
      </div>
    `)}
    <div class="pf-panel-footer">
      <a class="pf-panel-link" onClick=${(e) => { e.preventDefault(); switchTab('boards'); }}>
        ${t('profile.landing.viewAll')} \u2192
      </a>
    </div>
  `;
}

/* ───── Packages panel ───── */

function PackagesPanel({ switchTab }) {
  const [instances, setInstances] = useState([]);
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [inst, pkgs] = await Promise.allSettled([
        listInstances(),
        listPackages(),
      ]);
      if (inst.status === 'fulfilled') {
        const list = inst.value?.data || inst.value || [];
        setInstances(Array.isArray(list) ? list.slice(0, 3) : []);
      }
      if (pkgs.status === 'fulfilled') {
        const list = pkgs.value?.data || pkgs.value || [];
        setAvailable(Array.isArray(list) ? list.slice(0, 3) : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveUpdate(load);

  if (loading) return html`<div class="pf-panel-loading"><${Spinner} /></div>`;

  return html`
    ${instances.length > 0 && html`
      <div class="pf-panel-subheading">${t('profile.landing.myApps')}</div>
      ${instances.map(i => html`
        <div class="pf-view-item" key=${i.id || i.packageGroupId}>
          <div class="pf-view-item-icon">\u{1F4E6}</div>
          <div class="pf-view-item-content">
            <div class="pf-view-item-title">${escHtml(i.label || i.packageGroupId || 'Package')}</div>
          </div>
        </div>
      `)}
    `}
    ${available.length > 0 && html`
      <div class="pf-panel-subheading pf-panel-sub-available">${t('profile.landing.ghostSectionTitle')}</div>
      ${available.map(p => html`
        <div class="pf-view-item pf-view-item-dim" key=${p.packageGroupId || p.name}>
          <div class="pf-view-item-icon">\u{1F4E6}</div>
          <div class="pf-view-item-content">
            <div class="pf-view-item-title">${escHtml(p.name || p.packageGroupId || 'Package')}</div>
            ${p.description && html`<div class="pf-view-item-desc">${escHtml(p.description)}</div>`}
          </div>
        </div>
      `)}
    `}
    ${instances.length === 0 && available.length === 0 && html`
      <div class="pf-panel-empty">
        <div class="pf-panel-empty-icon">\u{1F4E6}</div>
        <div class="pf-panel-empty-text">${t('profile.landing.installFirst')}</div>
      </div>
    `}
    <div class="pf-panel-footer">
      <a class="pf-panel-link" onClick=${(e) => { e.preventDefault(); switchTab('packages'); }}>
        ${t('profile.landing.viewAll')} \u2192
      </a>
    </div>
  `;
}
