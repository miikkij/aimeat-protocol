/**
 * @file test/unit/chat-tool-markers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat's answer without the tool-call text a model writes instead of a call
 *   (services/chat-session.ts withoutToolMarkers), and the browser's copy of the same filter
 *   (public/views/chat.js) giving the same result. The inputs are the lines grokkoe3110b showed a
 *   buyer on 2026-10-31 (v31 K36), from deepseek/deepseek-v4-pro through goose.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutToolMarkers } from '../../src/services/chat-session.js';

const CHAT_JS = readFileSync(join(__dirname, '..', '..', 'public', 'views', 'chat.js'), 'utf-8');
const body = /function withoutToolMarkers\(text\) \{([\s\S]*?)\n\}/.exec(CHAT_JS)?.[1] ?? '';
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- the browser copy, read from its own file
const browserCopy = new Function('text', body) as (text: string) => string;

const SEEN = [
  ['="id" string="true">genre-receipt', ''],
  ['Pohja on haettu. Nyt kirjoitan ostoslistan koodin ja julkaisen name="filename" string="', 'Pohja on haettu. Nyt kirjoitan ostoslistan koodin ja julkaisen '],
  ['Rakennan nyt sovelluksen. Haen ensin kuittimaisen pohjan (genre-receipt), joka sopii ostoslistaan\n\nid" string="true">genre-receipt',
    'Rakennan nyt sovelluksen. Haen ensin kuittimaisen pohjan (genre-receipt), joka sopii ostoslistaan\n\n'],
  ['Selvä.<｜DSML｜function_calls>\n<｜DSML｜invoke name="aimeat__aimeat_app_template_get">', 'Selvä.\n'],
  ['[Calling: aimeat_organism_list]\nLöysin yhden organisaation.', 'Löysin yhden organisaation.'],
] as const;

describe('the chat answer without tool-call text', () => {
  it.each(SEEN)('removes the leaked call in %j', (input, expected) => {
    expect(withoutToolMarkers(input)).toBe(expected);
  });

  it('keeps ordinary words, quotes and code', () => {
    const plain = 'Kirjoita "maito" kenttään ja paina Lisää.\nKoodissa: `const name = "x";`';
    expect(withoutToolMarkers(plain)).toBe(plain);
  });

  it('the browser copy gives the same result', () => {
    expect(body.length).toBeGreaterThan(0);
    for (const [input] of SEEN) expect(browserCopy(input)).toBe(withoutToolMarkers(input));
  });
});
