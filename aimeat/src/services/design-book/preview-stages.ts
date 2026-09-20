/**
 * @file src/services/design-book/preview-stages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE STAGE A PART IS SHOWN ON. Until 2026-09-20 every look, motion recipe, ambient
 *   and effect in the Design Book was shown on one arrangement: a hero called "Bench", three
 *   numbers, five sample rows, six cards and a history. The developer opened the gallery and said
 *   what that produced: every page looked like the last one, an effect could not be seen behind
 *   the cards standing on it, and "MTV broadcast" was a magenta link on a white page.
 *
 *   A LOOK is shown on a page whose CONTENT fits its character: a chart countdown and a news crawl
 *   for a music-television look, a ledger for a ledger look, a running order for a stage, a log
 *   for a terminal. The stage is chosen from the part's own words (its id, title and preset), so a
 *   look somebody proposes tomorrow lands on the nearest stage and never on "Bench".
 *
 *   AN EFFECT OR AN AMBIENT IS SHOWN AT FULL STRENGTH ON ITS OWN GROUND: the layer with one title
 *   over it and nothing standing in front, in the look it was proven on. An effect worn by a hero
 *   or a figure gets that one block, large, and nothing else.
 *
 *   A LAYOUT OR A FILL THAT NAMES NO LOOK WEARS A COMMITTED ONE, picked from its id so the shelf
 *   is not one colour, where it used to wear the default on a white page.
 *
 *   Everything here is an arrangement of the kit's own blocks with rows of its own, so the bench
 *   measures the same page the gallery shows (preview.ts) and a stage cannot show what an app
 *   could not build.
 * @structure lookStage · layerStage · wornStage · lookForShape · StageBody
 * @usage const body = lookStage(part.id, part.title, tokens, preset);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial (wish-design-book-n-ytt-osansa-niin-ett-ne-erottuvat-toisistaan-ja).
 */

/** An arrangement plus the rows its sources resolve to (`__sources`), read by benchPageHtml. */
export type StageBody = Record<string, unknown> & { __sources?: Record<string, unknown> };

/**
 * `night`: the look's character is a lit thing in the dark (a broadcast, a terminal, a stage), so
 * a reader who asked for no theme sees it in the dark one. Asking for a theme always wins.
 */
interface Stage { match: RegExp; night?: boolean; blocks: Array<Record<string, unknown>>; sources: Record<string, unknown> }

const hero = (title: string, sub: string) => ({ id: 'top', component: 'hero', props: { title, sub } });

