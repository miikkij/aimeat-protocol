/**
 * @file src/services/build-atelier-motion-parts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The kit's controls that answer the hand (atelier 0.55.0), as the paragraph the
 *   Atelier specification carries after its motion section, each part with one sentence and one
 *   call. Its own file because build-atelier-prompt.ts is at the line ceiling, and in the `look`
 *   part of the specification rather than the component catalogue because `start`, where the
 *   catalogue is, is at the size one tool result holds.
 *
 *   WHY. Builders on this node made menus, command search and switches by hand because the kit
 *   had none that moved (the Design Book's own "made by hand" reasons, 2026-09-26), and Jouni
 *   asked on 2026-09-28 for UI parts that answer a press with visible motion. The parts are in
 *   the kit; this file is how a builder learns to reach for them instead of drawing their own.
 * @structure ATELIER_MOTION_COMPONENTS · atelierMotionParts()
 * @usage body += atelierMotionParts();
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (the ten motion parts).
 */

/** The motion parts as catalogue entries: one sentence and one call each. */
export const ATELIER_MOTION_COMPONENTS: ReadonlyArray<{ id: string; summary: string; example: string }> = [
  {
    id: 'toggle',
    summary: 'An on/off setting that takes effect at once: a checkbox with role="switch" whose knob stretches while pressed and travels to the other end. The form\'s type: \'toggle\' field is the same switch.',
    example: "AIMEAT.atelier.toggle({ target: host, label: 'Notifications', checked: true, onChange: function (on) { save(on); } });",
  },
  {
    id: 'segmented',
    summary: 'Two to five choices that change a view, side by side in one pill; the marker travels to the chosen one, and the arrow keys move it.',
    example: "AIMEAT.atelier.segmented({ target: host, label: 'Range', items: [{ id: 'd', label: 'Day' }, { id: 'w', label: 'Week' }], value: 'd', onChange: redraw });",
  },
  {
    id: 'slider',
    summary: 'A number picked by dragging, with its reading and unit beside it; the rail fills to the value and the control stretches when pulled past an end.',
    example: "AIMEAT.atelier.slider({ target: host, label: 'Volume', min: 0, max: 100, value: 40, unit: '%', onInput: setVolume });",
  },
  {
    id: 'menu',
    summary: 'The actions for one thing, behind one button: it grows from the button, the highlight follows the pointer and the arrow keys, and the chosen row blinks before the menu closes. contextMenu(el, spec) is the same at the pointer.',
    example: "AIMEAT.atelier.menu({ anchor: moreButton, items: [{ id: 'rename', label: 'Rename', hint: 'F2' }, '-', { id: 'delete', label: 'Delete', danger: true }], onPick: act });",
  },
  {
    id: 'popover',
    summary: 'A little more about one thing, opened from it: a box that grows from its anchor and closes on Escape or a click outside. tooltip(el, text) is the one-line version on hover and focus.',
    example: "AIMEAT.atelier.popover({ anchor: infoButton, label: 'Details', content: detailsNode });",
  },
  {
    id: 'island',
    summary: 'One element that becomes the next state: its size, corners and colour travel while its content changes through a short blur. Use it where an agent\'s work is shown: a pill that says it is working grows into a card with the result and an Approve button.',
    example: "var isl = AIMEAT.atelier.island({ target: host, content: 'Agent is writing…', shape: 'pill', tone: 'ink', live: true }); isl.set({ content: resultCard, shape: 'card', tone: 'surface' });",
  },
  {
    id: 'stateButton',
    summary: 'A button whose work takes a moment: its label becomes a spinner, then a check mark, then the label again; a failure shakes it and says so in words.',
    example: "AIMEAT.atelier.stateButton({ target: bar, label: 'Save', done: 'Saved', fail: 'Not saved', run: function () { return AIMEAT.data.set(key, value); } });",
  },
];

/** The paragraph the specification carries after the motion section. */
export function atelierMotionParts(): string {
  return 'CONTROLS THAT ANSWER THE HAND are the kit\'s, so never draw your own switch, menu, '
    + 'popover, segmented control or busy button: `toggle`, `segmented`, `slider`, `menu`, '
    + '`contextMenu`, `popover`, `tooltip`, `island` and `stateButton` move on the look\'s spring, '
    + 'carry the keyboard and the screen-reader wiring, and stand still under reduced motion. The '
    + 'tab row\'s chosen fill already travels, chart lines draw when seen, and `palette` grows from '
    + 'its button (`anchor`) and turns into the toast for an item with `done`. The feel of every '
    + 'one of them is three numbers, `--ak-spring-stiffness`, `--ak-spring-damping` and '
    + '`--ak-spring-mass`, which the layout\'s `tokens` may set and which the Design Book\'s '
    + 'motion parts `motion-spring-snappy`, `motion-spring-soft` and `motion-spring-heavy` carry '
    + 'ready: pick one of those for the app instead of tuning a number.\n\n'
    + ATELIER_MOTION_COMPONENTS.map((c) => '- `' + c.id + '`: ' + c.summary + '\n  `' + c.example + '`').join('\n')
    + '\n\n';
}
