/**
 * @file public/views/admin/apps-tab.kits.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin Apps tab's style kits section: the node's default kit, the rules this node
 *   runs kits by, and the kits for the whole node that wait for the operator to publish them.
 *
 *   THE NODE'S DEFAULT IS THE LAST ONE IN LINE. A new app starts from the organism's kit, else the
 *   person's own, else this one (services/design-book/kit-defaults.ts), so choosing it changes only
 *   the apps of people and organisms that chose nothing. The rules are written out because "who may
 *   do this, and does it cost anything" was the question this section was made to answer.
 *
 *   The section's door copies a prompt for the operator's own AI, which does the same work in chat
 *   (aimeat_designbook_kit, _search, _status, _kit_default).
 *
 *   It loads on its own (GET /v1/designbook/kits/defaults and GET /v1/designbook?kind=kit) and
 *   again on the aimeat-live-update event.
 * @structure NodeKits({ number, onError, onDone })
 * @usage html`<${NodeKits} number=${n()} onError=${showError} onDone=${showOk} />`
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Label } from '/components/Mark.js';
import { Select } from '/components/Select.js';
import { Space } from '/components/Layout.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.kits.' + key, params);
const RULES = ['own', 'organism', 'node', 'nodeKit', 'cost'];

/**
 * The prompt the operator gives their own AI to do this section's work in chat. The rules are how
 * the node works, not settings, so the prompt says so instead of offering to change them.
 */
function kitsPrompt() {
  return `Help me look after the style kits on my AIMEAT server through the MCP tools. I am its operator.

A style kit is the whole look a new app starts from. A new app takes the kit of the shared place it is built for, else its maker's own, else the one I choose for everyone on this server.

What you can do for me:
- aimeat_designbook_kit { view: "defaults" } shows the kit for everyone on this server, my own, and the kits of the shared places I run.
- aimeat_designbook_search { kind: "kit" } lists the kits. A kit for everyone (reach "node") with status "proposed" waits for me; aimeat_designbook_get { id } reads one whole, and its preview_url shows it.
- aimeat_designbook_status { id, status: "published" } publishes a waiting kit for everyone; status "retired" takes one off the shelf.
- aimeat_designbook_kit_default { node: true, kit } chooses the kit for everyone on this server; { node: true, clear: true } removes it.

Who may do what is how the server works, not a setting: every person chooses their own kit for free, a shared place's owners and admins choose its kit, I choose the one for everyone, and a kit for everyone publishes itself when it comes from an app its owner said turned out well. If I ask to change one of those rules, say that it cannot be changed here.

Start by showing me which kit everyone gets now and what waits for me, then ask what I want.`;
}

export function NodeKits({ number, onError, onDone }) {
  const [view, setView] = useState(null);       // GET /v1/designbook/kits/defaults; false when it failed
  const [kits, setKits] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, list] = await Promise.all([apiGet('/v1/designbook/kits/defaults'), apiGet('/v1/designbook?kind=kit&limit=200')]);
      setView(d?.data || false);
      setKits(list?.data?.parts || []);
    } catch (err) { swallowed('admin apps: kits', err); setView(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const forNode = kits.filter((k) => k.reach === 'node');
  const published = forNode.filter((k) => k.status === 'published' || k.status === 'aging');
  const waiting = forNode.filter((k) => k.status === 'proposed');

  async function chooseNode(kit) {
    setBusy(true);
    try {
      await apiPut('/v1/designbook/kits/default', { node: true, kit: kit || null });
      onDone?.(kit ? A('savedToast') : A('clearedToast'));
      await load();
    } catch (e) { onError?.(e?.error?.message || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function publish(kit) {
    setBusy(true);
    try {
      await apiPost(`/v1/designbook/${encodeURIComponent(kit.id)}/status`, { status: 'published' });
      onDone?.(A('publishedToast', { title: kit.title }));
      await load();
    } catch (e) { onError?.(e?.error?.message || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  const node = view && view.node;
  return html`
    <${Section} id="adm-ap-kits" num=${number} title=${A('title')} count=${waiting.length || ''}
      doors=${html`<${Action} small soft copy=${kitsPrompt()} copiedLabel=${A('promptCopied')}>${A('promptCopy')}<//>`}>
      <${Note} kind="lead">${A('lead')}<//>
      ${view === null ? html`<${Note} kind="loading">${t('dashboard.loading')}<//>` : null}
      ${view === false ? html`<${Note} kind="quiet">${A('failed')}<//>` : null}
      ${view ? html`
        <${List} cols="name-doors" keepCols>
          <${Row}>
            <${Name} meta=${node ? (node.unavailable ? A('unavailable', { kit: node.kit }) : A('nodeMeta')) : A('noneMeta')}>${A('nodeDefault')}<//>
            <${Doors}>
              <${Select} fit ariaLabel=${A('nodeDefault')} value=${node && !node.unavailable ? node.kit : ''}
                disabled=${busy || !view.may_set_node} onChange=${chooseNode}
                options=${[['', A('none')], ...published.map((k) => [k.id, k.title])]} />
            <//>
          <//>
        <//>
        ${published.length ? null : html`<${Note} kind="quiet">${A('noNodeKits')}<//>`}

        <${Space} above="section"><${Label} block>${A('rulesTitle')}<//><//>
        <${List} cols="name-words" keepCols>
          ${RULES.map((r) => html`<${Row} key=${r}><${Name}>${A('rule.' + r + '.who')}<//><${Cell}>${A('rule.' + r + '.what')}<//><//>`)}
        <//>

        <${Space} above="section"><${Label} block>${A('waitingTitle')}<//><//>
        <${List} cols="name-doors" keepCols empty=${A('waitingNone')}>
          ${waiting.map((k) => html`
            <${Row} key=${k.id}>
              <${Name} meta=${A('waitingMeta', { who: String(k.proposed_by || '').replace(/@.*$/, ''), summary: k.summary })}>${k.title}<//>
              <${Doors}>
                ${k.preview_url ? html`<${Action} small soft href=${k.preview_url} newTab>${A('preview')}<//>` : null}
                <${Action} small disabled=${busy || !view.may_set_node} onClick=${() => publish(k)}>${A('publish')}<//>
              <//>
            <//>`)}
        <//>` : null}
    <//>`;
}
