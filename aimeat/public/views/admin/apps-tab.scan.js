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
 * @structure CopyScan · shot
 * @usage html`<${CopyScan} result=${scan} apps=${apps} scanning=${false} onScan=${fn} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — On the library components (page group G5): the section is a Section with
 *     its scan action, the two findings two columns of Readings under their bold headings, the
 *     picture pair the Shots component, the notes Notes. The file writes no class and no style.
 *   v1.1.0 — 2026-09-13 — Compose the shared scan heading and external footer spacing.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, num } from './shared.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { Shots } from '/components/Shots.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { CardGrid } from '/components/Card.js';
import { Stack, Space } from '/components/Layout.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.' + key, params);

/** One app's picture, with its name under it. Missing is normal: not every app has a screenshot. */
function shot(key, app, filename, caption) {
  return {
    key,
    src: app?.screenshot_url || null,
    none: A('scan.noShot'),
    caption,
    sub: `${escHtml(app ? (app.manifest?.name || app.filename) : filename)} · ${escHtml(app?.owner || A('scan.unknownOwner'))}`,
  };
}

export function CopyScan({ result, apps, scanning, onScan, number }) {
  const byFile = new Map((apps || []).map(a => [a.filename, a]));
  const hits = result?.watermarkHits ?? [];
  const pairs = result?.suspiciousPairs ?? [];

  return html`
    <${Section} id="adm-ap-scan" num=${number} title=${A('scan.title')}
      doors=${html`<${Action} small soft disabled=${scanning} onClick=${onScan}>
        ${scanning ? A('scan.scanning') : A('scan.run', { n: num((apps || []).length) })}
      <//>`}>
      <${Note} kind="lead">${A('scan.lead')}<//>

      ${!result && html`<${Note} kind="quiet">${A('scan.notYet')}<//>`}

      ${result && html`
        <${CardGrid} cols="two">
          <${Stack} gap="small">
            <b>${A('scan.evidence', { n: num(hits.length) })}</b>
            ${hits.length === 0 && html`<${Note} kind="quiet">${A('scan.noEvidence')}<//>`}
            <${Readings} rows=${hits.map((w, i) => ({
              key: i,
              name: html`${escHtml(w.inApp)} ${A('scan.carries')} ${escHtml(w.watermarkOf)}`,
              why: A('scan.servedTo', { who: escHtml(w.viewer), when: dt(w.servedAt) }),
              value: '',
              last: i === hits.length - 1,
            }))} />
            ${hits.length > 0 && html`
              <${Shots} items=${[
                shot('original', byFile.get(hits[0].watermarkOf), hits[0].watermarkOf, A('scan.theOriginal')),
                shot('copy', byFile.get(hits[0].inApp), hits[0].inApp, A('scan.theCopy')),
              ]} />`}
          <//>

          <${Stack} gap="small">
            <b>${A('scan.signal', { n: num(pairs.length) })}</b>
            ${pairs.length === 0 && html`<${Note} kind="quiet">${A('scan.noSignal')}<//>`}
            <${Readings} rows=${pairs.map((p, i) => {
              const a = byFile.get(p.a);
              const b = byFile.get(p.b);
              const sameOwner = a && b && a.owner === b.owner;
              return {
                key: i,
                name: html`${escHtml(p.a)} ${A('scan.and')} ${escHtml(p.b)}`,
                why: sameOwner ? A('scan.sameOwner', { who: escHtml(a.owner) }) : A('scan.differentOwners'),
                value: `${Math.round((p.similarity || 0) * 100)} %`,
                last: i === pairs.length - 1,
              };
            })} />
          <//>
        <//>
        <${Space} above="medium">
          <${Note}>${A('scan.footer', { n: num(result.scanned || 0) })}<//>
        <//>`}
    <//>`;
}
