/**
 * @file src/services/build-structure-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The section of the Atelier build interview that starts the app's plan and hands the
 *   person the structure page (services/app-structure.ts): the page that shows the app's steps
 *   from the first moment of building and lets the person pick a layout and a look by seeing them,
 *   with the choice going back to the AI that builds.
 *
 *   WHY (Jouni, 2026-10-29): a person new to building an app should see what they get, what the app
 *   consists of and where it stands, and the page is optional: "tätä ei ole pakko käyttää jos ei
 *   halua, voi vaan jatkaa ja sanoa että tehdään nyt vain se appsi". So the text tells the AI to
 *   start the plan and give the link, and never to wait for the page.
 *
 *   ITS OWN FILE because build-atelier-prompt.ts is near the 800-line limit. Served in part
 *   `libraries` of the layered specification (build-atelier-layers.ts), because part `start` is
 *   near the size one tool result carries; the index line of that part names it.
 * @structure ATELIER_STRUCTURE_HEADING · ATELIER_STRUCTURE_STEP
 * @usage full += buildDataMapStep('atelier') + ATELIER_STRUCTURE_STEP;
 * @version-history
 *   v1.2.0 — 2026-10-30 — The AI draws two or three layouts of its own in `proposals`, the steps stay off the chat,
 *     and the values come from the structure answer.
 *   v1.1.0 — 2026-10-29 — `custom` layout or nav with a note, and an unset choice means the AI decides.
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */

/** The heading, as build-atelier-layers.ts places it. */
export const ATELIER_STRUCTURE_HEADING = 'The structure page: the person follows the build';

export const ATELIER_STRUCTURE_STEP = `## ${ATELIER_STRUCTURE_HEADING}\n\n`
  + 'Every app has a structure page: the steps the app goes through (purpose, data, layout, look, build, builders, visibility, requirements), what is done and what is open, and a place where the person can pick a layout and a look by seeing them. Using it is the person\'s choice, and your work goes on whether they open it or not.\n'
  + '- As soon as you know the app\'s name and purpose, call `aimeat_app_manage` action `structure_set` with `filename`, `name` and `purpose` (over HTTP: PUT /v1/apps/me/<filename>/structure). Give the person `page_url` from the answer in one sentence: they can follow the app there and choose a layout and a look if they want to. The page shows the steps, so leave them out of the chat and ask there only what needs words; the person picks the layout, the look and who sees the app on the page too.\n'
  + '- In the same first call, draw two or three layouts for THIS app in `proposals.layout`, each with an `id`, a `name`, a `note` on what it gives the person and a `sketch`: rows top to bottom, each `{ "height": "s" | "m" | "l", "cells": [{ "w": "full" | "main" | "side" | "half" | "tiny", "label": "...", "tone": "ink" | "sun" }] }`, labels in the person\'s language. Make them differ in what matters for this app (for a game: the board alone, the board with a side panel, the board with its layers beside it). The page shows them first and the node\'s presets after them, so the person picks by seeing; `proposals.nav` works the same way when the way between views is a real choice. When the person picks one, the choice\'s value is its id, and a note on it is what they want changed.\n'
  + '- After the data map questions, write `data`: `{ "summary": "what the app keeps and whose it is", "personalData": "yes" | "no" | "unstated" }`. While you build, write `now`, one line on what you are doing; the page shows it live.\n'
  + '- Before you build the screens, and whenever the person says they chose something, read action `structure`. A choice with `"state": "waiting"` is the person\'s: build it, then write the same value with `"state": "done"`.\n'
  + '- When the person leaves the choice to you, choose `layout` (one of your proposals or a preset), `nav` and `look` from `values` in the structure answer, and write each with `note`, one sentence on why. Until a choice is made, leave it unset: the page then says the AI decides. A genre you fork from is `genre`, its Design Book id. When the person says who may see the app, write `visibility` (listed, community or unlisted).\n\n';
