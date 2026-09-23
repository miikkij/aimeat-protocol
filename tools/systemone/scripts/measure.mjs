// Measures the local System One providers: option ceiling, context limit, confidence, latency.
// Usage: node measure.mjs <out.json> [laya,von,jeff]   (tools/systemone/README.md)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// SYSTEMONE_PORTS=9801,9802,9803 when the models are not on 8801-8803.
// SYSTEMONE_MACHINE names the machine in the output.
const [PL, PV, PJ] = (process.env.SYSTEMONE_PORTS ?? '8801,8802,8803').split(',');
const PROVIDERS = {
  laya: { url: `http://127.0.0.1:${PL}/v1/systemone`, model: 'multilingual', auth: null },
  von: { url: `http://127.0.0.1:${PV}/v1/systemone`, model: 'von-1.1.0', auth: null },
  jeff: { url: `http://127.0.0.1:${PJ}/v1/systemone`, model: 'gliformer-large-v1', auth: 'devkey' },
};

// 60 support-ticket topics. The first 12 have a ticket whose right answer is known.
const TOPICS = [
  'refund request', 'password reset', 'shipping delay', 'damaged item', 'invoice copy', 'cancel subscription',
  'change delivery address', 'account locked', 'wrong size ordered', 'double charge', 'gift card balance', 'data deletion request',
  'product recommendation', 'warranty claim', 'store opening hours', 'loyalty points', 'discount code not working', 'payment method update',
  'order status', 'missing item in package', 'return label', 'price match', 'bulk order quote', 'tax exemption',
  'two-factor authentication', 'email change', 'newsletter unsubscribe', 'app crash', 'website slow', 'feature request',
  'partnership inquiry', 'press inquiry', 'job application', 'complaint about staff', 'accessibility issue', 'language settings',
  'currency conversion', 'international shipping', 'customs fees', 'pre-order date', 'out of stock', 'product manual',
  'assembly instructions', 'recycling old product', 'safety recall', 'allergy information', 'size chart', 'color mismatch',
  'installation appointment', 'technician visit', 'contract terms', 'late fee dispute', 'credit limit', 'identity verification',
  'referral bonus', 'student discount', 'donation receipt', 'event tickets', 'lost parcel', 'other',
];
const TICKETS = [
  ['I returned the shoes last week and want my money back to my card.', 'refund request'],
  ['I forgot my password and the reset email never arrives.', 'password reset'],
  ['My order was supposed to arrive on Monday and it is still not here after a week.', 'shipping delay'],
  ['The vase arrived broken into pieces, the box was crushed.', 'damaged item'],
  ['Could you send me a copy of the invoice for order 4411? Our accounting needs it.', 'invoice copy'],
  ['Please stop my monthly plan, I do not want to be billed from next month on.', 'cancel subscription'],
  ['I moved house, please send the parcel to my new street instead.', 'change delivery address'],
  ['After three wrong attempts I cannot log in at all anymore.', 'account locked'],
  ['I ordered a medium jacket but I actually need a large one.', 'wrong size ordered'],
  ['My card statement shows the same purchase charged twice.', 'double charge'],
  ['How much money is still left on my gift card?', 'gift card balance'],
  ['Under GDPR I want all my personal data erased from your systems.', 'data deletion request'],
];
const TICKETS_FI = [
  ['Palautin kengät viime viikolla ja haluan rahat takaisin kortilleni.', 'refund request'],
  ['Unohdin salasanani, eikä palautusviesti tule sähköpostiin.', 'password reset'],
  ['Tilaukseni piti tulla maanantaina, ja se ei ole vieläkään perillä viikon jälkeen.', 'shipping delay'],
  ['Maljakko tuli rikki, laatikko oli litistynyt.', 'damaged item'],
  ['Kortilla näkyy sama ostos veloitettuna kahdesti.', 'double charge'],
  ['Muutin, lähettäkää paketti uuteen osoitteeseeni.', 'change delivery address'],
];

function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function shuffle(arr, seed) { const r = rng(seed); const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function call(p, body, timeoutMs = 60000) {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(p.url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(p.auth ? { authorization: `Bearer ${p.auth}` } : {}) },
      body: JSON.stringify({ model: p.model, ...body }),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, ms: performance.now() - t0, json, text: json ? undefined : text.slice(0, 300) };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, error: String(e) };
  } finally { clearTimeout(timer); }
}

function optionsFor(correct, n, seed) {
  const others = shuffle(TOPICS.filter(t => t !== correct), seed).slice(0, n - 1);
  return shuffle([correct, ...others], seed + 7);
}

async function optionCeiling(p, tickets, sizes) {
  const out = {};
  for (const n of sizes) {
    let right = 0, errors = 0, confs = [], ms = [];
    for (const [i, [text, label]] of tickets.entries()) {
      const opts = optionsFor(label, n, 1000 + i * 31 + n);
      const r = await call(p, {
        state: { ticket: text },
        questions: { topic: { type: 'choice', instructions: 'What is this support ticket about?', criteria: Object.fromEntries(opts.map(o => [o, null])) } },
      });
      ms.push(r.ms);
      const a = r.json?.answers?.topic;
      if (r.status !== 200 || !a) { errors++; continue; }
      if (a.choice === label) right++;
      if (typeof a.confidence === 'number') confs.push(a.confidence);
    }
    out[n] = { accuracy: right / tickets.length, right, of: tickets.length, errors, meanConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null, medianMs: median(ms) };
  }
  return out;
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; }

