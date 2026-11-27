/**
 * @file src/services/builder/atelier-moments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One section of the Atelier build specification: what the kit gives for the moments
 *   where an app and a person meet (a stop, a proposal, a hand-off to the person's own AI), how the
 *   frame of a page is chosen from what the work is (stage, reading), and how a build starts from,
 *   or becomes, one of the owner's own app templates.
 *
 *   WHY. The Design Book's own record of parts builders made by hand (read 2026-11-27) showed the
 *   same things written again in app after app: a sentence for the person's own AI in nine apps, a
 *   working surface made the whole page in at least eight, a draft the person reads and sends in
 *   three, a "sign in first" line in every block. The kit has them since aimeat-atelier 0.73.0, and
 *   a builder who is not told uses none of it.
 *
 *   EVERYTHING HERE IS OPTIONAL FOR THE BUILDER. The section says what exists and when it fits; it
 *   forbids nothing and no publish check reads it. That is a ruling
 *   (decision-atelier-uudet-hetket-kehykset-ja-sovelluspohjat-ovat-lis-yks): the new parts stand
 *   beside what worked, and an app takes them when they suit it.
 *
 *   ITS PART IS `screens` (atelier-layers.ts), because the frame is a decision about the phone and
 *   the desktop and that part had the room: `genre` and `libraries` were at their limit.
 * @structure ATELIER_MOMENTS_SECTION
 * @usage body += ATELIER_MOMENTS_SECTION;   // after ATELIER_SCREENS_SECTION, part `screens`
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-atelier-contextual-templates-pyynt-lohko-ask). Carries
 *     ATELIER_STRUCTURE_FRAME_LINES (structure-step.ts): what the plan's `frame` and `moments`
 *     choices mean in kit code, which did not fit part `libraries`.
 */
import { ATELIER_STRUCTURE_FRAME_LINES } from './structure-step.js';

/** The section's heading, as atelier-layers.ts places it. */
export const ATELIER_MOMENTS_HEADING = 'The frame, the moments and the owner\'s templates';

/** The section, ending in a blank line like every other section of the specification. */
export const ATELIER_MOMENTS_SECTION = '## ' + ATELIER_MOMENTS_HEADING + '\n\n'
  + 'All of this is optional: take what fits this app, and say in your proposal which of it you take.\n\n'
  + '**Choose the frame by what the work is.** When one working surface IS the app (a map, a drawing, an editor, a simulation, a 3D view, a board), '
  + 'give `AIMEAT.atelier.app()` `frame: \'stage\'`: the surface fills the page under the bar (`handle.main`), and `controls: { title }` gives one panel for your controls '
  + '(`handle.controls`) that floats on a wide window and is a sheet at the bottom edge of a phone. Do not put such a surface in a card on a scrolling page. '
  + 'A long text read from start to end takes `frame: \'reading\'`. Several work views used every day take `nav: \'side\'`. Everything else stays the default page.\n\n'
  + '**What an area needs is said once.** An area that works only for a signed-in person, only when their AI answers, or only for a member: '
  + '`AIMEAT.atelier.requires({ target, needs: [\'session\', \'ai\', \'member:<cap>\'], app, render(host) { … } })` draws the right stop, waits, and calls `render` once. '
  + 'It replaces a "sign in first" line of your own and your own session check for that area; the pill in the masthead stays the only sign-in control. '
  + 'A stop you know yourself is `AIMEAT.atelier.ask({ target, kind })`: signIn, settings, access, permission, refused, device, limit, offline.\n\n'
  + '**When the app or an agent proposes and the person decides,** draw it with `AIMEAT.atelier.propose({ kind })`: `draft` (a message read before it is sent), '
  + '`extract` (a value beside the sentence it was read from), `change` (taken or left whole), `run` (a plan before it runs). Whether the person approves is the owner\'s setting: '
  + 'read it and pass `gate: false` when they turned approval off, and the same block then says what was done.\n\n'
  + '**A sentence the person takes to their own AI** (to make an agent, to start a piece of work) is `AIMEAT.atelier.handoff({ kind: \'say\', text })`; '
  + 'a prompt whose answer comes back is `kind: \'prompt\'`. The words of all of these are in the kit in en, fi and es, so you write only what is this app\'s own.\n\n'
  + '**The app\'s plan carries both choices** (`aimeat_app_manage` action `structure`, choices `frame` and `moments`; the person picks them on the structure page or leaves them to you):\n'
  + ATELIER_STRUCTURE_FRAME_LINES + '\n'
  + '**Find a kit part by its use before you make one:** `AIMEAT.atelier.find(\'confirm\')`, `find(\'wait\')`, `find(\'list\')`; `describe(name).use` says what a part is for.\n\n'
  + '**If the owner has a template for this, start from it.** `aimeat_app_template_list` names the owner\'s own templates. One with a `recipe` says the look, the frame, the screens, '
  + 'the needs and moments, where the data is kept and the checks it carries, and `aimeat_app_template_get { id }` answers how to start from it. '
  + 'When the owner asks you to make a template from an app, read that app\'s own declarations (its style kit and genre, its `app()` frame, its `requires` needs and the moments it uses, '
  + 'its data map, its acceptance criteria), write them as the `recipe` of `aimeat_app_template_propose`, and show the owner the list in plain words so they can take out what they do not want.\n\n';
