/**
 * @file test/unit/atelier-dropzone-copy.test.ts
 * @description Three helpers that replace code the apps wrote by hand, over the stub DOM: the
 *   dropzone's uploads through a stub AIMEAT.storage (the rows, one file at a time, pending(), the
 *   chunked progress, the failure in words, the Open link for a public file, and the zone drawn
 *   exactly as before without `upload` or without the library); the kit's copy() and what the
 *   prompt panel and the forms list say when the browser refuses; and agentface's publishQuietly
 *   (nothing signed out, never a throw, an unchanged face skipped, a burst written once, in order).
 * @version-history
 *   v1.1.0 - 2026-10-02 - The dropzone's accept takes type families ('image/*'), with extensions and
 *     whole types still working, and the picker carries the same list; the zone's parts are marked.
 *   v1.0.0 - 2026-10-01 - Initial.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let parts: any;
let copyMod: any;
let wbp: any;
let intake: any;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });
async function settle() { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); }

/** A file as the zone reads it: a name, a size and a type. */
const file = (name: string, size = 10, type = 'image/png') => ({ name, size, type });

/** Hand the zone files the way the picker does. */
function pick(zone: any, files: any[]) {
  const input = all(zone.el).find((n) => n.tagName === 'INPUT');
  input.files = files;
  input.dispatchEvent({ type: 'change' });
}

/** A stub AIMEAT.storage: each upload waits until the test releases it. */
function stubStorage() {
  const calls: Array<{ op: string; file: any; opts: any }> = [];
  const gates: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
  const lib = {
    upload(f: any, opts: any) {
      calls.push({ op: 'upload', file: f, opts });
      return new Promise((resolve, reject) => gates.push({ resolve, reject }));
    },
    uploadChunked(f: any, opts: any) {
      calls.push({ op: 'uploadChunked', file: f, opts });
      return new Promise((resolve, reject) => gates.push({ resolve, reject }));
    },
    viewUrl: async (ref: string) => 'http://localhost:40050/v1/pub/' + ref,
  };
  return { lib, calls, gates };
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {};
  parts = await import('../../src/static/sdk-libs/atelier/parts.js');
  copyMod = await import('../../src/static/sdk-libs/atelier/copy.js');
  wbp = await import('../../src/static/sdk-libs/atelier/workbench-parts.js');
  intake = await import('../../src/static/sdk-libs/atelier/intake-form.js');
});
afterAll(() => restore());

beforeEach(() => {
  (window as any).AIMEAT = {};
  // removeChild, not innerHTML = '': the stub's innerHTML leaves a child's parentNode set, so the
  // kit's toast host would think it is still on the page.
  for (const c of [...(document.body as any).children]) document.body.removeChild(c);
});

