/**
 * @file e2e-worksheet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What POST /v1/worksheet/evaluate answers: a chain that recomputes, units that are
 *   checked, a failing cell that does not take the sheet with it, and a door that refuses a caller
 *   with no token. The fixture is the wish's own example — an outdoor reading, a target a person
 *   moves, the difference, and the heat that follows — because the chain is the capability.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 1).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

const username = `sheet${Date.now()}`;
const password = 'Worksheet123!';
let jwt = '';
const auth = () => ({ Authorization: `Bearer ${jwt}` });

/** The wish's own example: outside, a target, the gap, and the heat that follows from it. */
const heating = (target = 21) => ({
  spec: 'aimeat.worksheet/v1',
  title: 'Heating',
  cells: [
    { id: 'T_ulko', kind: 'quantity', value: -12, unit: 'degC', label: 'Outside' },
    { id: 'T_sisa', kind: 'input', value: target, unit: 'degC', min: 5, max: 30 },
    { id: 'dT', kind: 'formula', math: ['Subtract', 'T_sisa', 'T_ulko'] },
    { id: 'U', kind: 'quantity', value: 0.24, unit: 'W/(m^2*K)' },
    { id: 'A', kind: 'quantity', value: 140, unit: 'm^2' },
    { id: 'teho', kind: 'formula', math: ['Multiply', 'U', 'A', 'dT'] },
  ],
});

const cellOf = (body: any, id: string) => (body.data?.cells ?? []).find((c: any) => c.id === id);

console.log(`\n=== Worksheet E2E ===\n`);
console.log(`Server: ${BASE}`);

await test('Register and log in', async () => {
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: 'Worksheet', password }) });
  assert(reg.body.ok === true, `registration failed: ${JSON.stringify(reg.body.error)}`);
  const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  jwt = login.body.data?.token;
  assert(typeof jwt === 'string' && jwt.length > 0, 'missing token');
});

await test('The chain works out, in the order it depends', async () => {
  const { status, body } = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({ sheet: heating() }) });
  assert(status === 200, `evaluate ${status}: ${JSON.stringify(body.error)}`);
  assert(body.data.errors === 0, `every cell answers: ${JSON.stringify(body.data.cells.filter((c: any) => !c.ok))}`);
  const dT = cellOf(body, 'dT');
  assert(dT.value === 33, `the gap is 33, got ${dT.value}`);
  assert(dT.unit === 'K', `a difference of two Celsius readings is a span in kelvin, got ${dT.unit}`);
  assert(dT.dependsOn.sort().join(',') === 'T_sisa,T_ulko', `the graph is read from the formula: ${JSON.stringify(dT.dependsOn)}`);
  const teho = cellOf(body, 'teho');
  assert(Math.abs(teho.value - 0.24 * 140 * 33) < 1e-6, `the heat follows: ${teho.value}`);
  assert(teho.unit === 'W', `W/(m²·K) × m² × K is watts, got ${teho.unit}`);
  assert(body.data.order.indexOf('dT') < body.data.order.indexOf('teho'), 'the gap is worked out before the heat');
});

await test('Moving the input moves what stands on it, and nothing else', async () => {
  const { body } = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({ sheet: heating(23) }) });
  assert(cellOf(body, 'dT').value === 35, `the gap follows the target: ${cellOf(body, 'dT').value}`);
  assert(Math.abs(cellOf(body, 'teho').value - 0.24 * 140 * 35) < 1e-6, 'the heat follows the gap');
  assert(cellOf(body, 'T_ulko').value === -12, 'what does not stand on the input did not move');
});

await test('A live reading is taken over the stored one', async () => {
  const { body } = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({ sheet: heating(), values: { T_ulko: -20 } }) });
  assert(cellOf(body, 'T_ulko').value === -20, `the reading wins: ${cellOf(body, 'T_ulko').value}`);
  assert(cellOf(body, 'dT').value === 41, `and the chain follows it: ${cellOf(body, 'dT').value}`);
});

await test('A reading converts to the unit a cell asks for', async () => {
  const { body } = await json('/v1/worksheet/evaluate', {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ sheet: { cells: [
      { id: 'boiling', kind: 'quantity', value: 100, unit: 'degC' },
      { id: 'inF', kind: 'formula', math: 'boiling', unit: 'degF' },
    ] } }),
  });
  const inF = cellOf(body, 'inF');
  assert(inF.value === 212, `100 °C is 212 °F, got ${inF.value}`);
  assert(inF.formatted === '212 °F', `and it is written for a reader: ${inF.formatted}`);
});

