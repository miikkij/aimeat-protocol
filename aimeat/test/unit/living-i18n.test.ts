/**
 * @file test/unit/living-i18n.test.ts
 * @description A LIVING RECORD THAT CARRIES ITS OWN WORDS. Four things are proved here, and the
 *   fourth is the one that matters: the resolution order (the page, then the record's own default,
 *   then the map's first key), the refusals a malformed language map earns by name, that a format
 *   is per record rather than per language with `locale: "auto"` as the single door out, and that
 *   CHANGING THE LANGUAGE CHANGES ONLY THE WORDS — the number a person moved is still where they
 *   left it, the machine is still in the state it reached, and the dependency graph is the same
 *   graph it was.
 *
 *   That last one is why the test seeds a machine and a slider before switching: a language change
 *   implemented as "read the record again" would pass every reading check in this file and quietly
 *   throw away everything the person had done, which is the failure this is written to catch.
 * @usage cd aimeat && pnpm vitest run test/unit/living-i18n.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (the living document, stage 4).
 */
import { describe, it, expect, beforeEach } from 'vitest';

// The library attaches itself to window at import, and reads the page's language off the document.
// Both are stubbed before the import so the language under test is the one this file decided.
const html = {
  lang: null as string | null,
  getAttribute(key: string) { return key === 'lang' ? this.lang : null; },
};
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: html,
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const {
  pickLang, textOf, preference, langMapError, hasLangMap, localizeProps, localizeLayout, isLangMap,
} = await import('../../src/static/sdk-libs/living/i18n.js');
const { formatNumber } = await import('../../src/static/sdk-libs/living/format.js');
const { createGraph } = await import('../../src/static/sdk-libs/living/graph.js');
const { validate, describe: describeType } = await import('../../src/static/sdk-libs/living/index.js');

beforeEach(() => { html.lang = null; });

/** The bilingual temperature sheet every state test below runs against. */
function sheet() {
  return {
    v: 1,
    lang: 'fi',
    langs: ['fi', 'en'],
    layout: {
      v: 1,
      blocks: [
        { id: 'controls', component: 'section', props: { title: { fi: 'Säädä', en: 'Adjust' } } },
        { id: 'note', component: 'section', props: { title: { fi: 'Selitys', en: 'What it means' } } },
      ],
    },
    model: {
      nodes: {
        t: { type: 'value', value: 22, unit: '°C', min: -20, max: 45, step: 0.5, label: { fi: 'Lämpötila', en: 'Temperature' } },
        slider: { type: 'control', kind: 'slider', target: 't', block: 'controls' },
        f: { type: 'formula', expr: 't * 9/5 + 32', unit: '°F', label: { fi: 'Fahrenheit', en: 'Fahrenheit' } },
        note: {
          type: 'text', block: 'note',
          template: {
            fi: 'Lämpötila on {{ t | 1 }} °C eli {{ f | 1 }} °F.',
            en: 'It is {{ t | 1 }} °C, which is {{ f | 1 }} °F.',
          },
        },
        advice: { type: 'value', value: '', label: { fi: 'Ohje', en: 'What to do' } },
        state: {
          type: 'machine', initial: 'fine', label: { fi: 'Tila', en: 'State' },
          states: {
            fine: { entry: { advice: { fi: '""', en: '""' } }, on: { HOT: 'hot' } },
            hot: {
              entry: { advice: { fi: '"tuuleta"', en: '"open a window"' } },
              on: { COOL: { target: 'fine', guard: 't < 30' } },
            },
          },
          when: [{ expr: 't > 30', send: 'HOT' }, { expr: 't < 30', send: 'COOL' }],
        },
      },
    },
  };
}

/** A graph over that sheet whose language this test decides, one switch at a time. */
function running(doc: ReturnType<typeof sheet>, start = 'fi') {
  let lang = start;
  const graph = createGraph(doc, { langs: () => [lang, doc.lang] });
  graph.refresh();
  return { graph, speak(next: string) { lang = next; return graph.relanguage(); } };
}