const STAGES: Stage[] = [
  {
    // Music television, a chart show, anything on air.
    match: /mtv|broadcast|television|chart|radio|on.?air|neon|arcade|carnival|billboard/,
    night: true,
    blocks: [
      hero('Top ten tonight', 'Counted down live at nine. Votes close when the first record spins.'),
      { id: 'crawl', component: 'crawl', props: { source: 'stage.crawl' } },
      { id: 'count', component: 'countdown', props: { source: 'stage.count', title: 'The countdown' }, span: 'main' },
      { id: 'nums', component: 'statRow', props: { source: 'stage.nums', title: 'Tonight' }, span: 'side' },
      { id: 'next', component: 'list', props: { source: 'stage.next', title: 'Up next' } },
    ],
    sources: {
      'stage.crawl': [{ text: 'New at four: Glass Animals' }, { text: 'Votes close 20:45' }, { text: 'Request line is open' }, { text: 'Live from Studio B' }],
      'stage.count': [
        { id: 'c1', rank: 1, title: 'Heat Haze', sub: 'The Lanterns · 6 weeks', votes: 4812 },
        { id: 'c2', rank: 2, title: 'Paper Planes at Midnight', sub: 'Juno Vale · up 3', votes: 4390 },
        { id: 'c3', rank: 3, title: 'Static Summer', sub: 'Cassette Club · new', votes: 3977 },
        { id: 'c4', rank: 4, title: 'Low Tide Radio', sub: 'Mira K · down 2', votes: 3102 },
        { id: 'c5', rank: 5, title: 'Satellite Heart', sub: 'North Arcade · 11 weeks', votes: 2845 },
      ],
      'stage.nums': [{ id: 'a', label: 'Votes tonight', value: 19126 }, { id: 'b', label: 'New entries', value: 3 }, { id: 'c', label: 'Weeks at one', value: 6 }],
      'stage.next': [
        { id: 'n1', title: '21:00  The countdown', sub: 'Ten to one, no breaks.', badge: 'live' },
        { id: 'n2', title: '22:00  Session: Juno Vale', sub: 'Four songs from the roof.' },
        { id: 'n3', title: '22:40  Night shift requests', sub: 'You call, we play.' },
      ],
    },
  },
  {
    // A ledger, an almanac, a quiet editorial page with figures in it.
    match: /ledger|forest|editorial|almanac|broadsheet|account|book|calm/,
    blocks: [
      hero('Stand 14, north slope', 'The year in the forest, entry by entry. Closed for the season on the last day of October.'),
      { id: 'fig', component: 'figure', props: { source: 'stage.fig', title: 'Standing volume' }, span: 'side' },
      { id: 'rows', component: 'table', props: { source: 'stage.rows', title: 'The ledger', caption: 'Entries this season, newest first.' }, span: 'main' },
      { id: 'year', component: 'chart', props: { source: 'stage.year', title: 'Growth against felling' } },
      { id: 'hist', component: 'timeline', props: { source: 'stage.hist', title: 'The season' } },
    ],
    sources: {
      'stage.fig': { value: 2140, label: 'Cubic metres standing', sub: 'Up 3.1 % on last autumn.' },
      'stage.rows': [
        { id: 'r1', date: '2026-10-28', entry: 'Thinning, compartment C', volume: '86 m³', by: 'A. Salo' },
        { id: 'r2', date: '2026-10-11', entry: 'Windfall cleared, ridge path', volume: '12 m³', by: 'A. Salo' },
        { id: 'r3', date: '2026-09-02', entry: 'Seedlings planted, spruce', volume: '1 800 pcs', by: 'M. Korpi' },
        { id: 'r4', date: '2026-06-17', entry: 'Boundary marked with the neighbour', volume: '', by: 'Survey office' },
        { id: 'r5', date: '2026-05-04', entry: 'Growth plots measured', volume: '24 plots', by: 'M. Korpi' },
      ],
      'stage.year': { labels: ['2022', '2023', '2024', '2025', '2026'], series: [
        { id: 'grow', label: 'Growth', kind: 'bar', values: [61, 64, 66, 69, 71] },
        { id: 'fell', label: 'Felled', kind: 'bar', values: [40, 12, 88, 20, 98] } ] },
      'stage.hist': [
        { id: 't1', ts: '2026-10-31T15:00:00Z', title: 'Books closed for the season', tone: 'ok' },
        { id: 't2', ts: '2026-10-28T09:00:00Z', title: 'Thinning finished in compartment C', sub: 'Eighty-six cubic metres to the roadside.' },
        { id: 't3', ts: '2026-08-19T06:30:00Z', title: 'Storm damage on the ridge', tone: 'warn' },
      ],
    },
  },
  {
    // A machine that speaks: a terminal, a console, an operator's room.
    match: /terminal|crt|console|machine|mono|brutalist|operator|system/,
    night: true,
    blocks: [
      hero('night-batch // node 07', 'Four jobs, one of them unhappy. Last contact forty seconds ago.'),
      { id: 'log', component: 'console', props: { source: 'stage.log', title: 'Log' }, span: 'main' },
      { id: 'up', component: 'health', props: { source: 'stage.up', title: 'Services' }, span: 'side' },
      { id: 'jobs', component: 'queue', props: { source: 'stage.jobs', title: 'Queue' }, span: 'side' },
    ],
    sources: {
      'stage.log': { lines: [
        { ts: '02:14:07', tone: 'ok', text: 'backup done · 1.2 GB · 00:03:41' },
        { ts: '02:31:00', text: 'nightly import started · 48 sources' },
        { ts: '02:44:19', tone: 'warn', text: 'geo source slow · 9.4 s · retrying' },
        { ts: '02:52:40', tone: 'err', text: 'geo source answered 503 · next try 04:00' },
        { ts: '03:01:12', tone: 'ok', text: 'import done · 47 of 48' },
        { ts: '03:01:13', text: 'index rebuild queued' },
      ] },
      'stage.up': [
        { id: 'h1', label: 'API', tone: 'ok', reading: '82 ms' },
        { id: 'h2', label: 'Mail queue', tone: 'warn', reading: '214', sub: 'draining' },
        { id: 'h3', label: 'Geo source', tone: 'err', reading: '503' },
      ],
      'stage.jobs': [
        { id: 'q1', title: 'index rebuild', state: 'running', sub: '61 %' },
        { id: 'q2', title: 'thumbnail sweep', state: 'waiting' },
        { id: 'q3', title: 'nightly import', state: 'done', sub: '03:01' },
        { id: 'q4', title: 'geo refresh', state: 'failed', sub: 'try again at 04:00' },
      ],
    },
  },
  {
    // A lit room: a stage, a lounge, a gallery at night.
    match: /stage|lit|lounge|spot|theatre|theater|gallery|aurora|night|glass/,
    night: true,
    blocks: [
      hero('Friday at the Long Room', 'Doors at seven. Three sets, one interval, and the bar stays open for the last train.'),
      { id: 'run', component: 'steps', props: { source: 'stage.run', title: 'Running order' } },
      { id: 'acts', component: 'cardGrid', props: { source: 'stage.acts', title: 'On the bill' }, span: 'main' },
      { id: 'door', component: 'statRow', props: { source: 'stage.door', title: 'The house' }, span: 'side' },
    ],
    sources: {
      'stage.run': { current: 1, steps: [{ label: 'Doors', sub: '19:00' }, { label: 'Ilta Quartet', sub: '19:45' }, { label: 'Interval', sub: '20:40' }, { label: 'Marrow & Pine', sub: '21:00' }] },
      'stage.acts': [
        { id: 'a1', title: 'Ilta Quartet', sub: 'Strings, quietly. Forty minutes.' },
        { id: 'a2', title: 'Marrow & Pine', sub: 'Two voices and a pedal steel.' },
        { id: 'a3', title: 'Oda Lumen', sub: 'Closing set, lights low.' },
      ],
      'stage.door': [{ id: 'a', label: 'Sold', value: 184 }, { id: 'b', label: 'On the door', value: 36 }, { id: 'c', label: 'Guest list', value: 12 }],
    },
  },
  {
    // Ink on paper, loud: a poster, a riso print, a zine, a sticker sheet.
    match: /poster|riso|press|print|zine|sticker|amber|ink|paper/,
    blocks: [
      hero('Harvest Fest', 'Two days in the field behind the mill. Bring a blanket, leave the car.'),
      { id: 'big', component: 'figure', props: { source: 'stage.big', title: 'Days to go' }, span: 'side' },
      { id: 'bill', component: 'cardGrid', props: { source: 'stage.bill', title: 'Line-up' }, span: 'main' },
      { id: 'what', component: 'list', props: { source: 'stage.what', title: 'Good to know' } },
    ],
    sources: {
      'stage.big': { value: 12, label: 'Days to go', sub: 'Gates open Saturday at noon.' },
      'stage.bill': [
        { id: 'b1', title: 'The Long Drive', sub: 'Saturday, main field, 21:00' },
        { id: 'b2', title: 'Kettle Choir', sub: 'Saturday, the barn, 18:30' },
        { id: 'b3', title: 'Brass for Breakfast', sub: 'Sunday, the orchard, 10:00' },
        { id: 'b4', title: 'Small Hours', sub: 'Sunday, main field, 16:00' },
      ],
      'stage.what': [
        { id: 'w1', title: 'Twelve acts, one field kitchen', sub: 'Everything on the menu grew within ten kilometres.', badge: 'new' },
        { id: 'w2', title: 'The shuttle runs from the station', sub: 'Every half hour, both days.' },
        { id: 'w3', title: 'Dogs are welcome', sub: 'On a lead, and not in the barn.' },
      ],
    },
  },
];

