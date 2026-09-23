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
 * @structure Shot · CopyScan
 * @usage html`<${CopyScan} result=${scan} apps=${apps} scanning=${false} onScan=${fn} />`
 * @version-history
 *   v2.0.0 — 2026-09-22 — Composed from the shared component set: the shared section with the scan
 *     as its action and the lead as its description, the findings as list rows in two columns, the
 *     picture pair in columns, each screenshot in the shared picture surface.
 *   v1.1.0 — 2026-09-13 — Compose the shared scan heading and external footer spacing.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, num } from './shared.js';
import { Section, Columns, Stack, ListRow, Surface, Action, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.' + key, params);

/** One app's picture, with its name under it. Missing is normal: not every app has a screenshot. */
function Shot({ app, filename, caption }) {
  return html`
    <${Stack} density="compact">
      ${app?.screenshot_url
        ? html`<${Surface} kind="picture"><img src=${app.screenshot_url} alt="" loading="lazy" /><//>`
        : html`<${Surface} kind="box"><${Text} tone="muted">${A('scan.noShot')}<//><//>`}
      <${Text} kind="label">${caption}<//>
      <${Text} kind="caption">${escHtml(app ? (app.manifest?.name || app.filename) : filename)} · ${escHtml(app?.owner || A('scan.unknownOwner'))}<//>
    <//>`;
}

export function CopyScan({ result, apps, scanning, onScan, number }) {
  const byFile = new Map((apps || []).map(a => [a.filename, a]));
  const hits = result?.watermarkHits ?? [];
  const pairs = result?.suspiciousPairs ?? [];

  return html`
    <${Section} id="adm-ap-scan" title=${A('scan.title')} count=${number} description=${A('scan.lead')}
      actions=${html`<${Action} disabled=${scanning} onClick=${onScan}>
        ${scanning ? A('scan.scanning') : A('scan.run', { n: num((apps || []).length) })}
      <//>`}>

      ${!result && html`<${Text} kind="caption" tone="muted">${A('scan.notYet')}<//>`}

      ${result && html`
        <${Stack}>
          <${Columns} layout="equal" collapse=${640}>
            <${Stack} density="compact">
              <${Text}><strong>${A('scan.evidence', { n: num(hits.length) })}</strong><//>
              ${hits.length === 0 && html`<${Text} kind="caption" tone="muted">${A('scan.noEvidence')}<//>`}
              ${hits.map((w, i) => html`
                <${ListRow} key=${i} density="compact" detailKind="text"
                  name=${html`${escHtml(w.inApp)} ${A('scan.carries')} ${escHtml(w.watermarkOf)}`}
                  detail=${A('scan.servedTo', { who: escHtml(w.viewer), when: dt(w.servedAt) })} />`)}
              ${hits.length > 0 && html`
                <${Columns} layout="equal" collapse=${560}>
                  <${Shot} app=${byFile.get(hits[0].watermarkOf)} filename=${hits[0].watermarkOf} caption=${A('scan.theOriginal')} />
                  <${Shot} app=${byFile.get(hits[0].inApp)} filename=${hits[0].inApp} caption=${A('scan.theCopy')} />
                <//>`}
            <//>

            <${Stack} density="compact">
              <${Text}><strong>${A('scan.signal', { n: num(pairs.length) })}</strong><//>
              ${pairs.length === 0 && html`<${Text} kind="caption" tone="muted">${A('scan.noSignal')}<//>`}
              ${pairs.map((p, i) => {
                const a = byFile.get(p.a);
                const b = byFile.get(p.b);
                const sameOwner = a && b && a.owner === b.owner;
                return html`
                  <${ListRow} key=${i} density="compact" detailKind="text"
                    name=${html`${escHtml(p.a)} ${A('scan.and')} ${escHtml(p.b)}`}
                    detail=${sameOwner ? A('scan.sameOwner', { who: escHtml(a.owner) }) : A('scan.differentOwners')}
                    value=${`${Math.round((p.similarity || 0) * 100)} %`} />`;
              })}
            <//>
          <//>
          <${Text} kind="caption" tone="muted">${A('scan.footer', { n: num(result.scanned || 0) })}<//>
        <//>`}
    <//>`;
}
