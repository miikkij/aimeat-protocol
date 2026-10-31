/**
 * @file public/components/OverviewMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The overview drawn as a map: five lanes left to right (computers, agents, apps,
 *   knowledge, offerings), a card per thing, a curve per tie whose thickness is how much happened
 *   along it, and a question mark on each lane's head. A card that holds more (a computer's agents,
 *   an organism's workspaces, "+N more") opens in place and pushes the cards under it down; its head
 *   closes it again. Positions come from views/home/overview-model.js; this file draws them.
 *
 *   SELECTED, RELATED, DIM. The selected card wears the sun shadow. The cards one line away and the
 *   lines between keep their ink, the lines in coral; everything else fades, so a person sees what
 *   one thing touches without losing the rest of the picture.
 *
 *   POSITIONS ARE INLINE, EVERYTHING ELSE IS THE SHEET. A card's place and size change as groups
 *   open, so they are style properties (the List component does the same); the look is
 *   css/components/overview-map.css on the theme's tokens.
 * @structure OverviewMap({ map, sel, related, hotEdge, onPick, laneTitle, laneHelp, cardText })
 * @usage html`<${OverviewMap} map=${map} sel=${sel} related=${rel} onPick=${pick} laneTitle=${…} laneHelp=${…} cardText=${…} />`
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import { h } from 'preact';
import htm from 'htm';
import { HelpTip } from '/components/HelpTip.js';
import { LANE_KEYS, SIZES } from '/views/home/overview-model.js';

const html = htm.bind(h);

const place = (n) => `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`;

/**
 * @param {object} p
 * @param {{ nodes: any[], boxes: any[], edges: any[], hostH: number, laneW?: number, width?: number }} p.map  layoutMap's answer
 * @param {string|null} p.sel  the selected card id
 * @param {(id: string) => 'sel'|'rel'|'dim'|''} p.related  how a card reads against the selection
 * @param {(edge: any) => boolean} p.hotEdge  whether a line touches the selection or what is inside it
 * @param {(node: any) => void} p.onPick
 * @param {(lane: string) => { title: string, sub: string }} p.laneTitle
 * @param {(lane: string) => { term: string, label: string, mine?: string }} p.laneHelp
 * @param {(node: any) => { name: string, sub: string, num: string, numTitle: string, bar: number,
 *   live: boolean, quiet: boolean, sign: string|null, label: string }} p.cardText
 */
export function OverviewMap({ map, sel, related, hotEdge, onPick, laneTitle, laneHelp, cardText }) {
  const laneW = map.laneW ?? SIZES.laneW;
  const width = map.width ?? ((LANE_KEYS.length - 1) * SIZES.laneX + SIZES.laneW);
  return html`
    <div class="ovm" style=${`--ovm-w:${width}px;--ovm-lane:${laneW}px`}>
      <div class="ovm-lanes">
        ${LANE_KEYS.map((lane) => {
          const head = laneTitle(lane);
          const help = laneHelp(lane);
          return html`
            <div class="ovm-lane" key=${lane}>
              <div class="ovm-lane-row">
                <h3 class="poster-record-title ovm-lane-title">${head.title}</h3>
                <${HelpTip} term=${help.term} label=${help.label} mine=${help.mine} />
              </div>
              <p class="ovm-lane-sub">${head.sub}</p>
            </div>`;
        })}
      </div>
      <div class="ovm-host" style=${`height:${map.hostH}px`}>
        <svg class="ovm-edges" width=${width} height=${map.hostH} viewBox=${`0 0 ${width} ${map.hostH}`} aria-hidden="true">
          ${map.edges.map((e) => {
            const hl = sel && hotEdge(e);
            const cls = `ovm-edge${hl ? ' ovm-edge--hl' : sel ? ' ovm-edge--dim' : ''}`;
            const w = (1 + Math.min(e.weight > 0 ? Math.log2(e.weight + 1) : 0, 8) * 0.7 + (hl ? 1 : 0)).toFixed(1);
            return html`<path key=${`${e.from}>${e.to}`} class=${cls} d=${e.d} stroke-width=${w} />`;
          })}
        </svg>
        ${map.boxes.map((b) => html`
          <div key=${`box:${b.id}`} class=${`ovm-box${related(b.id) === 'sel' ? ' is-sel' : ''}${related(b.id) === 'dim' ? ' is-dim' : ''}`} style=${place(b)}></div>`)}
        ${map.nodes.map((n) => {
          const c = cardText(n);
          const r = related(n.id);
          const cls = ['ovm-node', `ovm-node--${n.role}`, c.quiet ? 'is-quiet' : '', r === 'sel' ? 'is-sel' : '', r === 'dim' ? 'is-dim' : ''].filter(Boolean).join(' ');
          return html`
            <button type="button" key=${n.id} class=${cls} style=${place(n)} onClick=${() => onPick(n)}
              aria-pressed=${r === 'sel' ? 'true' : 'false'} aria-expanded=${c.sign ? (c.sign === '−' ? 'true' : 'false') : undefined}
              aria-label=${c.label}>
              <span class="ovm-line">
                ${c.live ? html`<span class="ovm-dot" aria-hidden="true"></span>` : null}
                <span class="ovm-name">${c.name}</span>
                ${n.role === 'row' ? html`<span class="ovm-num" title=${c.numTitle}>${c.num}</span>` : null}
                ${c.sign ? html`<span class=${`ovm-sign${c.sign === '−' ? ' is-open' : ''}`} aria-hidden="true">${c.sign}</span>` : null}
              </span>
              ${n.role === 'card' ? html`
                <span class="ovm-sub">${c.sub}</span>
                <span class="ovm-line">
                  <span class="ovm-bar" aria-hidden="true"><span class="ovm-bar-fill" style=${`width:${c.bar}%`}></span></span>
                  <span class="ovm-num" title=${c.numTitle}>${c.num}</span>
                </span>` : null}
              ${n.role === 'head' ? html`<span class="ovm-sub">${c.sub}</span>` : null}
            </button>`;
        })}
      </div>
    </div>`;
}

export default OverviewMap;
