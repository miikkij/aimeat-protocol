/**
 * @file test/unit/check-dialogs.test.ts
 * @description Proof that `pnpm check:dialogs` catches the shapes a hand-rolled dialog takes: a
 *   fixed overlay in a stylesheet, a second ::backdrop look, a <dialog> opened or declared outside
 *   the component, and a role="dialog" box. And that it stays quiet for the component's own use,
 *   for comments that talk about dialogs, and for a full-screen page layer that is not named one.
 *   The findings function is pure, so every case is a string in and a list out.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-dialogs.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial, with the gate (wish "Yksi dialogikomponentti kaikille dialogeille").
 */
import { describe, it, expect } from 'vitest';
import { dialogFindings } from '../../scripts/check-dialogs.js';

describe('check:dialogs findings', () => {
  it('finds a fixed overlay in a view sheet, and not a fixed panel', () => {
    const css = `.pf-edit-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); }
      .inbox--panel { position: fixed; inset: 0; }
      .koti-modal-body { padding: 1rem; }`;
    const found = dialogFindings('public/css/views/x.css', css);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('.pf-edit-overlay');
  });

  it('finds a second backdrop look', () => {
    expect(dialogFindings('public/css/views/x.css', '.x::backdrop { background: red; }')).toHaveLength(1);
  });

  it('ignores a stylesheet comment that names an overlay', () => {
    expect(dialogFindings('public/css/views/x.css', '/* .old-overlay { position: fixed } left in v2 */ .a { color: red; }')).toEqual([]);
  });

  it('finds showModal, role="dialog", aria-modal and a <dialog> without the dlg class in a view', () => {
    const js = [
      "ref.current.showModal();",
      'html`<div class="box" role="dialog" aria-modal="true">`',
      'html`<dialog class="my-box">`',
    ].join('\n');
    const found = dialogFindings('public/views/x.js', js);
    expect(found.join('\n')).toContain('showModal');
    expect(found.join('\n')).toContain('role="dialog"');
    expect(found.join('\n')).toContain('aria-modal');
    expect(found.join('\n')).toContain('<dialog> without the dlg class');
  });

  it('accepts the component shape: a <dialog class="dlg …"> and one built with the dlg class', () => {
    const html = '<dialog id="help-overlay" class="dlg modal dlg--md"><header class="dlg-head"></header></dialog>';
    expect(dialogFindings('src/static/app-catalog/_template.html', html)).toEqual([]);
    const js = "var d = document.createElement('dialog');\nd.className = 'dlg modal dlg--md';\nopenDlg(d);";
    expect(dialogFindings('src/static/app-catalog/js/server-io.js', js)).toEqual([]);
  });

  it('finds a <dialog> built without the dlg class', () => {
    const js = "var d = document.createElement('dialog'); d.className = 'mine'; document.body.appendChild(d);";
    expect(dialogFindings('public/js/x.js', js)).toHaveLength(1);
  });

  it('ignores comments that describe a dialog, and a URL that looks like a line comment', () => {
    const js = "// the old role=\"dialog\" box called showModal()\n/* aria-modal was here */\nfetch('https://x.io/a');";
    expect(dialogFindings('public/views/x.js', js)).toEqual([]);
  });

  it('a function named showModal is not a call on a <dialog>', () => {
    expect(dialogFindings('src/static/app-catalog/js/apps-io.js', 'function showModal() { openDlg("modal-overlay"); }\nshowModal();')).toEqual([]);
  });
});
