/**
 * @file atelier/agentic.js
 * @description Agentness in the running app (TARGET-074 phase 6): the DELEGATE handle — "let AI
 *   handle it" on any declared piece of work, handing a task to one of the owner's own agents
 *   through the agents library (its spend guard asks before anything is spent) and showing the
 *   outcome in the same view — and the AGENT ACTIVITY strip, which shows what the agents have
 *   been doing as a timeline, because ownership is the product and the UI makes it visible.
 *
 *   BOTH DEGRADE WITH WORDS. A page without the agents library, or an owner with no agents,
 *   gets a designed line saying so — never a dead button and never a silent absence.
 * @structure delegate(spec) → { el, set, destroy } · agentActivity(spec) → { el, refresh, destroy }
 * @usage
 *   AIMEAT.atelier.delegate({ target: host, agent: 'secretary',
 *     task: { title: 'Sort the inbox', description: 'Mark the overdue errands done.' } });
 *   AIMEAT.atelier.agentActivity({ target: host, agent: 'secretary' });
 * @version-history
 *   v0.1.0 — 2026-08-28 — Initial (TARGET-074 phase 6, the delegate and activity affordances).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { timeline } from './timeline.js';
import { emptyState } from './state.js';

/** The agents library, when the page carries it. */
function agentsNs() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.agents && typeof ns.agents.createTask === 'function' ? ns.agents : null;
}

/**
 * The "let AI handle it" handle: one button, one declared task, one of the owner's own agents.
 * The agents library's own confirm guard asks the person before the task is created, and the
 * outcome lands back in this element — delegation stays visible from start to finish.
 * @param {{
 *   target?: string|Element, label?: string,
 *   agent: string,
 *   task: { title?: string, description: string },
 *   onDone?: (result: { task: any, deliverable: any }) => void,
 * }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function delegate(spec) {
  const status = el('span', { class: 'ak-delegate__status', 'aria-live': 'polite' });
  const btn = /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button', class: 'ak-btn ak-btn--ghost',
    on: { click: run },
  }, '✦ ' + (spec.label || t('delegateGo'))));
  const root = el('div', { class: 'ak-root ak-delegate' }, [btn, status]);
  if (spec.target) resolve(spec.target).appendChild(root);
  enter(root);

  let stopWatch = null;

  async function run() {
    const agents = agentsNs();
    if (!agents) {
      status.textContent = t('delegateNoAgents');
      return;
    }
    btn.disabled = true;
    status.textContent = '…';
    try {
      const created = await agents.createTask(spec.agent, {
        title: spec.task.title, description: spec.task.description,
      }, { confirm: true });
      const id = created && (created.id || created.task_id);
      status.textContent = t('delegateHanded') + ' (' + spec.agent + ')';
      if (id && typeof agents.watch === 'function') {
        stopWatch = agents.watch(spec.agent, id, function (task) {
          if (task.status === 'done') {
            status.textContent = t('ready');
            btn.disabled = false;
            if (stopWatch) { stopWatch(); stopWatch = null; }
            if (spec.onDone) spec.onDone({ task: task, deliverable: null });
          } else if (task.status === 'failed' || task.status === 'stalled') {
            status.textContent = t('delegateFailed');
            btn.disabled = false;
            if (stopWatch) { stopWatch(); stopWatch = null; }
          }
        });
      } else {
        btn.disabled = false;
      }
    } catch (err) {
      const code = err && /** @type {any} */ (err).code;
      status.textContent = code === 'SPEND_CANCELLED' ? t('cancel') + '.' : t('delegateFailed');
      btn.disabled = false;
    }
  }

  return {
    el: root,
    destroy() {
      if (stopWatch) stopWatch();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * What the agents have been doing, as the kit's own timeline — task titles and states from the
 * agents library, newest first. Ownership is the product; this strip makes the working visible.
 * @param {{ target?: string|Element, agent: string, limit?: number }} spec
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function agentActivity(spec) {
  const root = el('div', { class: 'ak-root ak-agentactivity' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let inner = null;

  async function refresh() {
    const agents = agentsNs();
    if (inner && inner.destroy) inner.destroy();
    clear(root);
    if (!agents) {
      inner = emptyState({ target: root, tone: 'quiet', title: t('agentActivityNone'), hint: t('delegateNoAgents') });
      return;
    }
    let tasks;
    try {
      tasks = await agents.tasks(spec.agent, {});
    } catch (err) {
      console.warn('aimeat-atelier: agent activity could not be read', err);
      inner = emptyState({ target: root, tone: 'quiet', title: t('agentActivityNone') });
      return;
    }
    const rows = (tasks || []).slice(0, spec.limit || 8).map(function (task) {
      return {
        id: String(task.id || task.title),
        ts: task.updated_at || task.created_at || new Date().toISOString(),
        title: task.title || task.description || '',
        sub: task.status,
        tone: task.status === 'failed' ? 'err' : task.status === 'done' ? 'ok' : 'warn',
      };
    });
    if (!rows.length) {
      inner = emptyState({ target: root, tone: 'quiet', title: t('agentActivityNone') });
      return;
    }
    inner = timeline({ target: root, items: rows });
  }

  refresh();
  return {
    el: root,
    refresh: refresh,
    destroy() {
      if (inner && inner.destroy) inner.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
