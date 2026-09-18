/**
 * @file build-app-prompt-driven.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The build specification's section on the prompt-driven workflow: AI work done in
 *   the person's own chat, with aimeat-prompt.js as the component.
 *
 *   The specification taught one way for an app to get AI work done, aimeat-ai, which needs the
 *   person to hold an OpenRouter key. The prompt-driven workflow is the road in for everyone that
 *   leaves out, and for a person whose AI cannot connect to the node over MCP; apps that used it
 *   each built their own copy button and their own JSON digging. Item 10 of the instruction
 *   review of 2026-09-18, approved by the developer.
 *
 *   Its own file because services/build-app-prompt.ts is at the 800-line limit.
 * @structure buildPromptDrivenSection(nodeUrl)
 * @usage body += buildPromptDrivenSection(nodeUrl);   // before the aimeat-ai section
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */

export function buildPromptDrivenSection(nodeUrl: string): string {
  let body = '';
  body += "### AI work in the person's own chat: the prompt-driven workflow (aimeat-prompt.js)\n";
  body += 'The app composes a prompt, the person copies it into THEIR OWN AI chat (Claude, ChatGPT, Gemini, Copilot, anything) and pastes the answer back; the app reads it and carries on. It costs the app nothing, needs no model key and no MCP connection, and the person sees everything that leaves and everything that comes back. Choose it over the `aimeat-ai` section below when the work can wait for a person to paste (a plan, a draft, a classification of their own data), and choose `aimeat-ai` when the answer has to arrive inside the app without them leaving it.\n';
  body += '```javascript\n';
  body += '// <script src="' + nodeUrl + '/v1/libs/aimeat-prompt.js"></' + 'script>\n';
  body += 'AIMEAT.prompt.card("#plan", {\n';
  body += '  label: "Plan my week",\n';
  body += '  prompt: () => "My tasks: " + JSON.stringify(tasks) + ". Spread them over next week. Answer with JSON only: {\\"days\\": [{\\"date\\": \\"YYYY-MM-DD\\", \\"tasks\\": [string]}]}",\n';
  body += '  expect: "json",                                   // parsed for you, also out of a fenced block with prose around it\n';
  body += '  validate: (v) => Array.isArray(v && v.days) ? null : "The answer has no days list. Paste the whole answer.",\n';
  body += '  onResult: async (plan) => { await AIMEAT.data.set("myapp.plan", plan, { visibility: "private" }); render(); },\n';
  body += '});\n';
  body += '```\n';
  body += 'Three rules. **The work is in the prompt text**: say what the person wants, include the data the AI needs, end with the exact shape to answer in. **A chain is two cards**: the first `onResult` saves its answer, the second `prompt` is a function that reads it, so it is current when the person copies. **The answer is untrusted text** from a chat the app cannot see: check its shape in `validate`, render it with `textContent`, never `innerHTML`, never `eval`.\n\n';
  return body;
}