await test('The reader own number format is used', async () => {
  const sheet = { cells: [{ id: 'big', kind: 'quantity', value: 1234.5, unit: 'W' }] };
  const en = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({ sheet, locale: 'en' }) });
  const fi = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({ sheet, locale: 'fi' }) });
  assert(cellOf(en.body, 'big').formatted !== cellOf(fi.body, 'big').formatted, 'English and Finnish write a thousand differently');
});

await test('Metres plus seconds is refused by name, and the sheet stands', async () => {
  const { status, body } = await json('/v1/worksheet/evaluate', {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ sheet: { cells: [
      { id: 'len', kind: 'quantity', value: 1, unit: 'm' },
      { id: 'dur', kind: 'quantity', value: 1, unit: 's' },
      { id: 'nope', kind: 'formula', math: ['Add', 'len', 'dur'] },
    ] } }),
  });
  assert(status === 200, `a refused cell is not a refused request: ${status}`);
  const nope = cellOf(body, 'nope');
  assert(nope.ok === false && nope.error.code === 'INCOMPATIBLE_UNITS', `named: ${JSON.stringify(nope.error)}`);
  assert(nope.error.names.sort().join(',') === 'm,s', `and it says which two: ${JSON.stringify(nope.error.names)}`);
  assert(cellOf(body, 'len').ok === true, 'the cells that do stand still stand');
  assert(body.data.errors === 1, `one cell has no answer, got ${body.data.errors}`);
});

await test('A made-up unit, an unknown name and a cycle are each said plainly', async () => {
  const { body } = await json('/v1/worksheet/evaluate', {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ sheet: { cells: [
      { id: 'fake', kind: 'quantity', value: 1, unit: 'banana' },
      { id: 'ghosted', kind: 'formula', math: ['Add', 'ghost', 1] },
      { id: 'a', kind: 'formula', math: ['Add', 'b', 1] },
      { id: 'b', kind: 'formula', math: ['Add', 'a', 1] },
    ] } }),
  });
  assert(cellOf(body, 'fake').error.code === 'UNKNOWN_UNIT', 'a unit nothing is spelled');
  assert(cellOf(body, 'ghosted').error.code === 'UNKNOWN_SYMBOL', 'a name no cell carries');
  assert(cellOf(body, 'ghosted').error.names[0] === 'ghost', 'and it says which name');
  assert(cellOf(body, 'a').error.code === 'CYCLE' && cellOf(body, 'b').error.code === 'CYCLE', 'both members of the cycle');
});

await test('A cell waiting on a reading says so, and what stands on it says which', async () => {
  const { body } = await json('/v1/worksheet/evaluate', {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ sheet: { cells: [
      { id: 'src', kind: 'quantity', unit: 'degC', live: 'sensors.outside' },
      { id: 'twice', kind: 'formula', math: ['Multiply', 2, 'src'] },
    ] } }),
  });
  assert(cellOf(body, 'src').error.code === 'NO_VALUE', 'the cell with nothing in it yet');
  assert(cellOf(body, 'twice').error.code === 'UPSTREAM', 'what stands on it waits rather than complaining twice');
  assert(cellOf(body, 'twice').error.names[0] === 'src', 'and names what it waits for');
});

await test('A sheet that is not a sheet is refused with 400', async () => {
  const bad = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({ sheet: { cells: [{ id: '9nope', kind: 'quantity' }] } }) });
  assert(bad.status === 400, `a cell id that is not a name: ${bad.status}`);
  assert(bad.body.error?.code === 'INVALID_WORKSHEET', `and says so: ${JSON.stringify(bad.body.error)}`);
  const empty = await json('/v1/worksheet/evaluate', { method: 'POST', headers: auth(), body: JSON.stringify({}) });
  assert(empty.status === 400, `no sheet at all: ${empty.status}`);
});

await test('Without a token the door refuses (401)', async () => {
  const { status } = await json('/v1/worksheet/evaluate', { method: 'POST', body: JSON.stringify({ sheet: heating() }) });
  assert(status === 401, `evaluate without a token: ${status}`);
});

console.log(`\n=== Worksheet: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
