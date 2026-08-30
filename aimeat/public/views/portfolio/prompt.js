/**
 * @file views/portfolio/prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Portfolio prompt builder — composes the self-contained HTML-builder
 *   prompt from the user's selected content, style, and auth gates. Extracted from
 *   portfolio.js to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-08-30 — Boards are Core again (RFC §27): the boards section tells the builder
 *     what a notice carries (category, author name, days left, replies, thanks, the poster's
 *     standing), that a visitor reads and a member publishes on the node, and how to page.
 *   v1.1.0 — 2026-08-28 — The "AIMEAT poster" design style: when chosen, the prompt carries the
 *     house face as concrete rules (faces, colours, the band, the rules, what to avoid), so the
 *     person's AI can build a page that matches the home it is linked from. The work is in the
 *     prompt text, as every prompt-driven feature here.
 *   v1.0.0 — 2026-07-13 — Extracted from portfolio.js (max-file-lines)
 */
import { NODE_URL } from './shared.js';

/* ── Prompt Builder ── */
export function buildPortfolioPrompt({ session, selectedImages, selectedApps, selectedBoards, selectedCortex, selectedMemories, portfolioType, designStyle, authGates, customTypeDesc, customGateDesc }) {
  const ghii = session.ghii || (session.owner + '@unknown');
  const url = NODE_URL;

  let prompt = `You are a portfolio website builder for AIMEAT.

The user wants to create a personal portfolio website. Generate a single, self-contained, downloadable HTML file.

**CRITICAL RULE: Only use data that is explicitly provided below.** Do NOT invent, fabricate, or hallucinate ANY content — no fake projects, no fake work experience, no fake skills, no fake contact info, no fake social links. If a section has no data provided for it, either omit that section entirely or show a clear placeholder like "Add your [projects/experience/skills] here" that the user can edit later.

## User Context
- GHII: ${ghii}
- Display Name: ${session.displayName || session.owner}
- Node URL: ${url}
`;

  // Selected images
  if (selectedImages.length > 0) {
    prompt += `\n## Selected Images (from AIMEAT storage)\nThese are the ONLY image URLs you may use. Do NOT reference any other image URLs.\n`;
    for (const img of selectedImages) {
      const sizeKb = Math.round(img.size / 1024);
      prompt += `- ${img.key} (${sizeKb}KB, ${img.mimeType}) → ${url}${img.url}\n`;
    }
  } else {
    prompt += `\n## Images\nNo images were selected. You have NO image URLs available. Use inline SVG placeholders, CSS shapes, or gradients for all visual elements. Do NOT reference any image URLs.\n`;
  }

  // Selected apps
  if (selectedApps.length > 0) {
    prompt += `\n## Published Apps\n`;
    for (const app of selectedApps) {
      prompt += `- ${app.filename} → ${url}${app.url}\n`;
    }
  }

  // Selected boards: the person's notice boards, read live by any visitor.
  if (selectedBoards.length > 0) {
    prompt += `\n## Notice boards (live, no auth needed for a public board)\n`;
    prompt += `A board is a notice board people and agents publish to. Fetch each board's notices anonymously with a plain GET (a public board answers without a session) and render them as a live section:\n`;
    for (const board of selectedBoards) {
      prompt += `- ${board.name} (${board.visibility}) → GET ${url}/v1/boards/${board.id}/posts?limit=10 · open on the node: ${url}/v1/profile?tab=boards\n`;
    }
    prompt += `The response is { ok, data: { posts: [...], cursor, authors: { [author_gaii]: { posts, thanks, since } } } }. Each post carries title, body (plain text, render it as text), category (a short word such as "for sale" or "wanted"; show it as a label), tags, author_gaii ("name@environment" for a person, "agent#name@environment" for that person's agent: show the name, and "name · agent" when an agent wrote it), created_at, ttl_expires_at (show "N days left"; a notice that has expired is not returned), replies (a count) and reactions (reactions.thanks is a list; show its length as "N thanks"). Show the poster's standing from authors[author_gaii] next to the name ("14 notices · 11 thanks"). A visitor can READ; publishing, replying and thanking need a signed-in session on the node, so put one door on the section that opens the board on the node (the profile link above) rather than a form of your own. Use the cursor field for a "show more" link (pass it back as ?cursor=). Show an honest empty state ("No notices right now") when posts is empty, and never invent notices.\n`;
  }

  // Selected cortex extensions
  if (selectedCortex.length > 0) {
    prompt += `\n## Cortex Extensions\n`;
    for (const ext of selectedCortex) {
      prompt += `- ${ext.name} v${ext.version} — "${ext.description}"\n`;
      prompt += `  Components: ${ext.componentTypes.join(', ')}\n`;
    }
  }

  // Selected memory entries — three delivery paths, decided by record visibility:
  //   public  → plain anonymous fetch from /v1/memory/:gaii/:key
  //   members → requested from the hosting viewer over the postMessage bridge
  //             (the viewer fetches with the VISITOR's session; anonymous → no data)
  //   other   → not deliverable to visitors at all; bake preview or placeholder
  const publicMems = selectedMemories.filter(m => m.visibility === 'public');
  const memberMems = selectedMemories.filter(m => m.visibility === 'members');
  const gatedMems = selectedMemories.filter(m => m.visibility !== 'public' && m.visibility !== 'members');
  if (selectedMemories.length > 0) {
    prompt += `\n## Memory Entries\n`;
    if (publicMems.length > 0) {
      prompt += `These PUBLIC entries can be fetched live (anonymously, no auth) for dynamic portfolio content:\n`;
      for (const mem of publicMems) {
        prompt += `- ${mem.key} → GET ${url}/v1/memory/${encodeURIComponent(mem.gaii || ghii)}/${encodeURIComponent(mem.key)}\n`;
      }
    }
    if (memberMems.length > 0) {
      prompt += `These MEMBERS-ONLY entries are readable by logged-in node members. Do NOT fetch them directly (an anonymous fetch returns 404). Request each from the hosting viewer over the postMessage bridge (see "Viewer Bridge" below) and render the value inside a [data-auth-required] section, keeping a [data-auth-placeholder] fallback:\n`;
      for (const mem of memberMems) {
        prompt += `- key: ${mem.key} · gaii: ${mem.gaii || ghii}\n`;
      }
    }
    if (gatedMems.length > 0) {
      prompt += `These entries are NOT readable by visitors at all (any fetch attempt returns 401/404). Represent each with its preview text baked into the HTML, or a placeholder the user can edit:\n`;
      for (const mem of gatedMems) {
        prompt += `- ${mem.key} (visibility: ${mem.visibility})${mem.preview ? ` — preview: ${mem.preview}` : ''}\n`;
      }
    }
  }

  // Portfolio requirements
  const typeLabels = { cv: 'Professional / CV', creative: 'Creative / Art Showcase', dev: 'Developer / Technical', personal: 'Personal / Blog-style', custom: 'Custom' };
  const styleLabels = { poster: 'AIMEAT poster (the house style, specified below)', minimal: 'Minimal & Clean', bold: 'Bold & Colorful', dark: 'Dark & Modern', classic: 'Classic & Elegant' };

  prompt += `
## Portfolio Requirements
- Type: ${typeLabels[portfolioType] || portfolioType}${portfolioType === 'custom' && customTypeDesc ? ` — ${customTypeDesc}` : ''}
- Design Style: ${styleLabels[designStyle] || designStyle}
`;

  // The house style, as rules a model can follow. It is the face of the home this page is linked
  // from, so a person who picks it gets a portfolio that reads as part of the same place.
  if (designStyle === 'poster') {
    prompt += `
## The AIMEAT poster style (follow these exactly)
An editorial poster: big type, ink rules, one diagonal colour band, and a lot of paper.
- Faces: headlines in "Archivo Black" (uppercase, tight letter-spacing around -0.03em, line-height 0.9), body and labels in "Archivo" (weights 400/600/800), small facts (addresses, dates, counts) in "JetBrains Mono". Load them from Google Fonts with a <link> in <head>; give every face a system fallback (Arial Black / Arial / monospace).
- Colours, and only these: paper #FAFAF8 (background), ink #1A1A2E (text, rules, the one solid button), coral #E8564A (the band, one accent word in a headline, links), sun #FFB52E (highlights, the stripe under the band, the selected thing). No gradients, no drop shadows with blur, no rounded corners anywhere.
- The masthead: the person's name as the headline, very large (5rem and up on desktop, 2.6rem on a phone), one word of it in coral. Under it a one-line kicker in mono.
- The band: one full-width coral band rotated about -3deg with a 20px sun stripe along its lower edge, carrying two to four big numbers in paper (Archivo Black, 4rem+) with an uppercase label under each, and one call-to-action as an ink rectangle with a solid 8px offset sun shadow. Use overflow: hidden on the band's wrapper so the rotation never causes a horizontal scrollbar, and make the wrapper tall enough that the numbers sit fully on the coral at both ends.
- Sections: no cards. A section is a headline (Archivo Black, uppercase, 2.4rem) over a 3px ink rule; lists are rows separated by 2px ink rules with a two-digit mono index in coral on the left (01, 02, 03) and an arrow on the right; a fact table is a two-column grid with uppercase coral labels.
- Highlights: a sun background behind a phrase or a selected row, with ink text. Quiet actions are uppercase 800-weight words with a 2px ink underline; there is exactly one solid ink button per screen.
- Phone (under 640px): the band goes straight (no rotation), the numbers go two per row, everything else stacks.
- Avoid: emoji, icon fonts, cards with borders on all four sides, rounded pills, more than two type sizes per section, decorative images that were not provided.
`;
  }

  // Auth-gated sections
  if (authGates.length > 0) {
    const gateLabels = { contact: 'Contact information', projectDetails: 'Project details', downloads: 'Download links', custom: customGateDesc ? `Custom sections: ${customGateDesc}` : 'Custom sections (ask user)' };
    prompt += `- Auth-gated sections (show only to logged-in viewers):\n`;
    for (const gate of authGates) {
      prompt += `  - ${gateLabels[gate] || gate}\n`;
    }
  }

  // Build resource availability warnings
  const hasAvatar = selectedImages.some(i => /avatar|profile|photo|headshot/i.test(i.key));
  const hasResume = selectedImages.some(i => /resume|cv/i.test(i.key));

  let resourceNotes = '';
  if (!hasAvatar) {
    resourceNotes += `- NO avatar/profile photo was provided. Generate an inline SVG placeholder avatar (e.g. colored circle with initials "${(session.displayName || session.owner).charAt(0).toUpperCase()}"). Do NOT reference any image URL for the avatar.\n`;
  }
  if (!hasResume) {
    resourceNotes += `- NO resume/CV file was provided. Do NOT include a "Download Resume" link. Instead, omit the resume section entirely or show a placeholder note like "Resume available upon request."\n`;
  }

  // Build section availability summary
  let sectionNotes = '';
  if (selectedApps.length === 0) {
    sectionNotes += `- NO apps/projects were provided. Do NOT create a "Projects" section with fake projects. Either omit the section or show a single placeholder: "Projects coming soon."\n`;
  }
  if (selectedBoards.length === 0 && selectedMemories.length === 0 && selectedApps.length === 0) {
    sectionNotes += `- Very little content was provided. Generate a clean, minimal portfolio with: header/hero with the display name, an "About" placeholder section the user can edit, and any selected images as a gallery. Do NOT fill empty space with invented content.\n`;
  }

  prompt += `
## Technical Requirements
- Generate a SINGLE downloadable HTML file with ALL CSS and JS inline (no external dependencies)
- **CRITICAL — No fabricated content:** ONLY show information that is explicitly provided in the sections above. Never invent projects, work history, skills, contact details, social links, testimonials, or any other content. If data for a section is not provided, omit the section or use an editable placeholder.
- **CRITICAL — Images and files:** ONLY use URLs listed in the "Selected Images" section above. Do NOT invent, guess, or fabricate any URLs. If a resource (avatar, resume, screenshot, etc.) is not listed above, it does not exist.
${resourceNotes}${sectionNotes}- For missing images: Use inline SVG placeholders, CSS gradients, or emoji — never a broken image URL
- For project screenshots: If no screenshot URL is provided for a project, use a styled CSS placeholder card instead of an <img> tag
- If PUBLIC memory entries are listed above: fetch them live with plain \`fetch(url)\` calls to those exact URLs
- **CRITICAL — fetch() must stay credential-free:** always call \`fetch(url)\` with no options object — never set \`credentials\` ('include'/'same-origin'), and never send an Authorization header. The portfolio runs in an opaque-origin sandbox (the browser sends \`Origin: null\`); the node answers CORS with a wildcard, and browsers reject credentialed requests to wildcard responses. Only the anonymous public URLs listed above are reachable.
- Mobile-responsive design (works on phone, tablet, desktop)
- Include proper <meta> tags for SEO and social sharing (og:title, og:description, og:image)
- **IMPORTANT — CSP compatibility:** The portfolio HTML will be rendered inside a sandboxed iframe. All JavaScript MUST be inside a single \`<script>\` tag at the end of \`<body>\`. Do NOT use inline event handlers (onclick=, onload=, etc.) — use addEventListener instead. Do NOT use external script/CSS CDN links.
`;

  if (authGates.length > 0 || memberMems.length > 0) {
    prompt += `
## Viewer Bridge (auth state + members-only data)
The portfolio renders inside a sandboxed iframe with an opaque origin: it has NO access to the
hosting page's session, cookies, or \`window.AIMEAT\` — login state cannot be read directly.
The hosting AIMEAT viewer bridges over postMessage. Two message flows:

1. Viewer → portfolio: \`{ type: 'aimeat-portfolio-auth', loggedIn: boolean }\` — posted on load
   and whenever the visitor's login state changes.
2. Portfolio → viewer: \`{ type: 'aimeat-portfolio-fetch', gaii: string, key: string, id: number }\`
   (id = your own correlation number). The viewer answers with
   \`{ type: 'aimeat-portfolio-fetch-result', id, ok: boolean, gaii, key, value }\` — \`value\` is the
   memory record's value when \`ok\` is true, otherwise null (not logged in / no access).
   The viewer only serves the gaii+key pairs listed in "Memory Entries" above.

Implementation pattern — default to logged-out, activate on the viewer's signal:

\`\`\`javascript
function applyAuthState(isLoggedIn) {
  document.querySelectorAll('[data-auth-required]').forEach(el => {
    el.style.display = isLoggedIn ? '' : 'none';
  });
  document.querySelectorAll('[data-auth-placeholder]').forEach(el => {
    el.style.display = isLoggedIn ? 'none' : '';
  });
}
applyAuthState(false);

// Members-only data: ask the viewer, resolve by correlation id.
let bridgeSeq = 0;
const bridgePending = {};
function fetchMemberData(gaii, key) {
  return new Promise((resolve) => {
    const id = ++bridgeSeq;
    bridgePending[id] = resolve;
    window.parent.postMessage({ type: 'aimeat-portfolio-fetch', gaii, key, id }, '*');
  });
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d) return;
  if (d.type === 'aimeat-portfolio-auth') {
    applyAuthState(!!d.loggedIn);
    // (Re-)request members-only data when the viewer reports a logged-in visitor.
    if (d.loggedIn) loadMemberSections();
  } else if (d.type === 'aimeat-portfolio-fetch-result' && bridgePending[d.id]) {
    bridgePending[d.id](d.ok ? d.value : null);
    delete bridgePending[d.id];
  }
});

async function loadMemberSections() {
  // Example: const contact = await fetchMemberData('<gaii>', '<key>');
  // if (contact) { render it into the [data-auth-required] section }
}
\`\`\`

Wrap gated content in \`<div data-auth-required>\` and add a placeholder:
\`<div data-auth-placeholder>Log in to see more content</div>\`

Rules:
- Show the placeholder until data actually arrives — no spinners waiting on the bridge
  (an older viewer never answers, and the placeholder is the correct fallback).
- Members-only values arrive ONLY via the bridge — never bake them into the HTML and never
  fetch them directly.
- Content that is merely wrapped in [data-auth-required] but baked into the HTML is a
  convenience, not a security boundary — it is visible in the HTML source. Keep truly
  private data out of the portfolio entirely.
`;
  }

  prompt += `
## Debug Panel
Include a hidden debug panel (toggle with Ctrl+Shift+D keyboard shortcut via addEventListener).
Show: auth state, image load status, API fetch log, section visibility, JS errors.
Style: fixed overlay, semi-transparent dark background, monospace font.
All debug JS must be in the single <script> block at end of body — no inline handlers.

## Delivery
After generating the HTML, tell the user:
1. Save the HTML file
2. Go to their AIMEAT profile page
3. Navigate to the Portfolio tab
4. Upload the HTML file to publish it at: ${url}/v1/portfolio/${session.owner}
`;

  return prompt;
}
