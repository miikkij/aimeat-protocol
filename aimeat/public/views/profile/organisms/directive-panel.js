/**
 * @file public/views/profile/organisms/directive-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's directive on its home page: what the organism's creators ask every
 *   member's AI to do about reporting (services/organism/directives.ts), as written, how often the AI
 *   asks, and for a creator or admin how the members answered, as counts and never by name, with a
 *   line when nobody has answered in 60 days. The directive is made and changed in chat, so the panel
 *   says so first: who changes it and how, the sentence to say to one's own AI, and the question mark
 *   (concept.organismDirective) that explains what a directive is. Composed from library components.
 * @structure DirectivePanel({ org, directives, summary, canEdit })
 * @usage html`<${DirectivePanel} org=${org} directives=${d} summary=${s} canEdit=${canEdit} />`
 * @version-history
 *   v1.1.0 — 2026-11-20 — The panel says how the directive is changed: by the creators' own AI in chat
 *     (a lead line, the prompt that changes it, the question mark concept.organismDirective), and a
 *     member reads how to change their answer. A member's own answer is worded in the second person.
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, brief §8).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date } from '/js/format.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { PromptCard } from '/components/PromptCard.js';
import { SettingBox } from '/components/Box.js';
import { HelpTip } from '/components/HelpTip.js';
import { Stack, Row } from '/components/Layout.js';

const html = htm.bind(h);
const x = (k, v) => t('organisms.directive.' + k, v);

export function DirectivePanel({ org, directives, summary, canEdit }) {
  const own = (directives?.items || []).find((d) => d.level === 'organism') || summary?.directive || null;
  const prompt = x(own ? 'promptChange' : 'promptNew', { name: org.name });
  return html`
    <${Stack} gap="section">
      <${Row} align="end">
        <${Note} kind="lead">${canEdit ? x('howCreator') : x('howMember')}<//>
        <${HelpTip} term="concept.organismDirective" label=${x('title')} />
      <//>
      ${own ? html`
        <${SettingBox} label=${x('label')} pre>${own.text}<//>
        <${Facts} rows=${[
          { k: x('askLabel'), v: x('ask.' + own.ask) },
          { k: x('updated'), v: date(own.updated_at) },
          directives?.your_answer?.answer ? { k: x('yourAnswer'), v: x('yours.' + directives.your_answer.answer) } : null,
        ].filter(Boolean)} />` : html`<${Note} kind="quiet">${x('none')}<//>`}
      ${summary ? html`
        <${FigureStrip} flush items=${[
          { key: 'scheduled', n: summary.answers.scheduled, label: x('answer.scheduled') },
          { key: 'every', n: summary.answers['every-use'], label: x('answer.every-use') },
          { key: 'declined', n: summary.answers.declined, label: x('answer.declined') },
        ]} />
        <${Note}>${x('countsOnly')}<//>
        ${summary.review_due ? html`<${Note} kind="aside">${x('reviewDue')}<//>` : null}` : null}
      ${canEdit ? html`<${PromptCard} label=${x('promptLabel')} prompt=${prompt} copyLabel=${x('copy')} />` : null}
    <//>`;
}
