/**
 * @file src/services/build-app-publish-walkthrough.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classic app-building prompt's after-build publish walkthrough (new-app mode only):
 *   how the person publishes the finished HTML from the App Catalog, and what they get. Moved
 *   unchanged out of build-app-prompt.ts when that file reached the 800-line ceiling.
 * @structure publishWalkthrough(nodeUrl)
 * @usage if (!isImprove) body += publishWalkthrough(nodeUrl);
 * @version-history
 *   v1.0.1 — 2026-10-17 — The V2.6 line is shorter, so part `start` of the layered spec stays under its 24,000-character cap.
 *   v1.0.0 — 2026-10-17 — Moved unchanged from build-app-prompt.ts.
 */

/** The walkthrough text, exactly as the prompt has carried it. */
export function publishWalkthrough(nodeUrl: string): string {
  let body = '';
  body += '## When the app is ready — tell me how to publish it\n';
  body += 'After you hand me the finished single HTML file, END your reply by telling me (in my language) to do exactly this:\n';
  body += '1. Open ' + nodeUrl + '/v1/appcat\n';
  body += '2. Click "+" → "Add app" → the "Paste" tab → paste the HTML (or drop it as a file). The app name + description fill in automatically.\n';
  body += '3. Click Save. A second dialog opens: fill in the description and click Publish. (Two dialogs, not one — Save takes the file, Publish puts it on the node.)\n';
  body += 'I will be asked to sign in first — it is fast: one click with Google, or a quick email + password, and a brand-new account is created right there in seconds.\n';
  body += 'What I get: the app goes live on my own AIMEAT node at its own address, and I get a link to share. It starts UNLISTED (only I can find it) — from my catalogue I can list it publicly in the community catalogue, launch it, publish updates (older versions are always kept), or delete it. It keeps working with my AIMEAT login, saved data, files, AI and realtime features.\n';
  // Additive (plan doc-mvcn6c7e4e5q V2.6): "unlisted" is about lists, not about who opens the link.
  body += 'Unlisted is about lists: the link still opens it. In its settings I choose who may open it.\n\n';
  return body;
}