describe('which language a word is read in', () => {
  it('takes the page first, the record\'s own default second, the map\'s first key last', () => {
    const words = { fi: 'Ilma ovella', en: 'Air at the door' };
    expect(textOf(words, ['fi', 'en'])).toBe('Ilma ovella');
    expect(textOf(words, ['en', 'fi'])).toBe('Air at the door');
    // The page is reading Spanish, the record has no Spanish, and it says fi is its own default.
    expect(textOf(words, ['es', 'fi'])).toBe('Ilma ovella');
    // Neither is there: something is better than a blank label.
    expect(textOf(words, ['es', 'de'])).toBe('Ilma ovella');
  });

  it('matches a base language written either way', () => {
    expect(textOf({ fi: 'Kyllä', en: 'Yes' }, ['fi-FI'])).toBe('Kyllä');
    expect(pickLang({ 'pt-BR': 'Sim' }, ['pt'])!.lang).toBe('pt-BR');
  });

  it('leaves a plain string alone, and leaves nothing as nothing', () => {
    expect(textOf('Lämpötila', ['en'])).toBe('Lämpötila');
    expect(textOf(null, ['en'])).toBe(null);
    expect(textOf(undefined, ['en'])).toBe(undefined);
  });

  it('reads the page language off the document when nothing overrides it', () => {
    html.lang = 'en';
    expect(preference({ lang: 'fi' })).toEqual(['en', 'fi']);
    html.lang = 'fi';
    expect(preference({ lang: 'fi' })).toEqual(['fi']);
    expect(preference({ lang: 'fi' }, 'es')).toEqual(['es', 'fi']);
  });

  it('knows a usable map from an object that is not one', () => {
    expect(isLangMap({ fi: 'a', en: 'b' })).toBe(true);
    expect(isLangMap({})).toBe(false);
    expect(isLangMap({ label: 'a' })).toBe(false);
    expect(isLangMap('a')).toBe(false);
    expect(hasLangMap({ title: { fi: 'a' }, source: 'x' })).toBe(true);
    expect(hasLangMap({ title: 'a', data: { value: 1 } })).toBe(false);
  });
});

describe('a block\'s props, read in one language', () => {
  it('translates the words and carries everything else through untouched', () => {
    const out = localizeProps({
      title: { fi: 'Nyt', en: 'Now' },
      source: 'living:dial',
      data: { value: 22, unit: '°C', label: { fi: 'Lämpötila', en: 'Temperature' } },
      series: [{ id: 'c', label: { fi: 'Celsius', en: 'Celsius' }, values: [1, 2] }],
    }, ['en']);
    expect(out.title).toBe('Now');
    expect(out.source).toBe('living:dial');
    expect(out.data.value).toBe(22);
    expect(out.data.label).toBe('Temperature');
    expect(out.series[0].values).toEqual([1, 2]);
  });

  it('never writes into the record it was given', () => {
    const layout = { v: 1, blocks: [{ id: 'a', component: 'section', props: { title: { fi: 'Säädä', en: 'Adjust' } } }] };
    const out = localizeLayout(layout, ['en']);
    expect(out.blocks[0].props.title).toBe('Adjust');
    expect(layout.blocks[0].props.title).toEqual({ fi: 'Säädä', en: 'Adjust' });
  });
});

describe('what validate() refuses', () => {
  it('accepts a document written in two languages', () => {
    expect(validate(sheet())).toEqual({ ok: true, refusals: [] });
  });

  it('refuses a language map with no language in it, naming the node and the field', () => {
    const doc = sheet();
    doc.model.nodes.t.label = {} as never;
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('"t"');
    expect(out.refusals.join(' ')).toContain('label');
    expect(out.refusals.join(' ')).toContain('no language at all');
  });

  it('refuses a key that is not a language tag', () => {
    const doc = sheet();
    doc.model.nodes.f.label = { finnish: 'Fahrenheit' } as never;
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('finnish');
  });

  it('refuses a language whose value is not a line of text', () => {
    const doc = sheet();
    doc.model.nodes.t.label = { fi: 'Lämpötila', en: 42 } as never;
    expect(validate(doc).refusals.join(' ')).toContain('not a line of text');
  });

  it('refuses a sentence that reads a node in one language and not in the other, naming both', () => {
    const doc = sheet();
    doc.model.nodes.note.template = {
      fi: 'Lämpötila on {{ t | 1 }} °C eli {{ f | 1 }} °F.',
      en: 'It is {{ t | 1 }} °C.',
    };
    const out = validate(doc);
    expect(out.ok).toBe(false);
    const said = out.refusals.join(' ');
    expect(said).toContain('"note"');
    expect(said).toContain('"f"');
    expect(said).toContain('en');
  });

  it('refuses a sentence that will not parse in a language the page is not currently reading', () => {
    const doc = sheet();
    doc.model.nodes.note.template = {
      fi: 'Lämpötila on {{ t | 1 }} °C.',
      en: 'It is {{ t | 1 °C.',
    };
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('in en');
  });

  it('refuses the words a machine writes when the map carries no language', () => {
    const doc = sheet();
    doc.model.nodes.state.states.hot.entry.advice = { advice: '"tuuleta"' } as never;
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('"state"');
    expect(out.refusals.join(' ')).toContain('advice');
  });

  it('refuses a block title that is an object with no language in it', () => {
    const doc = sheet();
    doc.layout.blocks[0].props.title = { heading: 'Säädä' } as never;
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('"controls"');
    expect(out.refusals.join(' ')).toContain('title');
  });
});