// The fact is at the END of the state, after filler. A model that truncates from the end loses it.
const FILLER = 'The weather was mild and the meeting notes list routine agenda items about the office plants. ';
async function contextLimit(p) {
  const out = {};
  for (const words of [300, 700, 1500, 3000, 6000, 12000]) {
    const reps = Math.ceil(words / 15);
    const body = FILLER.repeat(reps) + ' Finally: the customer demands a full refund of the payment today.';
    const r = await call(p, { state: { note: body }, questions: { refund: { type: 'noul', instructions: 'The customer asks for money back.' } } }, 120000);
    out[words] = { chars: body.length, estTokens: Math.ceil(body.length / 4), status: r.status, noul: r.json?.answers?.refund?.noul ?? null, inputTokens: r.json?.usage?.input_tokens ?? null, ms: Math.round(r.ms), err: r.status === 200 ? undefined : (r.json?.detail ?? r.text ?? r.error) };
  }
  // Control: the fact at the START with the same filler after it.
  const startBody = 'The customer demands a full refund of the payment today. ' + FILLER.repeat(Math.ceil(3000 / 15));
  const c = await call(p, { state: { note: startBody }, questions: { refund: { type: 'noul', instructions: 'The customer asks for money back.' } } }, 120000);
  out.control_fact_first_3000w = { status: c.status, noul: c.json?.answers?.refund?.noul ?? null };
  const none = await call(p, { state: { note: FILLER.repeat(20) }, questions: { refund: { type: 'noul', instructions: 'The customer asks for money back.' } } });
  out.control_no_fact = { status: none.status, noul: none.json?.answers?.refund?.noul ?? null };
  return out;
}

async function shapes(p) {
  const r = await call(p, {
    state: { body: 'We were billed twice for March and would like a refund today.' },
    questions: {
      dept: { type: 'choice', instructions: 'Which team should handle this?', criteria: { billing: 'invoices, payments, refunds', tech: 'bugs and outages', other: 'anything else' } },
      refund: { type: 'noul', instructions: 'The customer asks for money back.' },
      urgency: { type: 'score', instructions: 'How urgent is this?', criteria: ['not urgent', 'soon', 'today'] },
    },
  });
  const a = r.json?.answers ?? {};
  const levels = {};
  for (const n of [2, 5, 10, 11]) {
    const s = await call(p, { state: 'Please fix this today, production is down.', questions: { u: { type: 'score', instructions: 'How urgent is this?', criteria: Array.from({ length: n }, (_, i) => `level ${i}`) } } });
    levels[n] = { status: s.status, score: s.json?.answers?.u?.score ?? null, err: s.status === 200 ? undefined : (s.json?.detail ?? s.text ?? s.error) };
  }
  return {
    status: r.status, model: r.json?.model, usage: r.json?.usage,
    confidence: { choice: typeof a.dept?.confidence === 'number', score: typeof a.urgency?.confidence === 'number', noul: typeof a.refund?.confidence === 'number' },
    extraTopLevel: Object.keys(r.json ?? {}).filter(k => !['model', 'answers', 'usage', 'request_id', 'evaluation_time_ms'].includes(k)),
    scoreLevels: levels,
    answers: a,
  };
}

async function latency(p, n = 20) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const r = await call(p, { state: { body: `Ticket ${i}: the invoice is overdue and the client asks for a new copy.` }, questions: { chase: { type: 'noul', instructions: 'This invoice should be chased today.' }, team: { type: 'choice', instructions: 'Which team?', criteria: { billing: null, support: null, sales: null } } } });
    if (r.status === 200) ms.push(r.ms);
  }
  const s = [...ms].sort((a, b) => a - b);
  return { calls: n, ok: ms.length, p50: s[Math.floor(s.length * 0.5)], p90: s[Math.floor(s.length * 0.9)], min: s[0], max: s[s.length - 1] };
}

const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(PROVIDERS);
const results = { measuredAt: new Date().toISOString(), machine: process.env.SYSTEMONE_MACHINE ?? 'RTX 4090 24 GB, 64 GB RAM, Windows 11, venvs from systemone.ps1', providers: {} };
for (const id of only) {
  const p = PROVIDERS[id];
  const warm = await call(p, { state: 'warm up', questions: { x: { type: 'noul', instructions: 'This is a test.' } } }, 180000);
  if (warm.status !== 200) { results.providers[id] = { unreachable: warm }; console.error(id, 'unreachable', warm); continue; }
  console.error(`[${id}] shapes`); const sh = await shapes(p);
  console.error(`[${id}] latency`); const lat = await latency(p);
  console.error(`[${id}] option ceiling`); const oc = await optionCeiling(p, TICKETS, [5, 20, 60]);
  console.error(`[${id}] finnish`); const fi = await optionCeiling(p, TICKETS_FI, [5, 20]);
  console.error(`[${id}] context`); const cx = await contextLimit(p);
  results.providers[id] = { shapes: sh, latency: lat, optionCeiling: oc, finnishContent: fi, context: cx };
}
mkdirSync(dirname(process.argv[2]), { recursive: true });
writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, (k, v) => (k === 'answers' ? undefined : v), 2));