describe('dropzone without uploads', () => {
  it('draws the same zone with `upload` and no storage library as without `upload`, and only calls onFiles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = document.createElement('div');
    const b = document.createElement('div');
    const gotA: any[] = [];
    const gotB: any[] = [];
    const za = parts.dropzone({ target: a, accept: ['.png'], hint: 'Pictures', onFiles: (f: any) => gotA.push(f) });
    const zb = parts.dropzone({ target: b, accept: ['.png'], hint: 'Pictures', upload: { visibility: 'public' }, onFiles: (f: any) => gotB.push(f) });
    expect(b.outerHTML).toBe(a.outerHTML);
    pick(za, [file('a.png')]);
    pick(zb, [file('a.png')]);
    pick(zb, [file('b.png')]);
    await settle();
    expect(b.outerHTML).toBe(a.outerHTML);
    expect(gotA.length).toBe(1);
    expect(gotB.length).toBe(2);
    expect(za.pending()).toBe(0);
    expect(zb.pending()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('still refuses a wrong kind in words and uploads nothing', async () => {
    const st = stubStorage();
    (window as any).AIMEAT.storage = st.lib;
    const host = document.createElement('div');
    const z = parts.dropzone({ target: host, accept: ['.png'], upload: {} });
    pick(z, [file('notes.txt', 10, 'text/plain')]);
    await settle();
    expect(host.textContent).toContain('notes.txt is not a kind this takes.');
    expect(st.calls.length).toBe(0);
    expect(part(host, 'files').length).toBe(0);
  });
});

describe('dropzone accept wildcards', () => {
  it("takes every photo with accept: ['image/*'] and puts the same value on the picker", () => {
    const host = document.createElement('div');
    const got: any[] = [];
    const z = parts.dropzone({ target: host, accept: ['image/*'], multiple: true, onFiles: (f: any) => got.push(...f) });
    const input = part(host, 'input')[0];
    expect(input.attrs.accept).toBe('image/*');
    pick(z, [file('IMG_0001.JPG', 10, 'image/jpeg'), file('IMG_0002.HEIC', 10, 'image/heic'), file('shot.png', 10, 'image/png')]);
    expect(got.map((f) => f.name)).toEqual(['IMG_0001.JPG', 'IMG_0002.HEIC', 'shot.png']);
    expect(part(host, 'error')[0].hidden).toBe(true);
    pick(z, [file('menu.pdf', 10, 'application/pdf')]);
    expect(part(host, 'error')[0].hidden).toBe(false);
    expect(part(host, 'error')[0].textContent).toContain('menu.pdf is not a kind this takes.');
    // 'image/*' is not 'imagex/…': the slash is part of the start.
    pick(z, [file('odd.bin', 10, 'imagex/raw')]);
    expect(got.length).toBe(3);
  });

  it('keeps extensions and whole types working beside a wildcard', () => {
    const host = document.createElement('div');
    const got: any[] = [];
    const z = parts.dropzone({ target: host, accept: ['.MD', 'application/pdf', 'video/*'], multiple: true, onFiles: (f: any) => got.push(...f) });
    expect(part(host, 'input')[0].attrs.accept).toBe('.md,application/pdf,video/*');
    pick(z, [file('notes.md', 10, ''), file('menu.pdf', 10, 'application/pdf'), file('clip.mov', 10, 'video/quicktime')]);
    expect(got.map((f) => f.name)).toEqual(['notes.md', 'menu.pdf', 'clip.mov']);
    pick(z, [file('photo.jpg', 10, 'image/jpeg')]);
    expect(got.length).toBe(3);
  });

  it('reads an accept list the way the browser does', () => {
    const ok = (name: string, type: string, accept: string[]) => parts.acceptsFile({ name, type }, accept);
    expect(ok('a.png', 'image/png', [])).toBe(true);
    expect(ok('a.png', 'IMAGE/PNG', ['image/*'])).toBe(true);
    expect(ok('a', '', ['image/*'])).toBe(false);
    expect(ok('a.txt', 'text/plain', ['*/*'])).toBe(true);
    expect(ok('a.txt', 'text/plain', ['.png', 'image/png'])).toBe(false);
    expect(ok('README', '', ['.readme'])).toBe(false);
  });

  it('marks the zone and its picker with data-ak-part', () => {
    const host = document.createElement('div');
    parts.dropzone({ target: host, hint: 'Pictures' });
    for (const p of ['root', 'label', 'hint', 'error', 'input']) expect(part(host, p).length).toBe(1);
  });
});

describe('dropzone with uploads', () => {
  it('uploads one file at a time, counts pending, says saved with the key and calls onUploaded', async () => {
    const st = stubStorage();
    (window as any).AIMEAT.storage = st.lib;
    const host = document.createElement('div');
    const done: any[] = [];
    const z = parts.dropzone({
      target: host, multiple: true,
      upload: { key: (f: any) => 'inbox/' + f.name, visibility: 'workspace', workspaceRef: 'org1/ws1' },
      onUploaded: (f: any, ans: any) => done.push([f.name, ans.key]),
    });
    pick(z, [file('one.png'), file('two.png')]);
    await settle();
    expect(z.pending()).toBe(2);
    expect(st.calls.length).toBe(1);
    expect(st.calls[0].opts).toEqual({ key: 'inbox/one.png', visibility: 'workspace', workspace_ref: 'org1/ws1' });
    const rows = part(host, 'file');
    expect(rows.map((r) => r.attrs['data-ak-state'])).toEqual(['uploading', 'waiting']);
    expect(rows[0].textContent).toContain('Uploading…');
    expect(rows[1].textContent).toContain('Waiting');
    // The rows sit after the zone, never inside it: the zone is a button.
    expect(part(z.el, 'files').length).toBe(0);

    st.gates[0].resolve({ key: 'inbox/one.png', visibility: 'workspace' });
    await settle();
    expect(z.pending()).toBe(1);
    expect(st.calls.length).toBe(2);
    expect(rows[0].textContent).toContain('Saved as inbox/one.png');
    expect(part(rows[0], 'open').length).toBe(0);
    st.gates[1].resolve({ key: 'inbox/two.png', visibility: 'workspace' });
    await settle();
    expect(z.pending()).toBe(0);
    expect(done).toEqual([['one.png', 'inbox/one.png'], ['two.png', 'inbox/two.png']]);
    z.destroy();
    expect(host.children.length).toBe(0);
  });

  it('goes up in chunks over chunkedOver, with the percent in words and on the bar', async () => {
    const st = stubStorage();
    (window as any).AIMEAT.storage = st.lib;
    const host = document.createElement('div');
    const z = parts.dropzone({ target: host, upload: { chunkedOver: 100 } });
    pick(z, [file('big.mov', 500, 'video/quicktime')]);
    await settle();
    expect(st.calls[0].op).toBe('uploadChunked');
    st.calls[0].opts.onProgress({ chunk: 1, total: 5, percent: 40 });
    const row = part(host, 'file')[0];
    expect(row.textContent).toContain('Uploading… 40%');
    expect(part(row, 'bar')[0].value).toBe(40);
    pick(z, [file('small.png', 50)]);
    st.gates[0].resolve({ key: 'big.mov', visibility: 'private' });
    await settle();
    expect(st.calls[1].op).toBe('upload');
  });

  it('says a failure in words and calls onUploadError', async () => {
    const st = stubStorage();
    (window as any).AIMEAT.storage = st.lib;
    const host = document.createElement('div');
    const errs: any[] = [];
    const z = parts.dropzone({ target: host, upload: {}, onUploadError: (f: any, e: any) => errs.push([f.name, e.message]) });
    pick(z, [file('x.png')]);
    await settle();
    st.gates[0].reject(new Error('Not signed in'));
    await settle();
    const row = part(host, 'file')[0];
    expect(row.attrs['data-ak-state']).toBe('failed');
    expect(row.textContent).toContain('Did not upload: Not signed in');
    expect(errs).toEqual([['x.png', 'Not signed in']]);
    expect(z.pending()).toBe(0);
  });

  it('links a public file through viewUrl with its owner and key', async () => {
    const st = stubStorage();
    (window as any).AIMEAT.storage = st.lib;
    const host = document.createElement('div');
    const z = parts.dropzone({ target: host, upload: { visibility: 'public' } });
    pick(z, [file('cat.png')]);
    await settle();
    st.gates[0].resolve({ key: 'cat.png', owner_gaii: 'alice@node', visibility: 'public' });
    await settle();
    const open = part(host, 'open')[0];
    expect(open.attrs.href).toBe('http://localhost:40050/v1/pub/alice@node/cat.png');
    expect(open.textContent).toBe('Open');
  });
});

describe('copy', () => {
  let saved: any;
  beforeEach(() => {
    const nav = navigator as any;
    saved = { write: nav.clipboard.writeText, exec: (document as any).execCommand, sel: (globalThis as any).getSelection };
  });
  afterEach(() => {
    (navigator as any).clipboard.writeText = saved.write;
    (document as any).execCommand = saved.exec;
    (globalThis as any).getSelection = saved.sel;
  });
  function refuseClipboard() {
    (navigator as any).clipboard.writeText = () => Promise.reject(new Error('NotAllowedError'));
    (document as any).execCommand = () => false;
  }
  function recordSelection() {
    const picked: any[] = [];
    (globalThis as any).getSelection = () => ({ removeAllRanges() {}, addRange(r: any) { picked.push(r.node); } });
    const make = (document as any).createRange;
    (document as any).createRange = () => { const r = make(); r.selectNodeContents = (n: any) => { r.node = n; }; return r; };
    return { picked, undo() { (document as any).createRange = make; } };
  }

  it('writes through the clipboard API and answers true', async () => {
    const writes = (navigator as any).clipboard.writes;
    expect(await copyMod.copy('hello')).toBe(true);
    expect(writes[writes.length - 1]).toBe('hello');
  });

  it('falls back to the hidden textarea when the API refuses, and answers false when that fails too', async () => {
    (navigator as any).clipboard.writeText = () => Promise.reject(new Error('NotAllowedError'));
    (document as any).execCommand = () => true;
    expect(await copyMod.copy('x')).toBe(true);
    expect(document.body.children.length).toBe(0);
    (document as any).execCommand = () => false;
    expect(await copyMod.copy('x')).toBe(false);
  });

  it('uses AIMEAT.agentface.copyText when the page loads it, and a throw there answers false', async () => {
    const seen: string[] = [];
    (window as any).AIMEAT.agentface = { copyText: async (t: string) => { seen.push(t); return true; } };
    expect(await copyMod.copy('via face')).toBe(true);
    expect(seen).toEqual(['via face']);
    (window as any).AIMEAT.agentface = { copyText: () => { throw new Error('boom'); } };
    expect(await copyMod.copy('x')).toBe(false);
  });

  it('the prompt panel opens the whole prompt, selects it and says to press Ctrl+C when copying is refused', async () => {
    refuseClipboard();
    const sel = recordSelection();
    const host = document.createElement('div');
    const prompt = 'Line one\nLine two\nLine three';
    wbp.promptPanel({ target: host, prompt });
    click(part(host, 'copy')[0]);
    await settle();
    const preview = part(host, 'preview')[0];
    expect(preview.textContent).toBe(prompt);
    expect(sel.picked[0]).toBe(preview);
    expect(document.body.textContent).toContain('The whole prompt is selected: press Ctrl+C');
    sel.undo();
  });

  it('the prompt panel still says Copied when it worked', async () => {
    const host = document.createElement('div');
    wbp.promptPanel({ target: host, prompt: 'Short' });
    click(part(host, 'copy')[0]);
    await settle();
    expect(document.body.textContent).toContain('Copied');
    expect(part(host, 'preview')[0].textContent).toContain('(1 line)');
  });

  it('the forms list shows the link selected for Ctrl+C when copying is refused', async () => {
    refuseClipboard();
    const sel = recordSelection();
    (window as any).AIMEAT.intake = { listForms: async () => [{ form_id: 'contact-us', title: 'Contact us', enabled: true }] };
    const host = document.createElement('div');
    intake.intakeAdmin({ target: host, org: 'org1', ws: 'ws1' });
    await settle();
    click(part(host, 'copy')[0]);
    await settle();
    const notice = part(host, 'notice')[0];
    expect(notice.hidden).toBe(false);
    // The link carries org and ws since e66081a3b, so intakeForm opens it without the app's choice.
    expect(notice.textContent).toBe('Copy this link: http://localhost:40050/?form=contact-us&org=org1&ws=ws1');
    expect(sel.picked[0].textContent).toBe('http://localhost:40050/?form=contact-us&org=org1&ws=ws1');
    sel.undo();
  });
});

describe('agentface publishQuietly', () => {
  let face: any;
  let posts: any[];
  let answer: () => any;
  let signedIn: boolean;

  beforeAll(async () => {
    (window as any).AIMEAT = {};
    await import('../../src/static/sdk-libs/agentface/index.js');
    face = (window as any).AIMEATAgentFace;
  });
  beforeEach(() => {
    posts = [];
    signedIn = true;
    answer = () => ({ ok: true, data: { version: 1 } });
    (window as any).AIMEAT = {
      agentface: face,
      auth: { getSession: () => (signedIn ? { fetch: async (_url: string, init: any) => { posts.push(JSON.parse(init.body)); return answer(); } } : null) },
    };
  });

  it('keeps publish() as it was: it still throws signed out', async () => {
    signedIn = false;
    await expect(face.publish('# A', { app: 'a.html' })).rejects.toThrow(/Not signed in/);
  });

  it('does nothing and answers false signed out or without aimeat-auth', async () => {
    signedIn = false;
    expect(await face.publishQuietly('# A', { app: 'q1.html' })).toBe(false);
    delete (window as any).AIMEAT.auth;
    expect(await face.publishQuietly('# A', { app: 'q1.html' })).toBe(false);
    expect(posts.length).toBe(0);
  });

  it('writes, then skips the same markdown, then writes a change', async () => {
    expect(await face.publishQuietly({ title: 'Shop', sections: [{ heading: 'Open', body: '9-17' }] }, { app: 'q2.html' })).toBe(true);
    expect(posts[0]).toEqual({ key: 'apps.q2.html.agentface', value: '# Shop\n\n## Open\n\n9-17\n', visibility: 'public' });
    expect(await face.publishQuietly('# Shop\n\n## Open\n\n9-17\n', { app: 'q2.html' })).toBe(false);
    expect(await face.publishQuietly(() => '# Shop\n\nClosed\n', { app: 'q2.html' })).toBe(true);
    expect(posts.length).toBe(2);
  });

  it('never throws: a refusal, a bad input and a missing filename each log one warn line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer = () => ({ ok: false, error: { message: 'forbidden' } });
    expect(await face.publishQuietly('# B', { app: 'q3.html' })).toBe(false);
    expect(await face.publishQuietly({ sections: [{ heading: '' }] }, { app: 'q3.html' })).toBe(false);
    expect(await face.publishQuietly('# B')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0][0])).toContain('forbidden');
    // A failed write is tried again by the next call with the same markdown.
    answer = () => ({ ok: true, data: { version: 2 } });
    expect(await face.publishQuietly('# B', { app: 'q3.html' })).toBe(true);
    warn.mockRestore();
  });

  it('with debounceMs writes only the last call of a burst, read when the write happens', async () => {
    vi.useFakeTimers();
    let state = 'one';
    const results = [
      face.publishQuietly(() => '# ' + state, { app: 'q4.html', debounceMs: 500 }),
      face.publishQuietly(() => '# ' + state, { app: 'q4.html', debounceMs: 500 }),
      face.publishQuietly(() => '# ' + state, { app: 'q4.html', debounceMs: 500 }),
    ];
    state = 'three';
    await vi.advanceTimersByTimeAsync(499);
    expect(posts.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.all(results)).toEqual([false, false, true]);
    expect(posts.map((p) => p.value)).toEqual(['# three\n'.trim()]);
    vi.useRealTimers();
  });

  it('writes one app\'s faces in call order', async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => { release = r; });
    let first = true;
    (window as any).AIMEAT.auth.getSession = () => ({ fetch: async (_u: string, init: any) => {
      if (first) { first = false; await slow; }
      posts.push(JSON.parse(init.body).value);
      return { ok: true, data: {} };
    } });
    const a = face.publishQuietly('# first', { app: 'q5.html' });
    const b = face.publishQuietly('# second', { app: 'q5.html' });
    await settle();
    expect(posts).toEqual([]);
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(posts).toEqual(['# first', '# second']);
  });
});