/** What a look lands on when none of its words name a stage: a small shop on a weekday. */
const DEFAULT_STAGE: Stage = {
  match: /./,
  blocks: [
    hero('Crust & Crumb', 'The morning at the bakery: what is in the oven, what sold, and who is coming in.'),
    { id: 'nums', component: 'statRow', props: { source: 'stage.nums', title: 'This morning' } },
    { id: 'oven', component: 'queue', props: { source: 'stage.oven', title: 'The oven' }, span: 'main' },
    { id: 'week', component: 'chart', props: { source: 'stage.week', title: 'Loaves this week' }, span: 'side' },
    { id: 'notes', component: 'timeline', props: { source: 'stage.notes', title: 'Today' } },
  ],
  sources: {
    'stage.nums': [{ id: 'a', label: 'Loaves out', value: 128 }, { id: 'b', label: 'Sold by ten', value: 91 }, { id: 'c', label: 'Orders for Friday', value: 14 }],
    'stage.oven': [
      { id: 'o1', title: 'Rye, second batch', state: 'running', sub: 'Out at 07:40.' },
      { id: 'o2', title: 'Cardamom buns', state: 'waiting' },
      { id: 'o3', title: 'Sourdough, first batch', state: 'done', sub: 'Out at 06:10.' },
    ],
    'stage.week': { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [{ id: 'l', label: 'Loaves', kind: 'bar', values: [96, 104, 88, 121, 128] }] },
    'stage.notes': [
      { id: 't1', ts: '2026-09-18T06:32:00Z', title: 'Oven service confirmed', sub: 'Tuesday at seven.', tone: 'ok' },
      { id: 't2', ts: '2026-09-18T05:50:00Z', title: 'Flour delivery is late', sub: 'The mill says Thursday.', tone: 'warn' },
    ],
  },
};

