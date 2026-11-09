// Front-door persistence and language regressions, using no client files or real network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const state = require('../src/frontdoor-state.js');

test('the old address migrates once and selected named environments persist', () => {
  const initial = state.initial(null, 'https://work.example', null);
  assert.equal(state.current(initial).address, 'https://work.example');
  initial.selected = 'work';
  state.saveDraft(initial, 'My work', 'https://second.example');
  const restored = state.initial(JSON.stringify(initial), 'https://old.example', null);
  assert.equal(restored.selected, 'work');
  assert.equal(state.current(restored).name, 'My work');
  assert.equal(state.current(restored).address, 'https://second.example');
  assert.equal(restored.items.find((e) => e.id === 'personal').address, 'https://work.example');
});

test('a local handoff selects the running port without changing work or personal addresses', () => {
  const initial = state.initial(null, 'https://personal.example', null);
  initial.items.find((e) => e.id === 'work').address = 'https://work.example';
  const next = state.initial(JSON.stringify(initial), null, 'http://localhost:41777');
  assert.equal(state.current(next).kind, 'local');
  assert.equal(state.current(next).address, 'http://localhost:41777');
  assert.equal(next.items.find((e) => e.id === 'work').address, 'https://work.example');
  assert.equal(next.items.find((e) => e.id === 'personal').address, 'https://personal.example');
});

test('a local handoff cannot select a remote server or a credential-bearing URL', () => {
  for (const url of ['https://attacker.example', 'http://localhost@attacker.example', 'http://name:password@localhost:41050', 'http://localhost:41050/?next=remote', 'http://localhost:41050/v1/mcp']) {
    const next = state.initial(null, null, url);
    assert.equal(next.selected, 'personal', url);
  }
});

test('corrupted storage recovers to usable defaults instead of blocking startup', () => {
  for (const saved of ['broken', '{}', '{"version":1,"items":[]}', '{"version":1,"items":[null]}']) {
    const next = state.initial(saved, null, null);
    assert.equal(next.items.length, 3);
    assert.equal(state.current(next).address, 'https://aimeat.io');
  }
});

test('changing one environment keeps the others and does not depend on display language', () => {
  const next = state.initial(null, null, null);
  next.selected = 'local';
  state.saveDraft(next, '  Oma kokeilu  ', ' http://localhost:41888 ');
  assert.equal(state.current(next).name, 'Oma kokeilu');
  assert.equal(state.current(next).address, 'http://localhost:41888');
  assert.equal(next.items[0].address, 'https://aimeat.io');
  assert.equal(next.items[1].address, '');
  assert.equal(state.initial(JSON.stringify(next), null, null).selected, 'local');
});

test('credentials and token-bearing addresses never enter persistent profile state', () => {
  for (const address of ['https://name:secret@aimeat.io', 'https://aimeat.io?token=secret', 'https://aimeat.io/#secret']) {
    const next = state.initial(null, null, null);
    state.saveDraft(next, 'Personal', address);
    assert.equal(state.current(next).address, 'https://aimeat.io');
    assert.ok(!JSON.stringify(next).includes('secret'));
    assert.ok(!JSON.stringify(state.initial(null, address, null)).includes('secret'));
    const old = JSON.stringify({ version: 1, selected: 'old', items: [{ id: 'old', name: '', address }] });
    assert.ok(!JSON.stringify(state.initial(old, null, null)).includes('secret'));
  }
});

test('every front-door message has both languages and the same substitutions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/frontdoor.js'), 'utf8');
  const match = source.match(/const strings = (\{[\s\S]*?\n  \});/);
  assert.ok(match, 'translation dictionary exists');
  const strings = new Function('return (' + match[1] + ')')();
  assert.deepEqual(Object.keys(strings.fi).sort(), Object.keys(strings.en).sort());
  const vars = (text) => [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(strings.en)) assert.deepEqual(vars(strings.fi[key]), vars(strings.en[key]), key);
});
