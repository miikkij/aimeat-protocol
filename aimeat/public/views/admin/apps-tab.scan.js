/**
 * @file public/views/admin/apps-tab.scan.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The copy scan as a section of the page rather than a card that pops up and has to be
 *   closed (design canvas "AIMEAT Admin Applications", direction A).
 *
 *   TWO FINDINGS, AND ONLY ONE IS EVIDENCE. A watermark hit means this site served app A to a named
 *   person and app B now carries that exact fingerprint. A close pair is a signal: two apps whose
 *   bytes are alike with no fork link between them, which a shared template explains as easily as a
 *   copy does. The old card printed both as one list of mono lines.
 *
 *   A HIT IS SHOWN AS THE TWO PICTURES IT IS, side by side, which is the fastest way to tell a copy
 *   from a coincidence. That is the one idea taken from the other direction, and it is why the
 *   admin listing now carries `screenshot_url`.
 * @structure CopyScan
 * @usage html`<${CopyScan} result=${scan} apps=${apps} scanning=${false} onScan=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, num } from './shared.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.' + key, params);

/** One app's picture, with its name under it. Missing is normal: not every app has a screenshot. */
function Shot({ app, filename, caption }) {
  return html`
    <span class="adm-ap-shot">
      ${app?.screenshot_url
        ? html`<img src=${app.screenshot_url} alt="" loading="lazy" />`
        : html`<span class="adm-ap-shot-none">${A('scan.noShot')}</span>`}
      <span class="adm-ap-shot-cap">
        ${caption}
        <span>${escHtml(app ? (app.manifest?.name || app.filename) : filename)} · ${escHtml(app?.owner || A('scan.unknownOwner'))}</span>
      </span>
    </span>`;
}

export function CopyScan({ result, apps, scanning, onScan, number }) {
  const byFile = new Map((apps || []).map(a => [a.filename, a]));
  const hits = result?.watermarkHits ?? [];
  const pairs = result?.suspiciousPairs ?? [];

  return html`
    <section class="og-sec" id="adm-ap-scan">
      <div class="og-sec-h"><h2>${A('scan.title')}<small>${number}</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" disabled=${scanning} onClick=${onScan}>
            ${scanning ? A('scan.scanning') : A('scan.run', { n: num((apps || []).length) })}
          </button>
        </div></div>
      <p class="adm-ap-lead">${A('scan.lead')}</p>

      ${!result && html`<p class="adm-ap-note">${A('scan.notYet')}</p>`}

      ${result && html`
        <div class="adm-ap-scan">
          <div>
            <p class="adm-why"><b>${A('scan.evidence', { n: num(hits.length) })}</b></p>
            ${hits.length === 0 && html`<p class="adm-ap-note">${A('scan.noEvidence')}</p>`}
            ${hits.map((w, i) => html`
              <div key=${i} class=${'adm-ap-hit' + (i === hits.length - 1 ? ' adm-ap-hit--last' : '')}>
                <span>
                  <b>${escHtml(w.inApp)}</b> ${A('scan.carries')} <b>${escHtml(w.watermarkOf)}</b>
                  <span class="adm-why">${A('scan.servedTo', { who: escHtml(w.viewer), when: dt(w.servedAt) })}</span>
                </span>
              </div>`)}
            ${hits.length > 0 && html`
              <div class="adm-ap-pair">
                <${Shot} app=${byFile.get(hits[0].watermarkOf)} filename=${hits[0].watermarkOf} caption=${A('scan.theOriginal')} />
                <${Shot} app=${byFile.get(hits[0].inApp)} filename=${hits[0].inApp} caption=${A('scan.theCopy')} />
              </div>`}
          </div>

          <div>
            <p class="adm-why"><b>${A('scan.signal', { n: num(pairs.length) })}</b></p>
            ${pairs.length === 0 && html`<p class="adm-ap-note">${A('scan.noSignal')}</p>`}
            ${pairs.map((p, i) => {
              const a = byFile.get(p.a);
              const b = byFile.get(p.b);
              const sameOwner = a && b && a.owner === b.owner;
              return html`
                <div key=${i} class=${'adm-ap-hit' + (i === pairs.length - 1 ? ' adm-ap-hit--last' : '')}>
                  <span>
                    <b>${escHtml(p.a)}</b> ${A('scan.and')} <b>${escHtml(p.b)}</b>
                    <span class="adm-why">${sameOwner ? A('scan.sameOwner', { who: escHtml(a.owner) }) : A('scan.differentOwners')}</span>
                  </span>
                  <span class="adm-mval">${Math.round((p.similarity || 0) * 100)} %</span>
                </div>`;
            })}
          </div>
        </div>
        <p class="adm-ap-note" style="margin-top: 12px">
          ${A('scan.footer', { n: num(result.scanned || 0) })}
        </p>`}
    </section>`;
}