/** A look, worn by the page its own words describe. `preset` is the kit look it builds on, when it names one. */
export function lookStage(words: string, tokens: Record<string, string>, preset?: string): StageBody {
  const stage = STAGES.find(s => s.match.test(words.toLowerCase())) ?? DEFAULT_STAGE;
  return { v: 1, blocks: stage.blocks, look: preset ?? 'vivid', tokens, __sources: stage.sources, ...(stage.night ? { __theme: 'dark' } : {}) };
}

/**
 * A layer at full strength with one title over it: an ambient, or an effect that is a pass over
 * the layer. Nothing stands in front of it, and the frame gives it the whole height (preview.ts).
 */
export function layerStage(title: string, sub: string, look: string, tokens: Record<string, string>, ambient: Record<string, unknown>): StageBody {
  return { v: 1, blocks: [hero(title, sub)], look, tokens, ambient, __stage: 'layer', ...night(look) };
}

/** The kit looks that are a lit thing in the dark: a part proven on one is shown in the dark theme. */
const NIGHT_LOOKS = new Set(['neon-dense', 'lounge', 'terminal', 'stage', 'carnival', 'billboard']);
const night = (look: string): { __theme?: 'dark' } => (NIGHT_LOOKS.has(look) ? { __theme: 'dark' } : {});

/** A picture the node serves itself (the front page's arcade), so a picture effect has a picture to work on. */
const STAGE_PICTURE = '/img/frontdemo/arcade.jpg';

/**
 * An effect worn by one block, large, with nothing else on the page: the hero band over a real
 * picture, or one figure under a title. A picture effect on a hero with no picture tears a pale
 * gradient, which is what "The glitch" showed until 2026-09-20.
 */
export function wornStage(on: 'hero' | 'figure', title: string, sub: string, look: string, tokens: Record<string, string>, effect: Record<string, unknown>): StageBody {
  const band = hero(title, sub);
  const top = { ...band, props: { ...band.props, image: STAGE_PICTURE }, ...(on === 'hero' ? { effect } : {}) };
  const blocks: Array<Record<string, unknown>> = on === 'hero' ? [top]
    : [top, { id: 'fig', component: 'figure', props: { source: 'stage.fig', title: 'Figure' }, effect }];
  return { v: 1, blocks, look, tokens, __stage: 'worn', ...night(look), __sources: { 'stage.fig': { value: 128, label: 'The block wearing the effect', sub: 'An effect on a figure lands on its picture or its numeral.' } } };
}

/** The committed looks a shape is shown in when it names none, so a shelf of them is not one colour. */
const SHAPE_LOOKS = ['editorial', 'poster', 'sticker', 'broadsheet', 'gallery', 'carnival'] as const;

export function lookForShape(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SHAPE_LOOKS[h % SHAPE_LOOKS.length];
}
