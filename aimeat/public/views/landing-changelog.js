/**
 * @file landing-changelog.js
 * @description The node's change log on the landing page: what the people running this node
 *   shipped, newest first. Folded by default so it costs one line — the fold shows the freshest
 *   entry, and opening it reveals the scrollable history. Data is a plain file (/changelog.json)
 *   that grows with the work, so shipping a change and announcing it are the same edit; no admin
 *   screen, no table. An entry's title/body is either a string or { en, fi }.
 * @structure default export NodeChangeLog() — sibling component imported by landing.js;
 *   pick() language resolver · fmtDate() · KIND labels.
 * @usage import NodeChangeLog from './landing-changelog.js'; <${NodeChangeLog} />
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial: folded change-log section fed by public/changelog.json.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale, onLocaleChange } from '/js/i18n.js';
import { Collapsible } from '/components/Collapsible.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** An entry field is a plain string, or { en, fi } when the wording deserves both languages. */
function pick(value, lang) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.en || Object.values(value)[0] || '';
}

// The APP's language decides the format, not the browser's: a Finnish reader on a US-locale
// browser was getting 7/31/2026, which reads as a different day here (and as noise anywhere).
function fmtDate(iso, lang) {
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString(lang === 'fi' ? 'fi-FI' : 'en-GB');
  } catch (err) { swallowed('landing-changelog: fmtDate', err); return iso; }
}

const KIND_LABEL = {
  feature: () => tr('landing.logKindFeature', 'New'),
  fix: () => tr('landing.logKindFix', 'Fixed'),
  security: () => tr('landing.logKindSecurity', 'Security'),
  notice: () => tr('landing.logKindNotice', 'Notice'),
};

export default function NodeChangeLog() {
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(false);
  // The entries carry their own translations, so a language switch has to re-render them —
  // t() alone would only fix the chrome and leave the announcements in the previous language.
  const [lang, setLang] = useState(getLocale());
  useEffect(() => onLocaleChange(() => setLang(getLocale())), []);

  useEffect(() => {
    // window.__B is the server's "?v=BUILD_ID" cache-buster: a deploy that adds an entry must show
    // it immediately, and a plain /changelog.json can otherwise sit in the browser cache.
    fetch('/changelog.json' + (window.__B || ''))
      .then(r => (r.ok ? r.json() : null))
      .then(j => setEntries(Array.isArray(j?.entries) ? j.entries : []))
      .catch(err => { swallowed('landing-changelog: load', err); });
  }, []);

  // Nothing to announce yet: render nothing rather than an empty box that reads as broken.
  if (entries.length === 0) return null;

  const newest = entries[0];

  return html`
    <section class="ld-log">
      <${Collapsible}
        title=${html`
          <span class="ld-log-head">
            <span class="ld-log-label">${tr('landing.logTitle', "What's new on this node")}</span>
            <span class="ld-log-latest">
              <span class="ld-log-date">${fmtDate(newest.date, lang)}</span>
              <span class=${'ld-log-kind ld-log-kind-' + (newest.kind || 'notice')}>
                ${(KIND_LABEL[newest.kind] || KIND_LABEL.notice)()}
              </span>
              <span class="ld-log-newest">${pick(newest.title, lang)}</span>
            </span>
          </span>
        `}
        open=${open} onToggle=${() => setOpen(o => !o)}>
        <div class="ld-log-list">
          ${entries.map((e, i) => html`
            <article key=${(e.date || '') + i} class="ld-log-item">
              <div class="ld-log-meta">
                <span class="ld-log-date">${fmtDate(e.date, lang)}</span>
                <span class=${'ld-log-kind ld-log-kind-' + (e.kind || 'notice')}>
                  ${(KIND_LABEL[e.kind] || KIND_LABEL.notice)()}
                </span>
                ${e.version ? html`<span class="ld-log-version">v${e.version}</span>` : ''}
              </div>
              <h3 class="ld-log-title">${pick(e.title, lang)}</h3>
              ${pick(e.body, lang) ? html`<p class="ld-log-body">${pick(e.body, lang)}</p>` : ''}
            </article>
          `)}
        </div>
      <//>
    </section>
  `;
}
