/**
 * @file glossary.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The glossary page: the AIMEAT vocabulary grouped by area, with a filter box.
 *   Reads /v1/glossary.json, which renders the same registry the markdown and JSON-LD surfaces
 *   render, so the page cannot drift from what an agent is told.
 *   A term a person meets shows its plain sentence in the reader's language first (`plain`, from
 *   ?lang=), and the English technical definition under it for builders. Area titles are the
 *   locale's `glossary.area.<id>`, with the registry's English title as the fallback.
 * @usage routed at /v1/glossary by spa.html
 * @version-history
 *   v1.1.0 — 2026-10-03 — The plain sentence first, in the reader's language, and the technical
 *     definition under it; area titles from the locales; reloads when the language changes.
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 06)
 */
import { h } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { tOr, getLocale, onLocaleChange } from '/js/i18n.js';

const tr = (key, fallback) => tOr(key, fallback);

export default function Glossary() {
  const [terms, setTerms] = useState([]);
  const [areas, setAreas] = useState([]);
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState(false);
  const [lang, setLang] = useState(getLocale());

  useEffect(() => onLocaleChange((l) => setLang(l)), []);

  useEffect(() => {
    let live = true;
    fetch(`/v1/glossary.json?lang=${encodeURIComponent(lang)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!live) return;
        setTerms(body?.data?.terms ?? []);
        setAreas(body?.data?.areas ?? []);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [lang]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (
    needle
      ? terms.filter((x) => x.term.toLowerCase().includes(needle)
        || x.definition.toLowerCase().includes(needle)
        || (x.plain ?? '').toLowerCase().includes(needle)
        || (x.aka ?? []).some((a) => a.toLowerCase().includes(needle)))
      : terms
  ), [terms, needle]);

  return html`
    <div class="gl-page">
      <h1 class="gl-title">${tr('glossary.title', 'Glossary')}</h1>
      <p class="gl-lede">${tr('glossary.lede', 'The words AIMEAT uses, each one first in plain words and then defined exactly.')}</p>

      <input class="gl-filter" type="search" value=${q}
        placeholder=${tr('glossary.filter', 'Filter terms')}
        aria-label=${tr('glossary.filter', 'Filter terms')}
        onInput=${(e) => setQ(e.target.value)} />

      ${failed && html`<p class="gl-empty">${tr('glossary.failed', 'The glossary could not be loaded.')}</p>`}
      ${!failed && terms.length === 0 && html`<p class="gl-empty">${tr('glossary.loading', 'Loading…')}</p>`}
      ${!failed && terms.length > 0 && shown.length === 0 && html`
        <p class="gl-empty">${tr('glossary.noMatch', 'No term matches that.')}</p>`}

      ${areas.map((area) => {
        const inArea = shown.filter((x) => x.area === area.id);
        if (inArea.length === 0) return null;
        return html`
          <section key=${area.id} class="gl-area">
            <h2 class="gl-area-title">${tr(`glossary.area.${area.id}`, area.label || area.title)}</h2>
            <dl class="gl-list">
              ${inArea.map((x) => html`
                <div key=${x.term} class="gl-entry" id=${`term-${x.id || x.term.toLowerCase().replace(/\s+/g, '-')}`}>
                  <dt class="gl-term">
                    ${x.term}
                    ${x.form && html`<code class="gl-form">${x.form}</code>`}
                  </dt>
                  <dd class="gl-def">
                    ${x.plain
                      ? html`
                        <p class="gl-plain">${x.plain}</p>
                        <p class="gl-example gl-technical">${tr('glossary.technical', 'Technical definition')}: <span lang="en">${x.definition}</span></p>`
                      : html`<p lang="en">${x.definition}</p>`}
                    ${x.example && html`<p class="gl-example">${tr('glossary.example', 'For example')}: <code>${x.example}</code></p>`}
                    ${x.seeAlso?.length > 0 && html`
                      <p class="gl-see">${tr('glossary.seeAlso', 'See also')}: ${x.seeAlso.join(', ')}</p>`}
                  </dd>
                </div>
              `)}
            </dl>
          </section>
        `;
      })}

      <p class="gl-machine">
        ${tr('glossary.machineReadable', 'Machine-readable')}:
        <a href=${`/v1/glossary.json?lang=${encodeURIComponent(lang)}`}>JSON</a> · <a href=${`/v1/glossary.md?lang=${encodeURIComponent(lang)}`}>Markdown</a>
      </p>
    </div>
  `;
}