describe('a format is per record, not per language', () => {
  it('writes the same number in every language unless the record asked otherwise', () => {
    expect(formatNumber(1234.5, { decimals: 1 }, 'fi')).toBe('1234.5');
    expect(formatNumber(1234.5, { decimals: 1 }, 'en')).toBe('1234.5');
    expect(formatNumber(15.75, 1, 'fi')).toBe('15.8');
  });

  it('follows the language for the separators when the format says locale: "auto"', () => {
    const fi = formatNumber(1234.5, { decimals: 1, group: true, locale: 'auto' }, 'fi');
    const en = formatNumber(1234.5, { decimals: 1, group: true, locale: 'auto' }, 'en');
    expect(fi).toContain(',5');
    expect(en).toContain('.5');
    expect(fi).not.toBe(en);
  });

  it('leaves a written-out locale alone: that was the record deciding, not the page', () => {
    const asked = { decimals: 1, group: true, locale: 'de-DE' };
    expect(formatNumber(1234.5, asked, 'en')).toBe(formatNumber(1234.5, asked, 'fi'));
  });
});

describe('changing the language changes the words and nothing else', () => {
  it('leaves a value the person moved exactly where they left it', () => {
    const doc = sheet();
    const run = running(doc);
    run.graph.set('t', 33);
    expect((run.graph.valueOf('t') as { n: number }).n).toBe(33);
    run.speak('en');
    expect((run.graph.valueOf('t') as { n: number }).n).toBe(33);
    expect((run.graph.valueOf('f') as { n: number }).n).toBeCloseTo(91.4, 5);
  });

  it('leaves the machine in the state it reached, and says that state\'s word in the new language', () => {
    const doc = sheet();
    const run = running(doc);
    run.graph.set('t', 33);
    expect(run.graph.valueOf('state')).toBe('hot');
    expect(run.graph.valueOf('advice')).toBe('tuuleta');
    run.speak('en');
    expect(run.graph.valueOf('state')).toBe('hot');
    expect(run.graph.valueOf('advice')).toBe('open a window');
  });

  it('rewrites the sentence, and reports exactly what became different', () => {
    const doc = sheet();
    const run = running(doc);
    expect(run.graph.valueOf('note')).toContain('Lämpötila on 22.0 °C');
    const out = run.speak('en');
    expect(run.graph.valueOf('note')).toContain('It is 22.0 °C');
    expect(out.changed).toContain('note');
    // The number did not move, so it is not in the list — which is what stops a wording change
    // from repainting a screen that has not otherwise moved.
    expect(out.changed).not.toContain('t');
    expect(out.changed).not.toContain('f');
  });

  it('is the same graph in both languages', () => {
    const doc = sheet();
    const run = running(doc);
    const before = run.graph.dependencies('note').slice().sort();
    const machineBefore = run.graph.dependencies('advice').slice().sort();
    run.speak('en');
    expect(run.graph.dependencies('note').slice().sort()).toEqual(before);
    expect(run.graph.dependencies('advice').slice().sort()).toEqual(machineBefore);
    expect(before).toEqual(['f', 't']);
    expect(machineBefore).toEqual(['state']);
  });

  it('does nothing at all when the language did not really change', () => {
    const doc = sheet();
    const run = running(doc);
    run.graph.set('t', 33);
    expect(run.speak('fi').changed).toEqual([]);
  });
});

describe('describe() says which fields take a language map', () => {
  it('names them per node type, out of the source rather than a second list', () => {
    expect(describeType('value')!.languages).toEqual(['label']);
    expect(describeType('control')!.languages).toEqual(['label', 'options[].label']);
    expect(describeType('text')!.languages).toEqual(['template', 'label']);
    expect(describeType('binding')!.languages).toEqual([]);
    expect(describeType('machine')!.languages[0]).toBe('label');
  });

  it('gives every type an answer, so an AI never has to guess', () => {
    for (const id of describeType() as string[]) {
      expect(Array.isArray(describeType(id)!.languages)).toBe(true);
    }
  });
});

describe('the refusal a bad map earns, in words', () => {
  it('says what is wrong rather than that something is', () => {
    expect(langMapError('plain words')).toBe(null);
    expect(langMapError(null)).toBe(null);
    expect(langMapError({ fi: 'a' })).toBe(null);
    expect(langMapError({})).toContain('no language at all');
    expect(langMapError({ suomi: 'a' })).toContain('suomi');
    expect(langMapError({ fi: 'a', en: 1 })).toContain('"en"');
    expect(langMapError([1, 2])).toContain('neither');
  });
});
