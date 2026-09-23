/**
 * @file public/views/design-lab/demos-page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's live demos for the parts a page is built from: frame, headline,
 *   masthead, bands and rows, the record of what happened, the settings dialog's insides, the task
 *   chooser and an operator's passages. Each is drawn by its real component with the catalogue
 *   entry's example data (`ex`), one render per variant or state.
 * @structure PAGE_DEMOS — { [id]: { variants: [{ name, render(ex) }] } }
 * @usage import { PAGE_DEMOS } from './demos-page.js';
 * @version-history
 *   v1.1.0 — 2026-09-23 — The diagonal band's demo goes with ChatDoor (Jouni's decision).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import htm from 'htm';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { ErrorNote, ErrorNoteFallback } from '/components/ErrorNote.js';
import { ActionRow } from '/components/ActionRow.js';
import { Hint } from '/components/Hint.js';
import { Masthead, MastheadButton, MastheadCog } from '/components/Masthead.js';
import { LinkLine } from '/components/LinkLine.js';
import { StatLine, statSentence } from '/components/StatLine.js';
import { Band, BandNote } from '/components/Band.js';
import { LineList } from '/components/LineList.js';
import { NamedRow } from '/components/NamedRow.js';
import { ThingLink, ThingChip } from '/components/ThingLink.js';
import { StarToggle } from '/components/StarToggle.js';
import { FoldButton } from '/components/FoldButton.js';
import { ModeSwitch } from '/components/ModeSwitch.js';
import { QuietNote } from '/components/QuietNote.js';
import { NumberedIndex, IndexPanel } from '/components/NumberedIndex.js';
import { InkFoot } from '/components/InkFoot.js';
import { CheckItem } from '/components/CheckItem.js';
import { Timeline, TimelineRow } from '/components/Timeline.js';
import { BackLink } from '/components/BackLink.js';
import { DayGroup, DayList, DayEmpty } from '/components/DayGroup.js';
import { ArchiveSection, ArchiveMore, ArchiveError } from '/components/ArchiveSection.js';
import { SettingsStack } from '/components/SettingsStack.js';
import { SettingsSwitch } from '/components/SettingsSwitch.js';
import { SwatchPicker } from '/components/SwatchPicker.js';
import { SettingsDoor } from '/components/SettingsDoor.js';
import { OpenItemsList } from '/components/OpenItemsList.js';
import {
  Chooser, ChooserChoices, ChooserChoice, ChooserPanel, ChooserStatus, ChooserBox, ChooserFold,
  ChooserLinks, ChooserResult,
} from '/components/Chooser.js';
import { SettingsAccount } from '/components/SettingsAccount.js';
import { FreeText, TextBlock, NoticeBlock } from '/components/FreeText.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { HomeJourney } from '/views/home/journey.js';

const html = htm.bind(h);
const noop = () => {};

/** A plain initials mark: the masthead takes its avatar as an SVG string. */
const AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="currentColor" opacity="0.15"/><text x="32" y="41" text-anchor="middle" font-size="26" font-family="sans-serif" fill="currentColor">A</text></svg>';

const CATEGORIES = ['made', 'agent', 'trouble', 'money', 'access', 'system'];

export const PAGE_DEMOS = {
  'page-frame': { flush: true, variants: [
    { name: 'wide', render: () => html`<${PageFrame}><${PageIntro} title="A wide page" sub="Work happens here." /><//>` },
    { name: 'narrow', render: () => html`<${PageFrame} width="narrow"><${PageIntro} title="A narrow page" sub="This one is read." /><//>` },
    { name: 'loading', render: () => html`<${PageFrame} loading=${true}><//>` },
  ] },
  'page-intro': { variants: [
    { name: 'default', render: (ex) => html`<${PageIntro} title=${ex.title} sub=${ex.sub} />` },
  ] },
  'error-note': { variants: [
    { name: 'with a hint', render: (ex) => html`<${ErrorNote} text=${ex.text} hint=${ex.hint} />` },
    { name: 'with a way forward', render: (ex) => html`<${ErrorNote} text=${ex.text} hint=${ex.hint}>
        <${ErrorNoteFallback} onClick=${noop}>Show me a shorter prompt to try<//><//>` },
  ] },
  'action-row': { variants: [
    { name: 'default', render: () => html`<${ActionRow}><button type="button" class="btn-primary">Here is my welcome mat</button>
        <button type="button" class="btn-outline">Not now</button><//>` },
  ] },
  'hint': { variants: [{ name: 'default', render: (ex) => html`<${Hint}>${ex.children}<//>` }] },
  'masthead': { variants: [
    { name: 'default', render: (ex) => html`<${Masthead} avatarSvg=${AVATAR} name=${ex.name} identity=${ex.identity}>
        <a class="poster-action" href="/v1/profile">Settings</a>
        <${MastheadButton} onClick=${noop}>${MastheadCog}<//><//>` },
  ] },
  'link-line': { variants: [
    { name: 'default', render: (ex) => html`<${LinkLine} label=${ex.label} href=${ex.href} text=${ex.text} />` },
  ] },
  'stat-line': { variants: [
    { name: 'number', render: () => html`<${StatLine} href="/v1/inbox">${statSentence('{n} unread, go have a look', '{n}', 7)}<//>` },
    { name: 'alert', render: (ex) => html`<${StatLine} href=${ex.href} tone="alert">${ex.children}<//>` },
    { name: 'ok (dot)', render: () => html`<${StatLine} href="/v1/profile?tab=agents" tone="ok" dot=${true}>Your agent is home and well.<//>` },
    { name: 'trouble (dot)', render: () => html`<${StatLine} href="/v1/profile?tab=agents" tone="trouble" dot=${true}>Your agent has hit a snag.<//>` },
  ] },
  'band': { variants: [
    { name: 'default', render: (ex) => html`<${Band} title=${ex.title}><${NamedRow} label="Apps"><${ThingLink} href="/v1/apps" n=${12} label="apps" /><//>
        <${BandNote}>A note under the rows.<//><//>` },
    { name: 'tight', render: (ex) => html`<${Band} title=${ex.title} tight=${true}><${QuietNote}>Nothing here yet.<//><//>` },
  ] },
  'line-list': { variants: [
    { name: 'with more', render: (ex) => html`<${LineList} rows=${ex.rows} more=${ex.more} />` },
    { name: 'long line', render: () => html`<${LineList} rows=${[{ id: '1', name: 'Bob', text: 'A message long enough that it has to be cut to one line, because the list only points at it and the whole text is one press away.', href: '#' }]} more=${null} />` },
  ] },
  'named-row': { variants: [
    { name: 'default', render: (ex) => html`<${NamedRow} label=${ex.label}>
        <${ThingLink} href="#" n=${3} label="notes" /><${ThingLink} href="#" n=${9} label="files" /><//>` },
  ] },
  'thing-link': { variants: [
    { name: 'count', render: (ex) => html`<${ThingLink} href=${ex.href} n=${ex.n} label=${ex.label} />` },
    { name: 'named', render: () => html`<${ThingLink} href="#" label="Signal Room" named=${true} />` },
    { name: 'chip, starred', render: () => html`<${ThingChip} href="#" label="AIMEAT CODING CENTRAL" n=${1} starred=${true} starTitle="Keep this one always visible" onStar=${noop} />` },
    { name: 'chip, not starred', render: () => html`<${ThingChip} href="#" label="Signal Room" starred=${false} starTitle="Keep this one always visible" onStar=${noop} />` },
  ] },
  'star-toggle': { variants: [
    { name: 'on', render: (ex) => html`<${StarToggle} on=${true} title=${ex.title} onClick=${noop} />` },
    { name: 'off', render: (ex) => html`<${StarToggle} on=${false} title=${ex.title} onClick=${noop} />` },
  ] },
  'fold-button': { variants: [
    { name: 'default', render: (ex) => html`<${FoldButton} onClick=${noop}>${ex.children}<//>` },
    { name: 'on', render: () => html`<${FoldButton} on=${true} onClick=${noop}>Recent<//>` },
  ] },
  'mode-switch': { variants: [
    { name: 'default', render: (ex) => html`<${ModeSwitch} label=${ex.label}>
        <${FoldButton} on=${true} onClick=${noop}>Recent<//><${FoldButton} onClick=${noop}>Mine<//><//>` },
  ] },
  'quiet-note': { variants: [{ name: 'default', render: (ex) => html`<${QuietNote}>${ex.children}<//>` }] },
  'numbered-index': { variants: [
    { name: 'closed', render: (ex) => html`<${NumberedIndex} lead=${ex.lead} label="To set up" panel=${null}>
        ${ex.rows.map((r, i) => html`<${FoldButton} key=${i} onClick=${noop}>${r}<//>`)}<//>` },
    { name: 'one open', render: (ex) => html`<${NumberedIndex} lead=${ex.lead} label="To set up"
        tour=${{ href: '#', label: 'Not sure what this can do? Take the tour →' }}
        panel=${html`<${IndexPanel} what=${ex.panel.what} steps=${ex.panel.steps} proof=${ex.panel.proof}>
          <button type="button" class="btn-primary">Ask my agent</button><button type="button" class="btn-outline">Copy for my own AI</button><//>`}>
        ${ex.rows.map((r, i) => html`<${FoldButton} key=${i} on=${i === 0} expanded=${i === 0} onClick=${noop}>${r}<//>`)}<//>` },
  ] },
  'ink-foot': { flush: true, variants: [
    { name: 'default', render: () => html`<${InkFoot}><p>AI-made content carries its label.</p><p>Your data is yours: export it, delete it.</p><//>` },
  ] },
  'check-item': { variants: [
    { name: 'done', render: (ex) => html`<${CheckItem} done=${true} href=${ex.href}>${ex.children}<//>` },
    { name: 'not yet', render: () => html`<${CheckItem} done=${false} href="#">Make a page<//>` },
  ] },
  'timeline': { variants: [
    { name: 'every category', render: (ex) => html`<${Timeline} title=${ex.title} more=${{ href: '#', text: 'The whole record →' }}>
        ${CATEGORIES.map((c) => html`<${TimelineRow} key=${c} category=${c} text=${'Something of the kind "' + c + '" happened'} when="10:42" href="#" />`)}<//>` },
    { name: 'live row and quiet period', render: (ex) => html`<${Timeline} title=${ex.title} quiet=${{ href: '#', text: 'Nothing happened for three days.' }}>
        <${TimelineRow} category="agent" live=${true} text="Your agent is building a page now" when="now" /><//>` },
    { name: 'as a band', render: (ex) => html`<${Timeline} title=${ex.title} band=${true}>
        <${TimelineRow} category="made" text="You published a page" when="10:42" href="#" /><//>` },
  ] },
  'back-link': { variants: [{ name: 'default', render: (ex) => html`<${BackLink} href=${ex.href} onClick=${noop}>${ex.children}<//>` }] },
  'day-group': { variants: [
    { name: 'two days', render: () => html`<${DayList}>
        <${DayGroup} title="Today"><${TimelineRow} category="made" text="You published a page" when="10:42" href="#" /><//>
        <${DayGroup} title="Yesterday"><${TimelineRow} category="access" text="You let claude in" when="18:05" /><//><//>` },
    { name: 'empty', render: () => html`<${DayEmpty}>Nothing has happened here yet.<//>` },
  ] },
  'archive': { variants: [
    { name: 'with more', render: (ex) => html`<${ArchiveSection} title=${ex.title} note=${ex.note}>
        <${TimelineRow} category="system" text="The node was updated" when="2 Sep" /><${ArchiveMore} onClick=${noop}>${ex.more}<//><//>` },
    { name: 'loading more', render: (ex) => html`<${ArchiveSection} title=${ex.title} note=${ex.note}><${ArchiveMore} disabled=${true} onClick=${noop}>Loading…<//><//>` },
    { name: 'error', render: (ex) => html`<${ArchiveSection} title=${ex.title} note=${ex.note}><${ArchiveError}>The older part could not be read. Try again later.<//><//>` },
  ] },
  'settings-stack': { variants: [
    { name: 'with its sections', render: () => html`<${SettingsStack}>
        <section class="poster-section"><${SettingsSwitch} checked=${true} onChange=${noop}>Show what I have tried<//></section>
        <${SettingsDoor} href="#" title="All settings →" hint="Your account, your agents and your keys." /><//>` },
  ] },
  'settings-switch': { variants: [
    { name: 'on', render: (ex) => html`<${SettingsSwitch} checked=${true} onChange=${noop}>${ex.children}<//>` },
    { name: 'off', render: (ex) => html`<${SettingsSwitch} checked=${false} onChange=${noop}>${ex.children}<//>` },
  ] },
  'swatch-picker': { variants: [
    { name: 'first chosen', render: (ex) => html`<${SwatchPicker} title=${ex.title} hint="The pattern in the page margin." emptyLabel="None" choices=${ex.choices} onChoose=${noop} />` },
    { name: 'second chosen', render: (ex) => html`<${SwatchPicker} title=${ex.title} hint="The pattern in the page margin." emptyLabel="None"
        choices=${ex.choices.map((c, i) => ({ ...c, active: i === 1 }))} onChoose=${noop} />` },
  ] },
  'settings-door': { variants: [{ name: 'default', render: (ex) => html`<${SettingsDoor} href=${ex.href} title=${ex.title} hint=${ex.hint} />` }] },
  'open-items': { variants: [
    { name: "live (this account's own items)", render: (ex) => html`<${OpenItemsList} maxAgeDays=${ex.maxAgeDays} />` },
  ] },
  'chooser': { variants: [
    { name: 'as the home draws it (live)', render: () => html`<${HomeJourney} />` },
    { name: 'every piece', render: (ex) => html`<${Chooser} titleId="demo-chooser" title=${ex.title} lead="Pick one and get what it needs.">
        <${ChooserChoices} label=${ex.title}>${ex.choices.map((c, i) => html`<${ChooserChoice} key=${i} on=${c.on} onClick=${noop}>${c.children}<//>`)}<//>
        <${ChooserPanel}><p>The panel the choice governs.</p><//>
        <${ChooserStatus}><span>Not connected yet.</span><button type="button" class="poster-action">Connect</button><//>
        <${ChooserBox}><p>A framed box for the connection steps.</p><//>
        <${ChooserFold} summary="Do it by hand"><p>The folded way.</p><//>
        <${ChooserLinks}><a href="#">One link</a><a href="#">Another</a><//>
        <${ChooserResult}><p>Saved. Your note is in your memory.</p><//><//>` },
  ] },
  'settings-account': { variants: [
    { name: 'default', render: (ex) => html`<${SettingsAccount} title=${ex.title}><button type="button" class="poster-action">Sign out</button><//>` },
  ] },
  'free-text': { variants: [
    { name: 'plain', render: (ex) => html`<${FreeText} tone="plain" title=${ex.title}><p>${ex.children}</p><//>` },
    { name: 'card', render: (ex) => html`<${FreeText} tone="card" title=${ex.title}><p>${ex.children}</p><//>` },
    { name: 'band', render: (ex) => html`<${FreeText} tone="band" title=${ex.title}><p>${ex.children}</p><//>` },
    { name: 'front page text block', render: () => html`<${TextBlock} title="About us"><p>We build things with AI.</p><//>` },
    { name: 'front page notice', render: () => html`<${NoticeBlock} title="Maintenance"><p>The server restarts on Sunday at 03:00.</p><//>` },
  ] },
  'specimen': { variants: [
    { name: 'a row of two', render: (ex) => html`<${Specimens}>
        <${Specimen} label=${ex.label} src="/v1/design-lab/frame?id=hint&v=0&theme=light" />
        <${Specimen} label="Dark" src="/v1/design-lab/frame?id=hint&v=0&theme=dark" /><//>` },
    { name: 'phone', render: () => html`<${Specimens}><${Specimen} phone=${true} label="Phone" src="/v1/design-lab/frame?id=hint&v=0&theme=light" /><//>` },
  ] },
};
