/**
 * @file public/views/transparency.js
 * @description The public, human-language transparency page (TARGET-058 Phase 10) — the plain
 *   sibling of docs/ai-transparency.md, for a visitor rather than an operator. What this node
 *   marks, what it CANNOT do, who runs it, who supervises it, how to check a piece of content,
 *   how to report a missing label, and whether the operator has signed the Code of Practice.
 *
 *   IT READS THE NODE, IT DOES NOT DESCRIBE IT FROM MEMORY. Operator identity, supervisory
 *   authority and Code of Practice status all come from `GET /v1/ai-transparency` at render time,
 *   never from a string in this file. Two reasons, and the second is the load-bearing one:
 *   (1) the page then matches the machine-readable statement by construction rather than by
 *   someone remembering to edit both; (2) this file is MIT code that other people run. A
 *   hardcoded "Overscale Solutions Oy" would be a false statement on every node that is not ours,
 *   which is exactly the marketing drift a transparency page cannot afford.
 *
 *   THE LIMITS ARE NEAR THE TOP, NOT IN A FOOTNOTE. "What this does not do" is the second section
 *   on the page, above who we are and above how to check. A reader who is told the boundary before
 *   the boast has a reason to believe the boast; the other order reads as a disclaimer somebody
 *   hid. Two sentences in it are load-bearing and must not be softened: the node does not
 *   watermark text, and a mark can be removed by copying.
 *
 *   WHAT IS NEVER SAID HERE (doc 20 §L, the claims register): "EU AI Act compliant", "all AI
 *   content is watermarked", "certified", "compliant because it runs on AIMEAT". And two claims
 *   that WERE drafted and turned out to be wrong when Phase 9 checked them: verification is scoped
 *   to content the node served you byte for byte, and the visible label is scoped to this node's
 *   own surfaces.
 * @structure
 *   - Transparency({ navigate }) — the page
 *   - Facts({ stmt })            — operator + supervisory authority, straight off the statement
 * @usage routed at /v1/transparency by spa.html + src/routes/portal.ts
 * @version-history
 *   v1.1.0 — 2026-08-08 — The signatory answer became yes for this node, so the yes branch now says
 *     WHEN it was signed and which section was NOT — the boundary-before-the-boast rule applies to
 *     the one claim on this page a reader is most likely to over-read.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 10. Copy specified in
 *     docs/internal/EUAct/20-public-release-plan.md §D, corrected by §5 of 32-audit-phase-9.md.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { openAppSandboxed } from '/js/app-sandbox.js';

const html = htm.bind(h);

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* Code samples as plain strings, interpolated as text nodes. Written inline in the markup they
   would be parsed as markup: `<record id>` becomes an unknown element and disappears, which is
   how a copy-pasteable example silently loses the part the reader needed. */
const FLAG_SAMPLE = `POST /v1/flags
{ "targetType": "ai_provenance", "targetId": "<record id>", "reason": "undisclosed_ai" }`;

const SDK_SAMPLE = `const { content, provenance } = await AIMEAT.ai.complete({ prompt });
AIMEAT.ai.disclose(provenance);`;

/**
 * An app on THIS node whose published bytes the node checked and found a disclosure call in.
 *
 * WHY A REAL ITEM AND NOT AN EXAMPLE BADGE. The page explains the label, so it should show one —
 * but a demo badge fed by a static record is a badge somebody eventually ships as real, and
 * minting a record to illustrate would be a fabricated attestation, which is precisely the thing
 * this page says the node does not do. Linking something genuinely labelled costs nothing and
 * cannot become a lie.
 *
 * `disclosureCallFound` is the MEASURED half of the posture — the node found the call in the bytes
 * it serves — so the claim rests on what the node observed rather than on what the app declared
 * about itself. An app that only declares `discloses: yes` is not good enough to point at.
 * Public-interest publishers rank first: that is the Article 50(4) case a reader came here about.
 *
 * Returns null on a node that has no such app, and the section then renders nothing. A fresh
 * clone with an empty catalogue must not advertise an example it does not have.
 */
function pickLabelledApp(apps) {
  const eligible = apps.filter((a) => {
    const p = a.ai_posture;
    return p && p.disclosureCallFound === true && p.discloses === true
      && Array.isArray(p.generates) && p.generates.length > 0 && !a.parked;
  });
  return eligible.find((a) => a.ai_posture.publicInterest === true) ?? eligible[0] ?? null;
}

/** One label/value row of the node's own statement. Renders nothing when the node states nothing. */
function Fact({ label, value, href }) {
  if (!value) return null;
  return html`
    <div class="tp-fact">
      <dt class="tp-fact-key">${label}</dt>
      <dd class="tp-fact-val">
        ${href ? html`<a href=${href} target="_blank" rel="noopener noreferrer">${value}</a>` : value}
      </dd>
    </div>
  `;
}

/**
 * Who runs this node and who supervises it — every value from `/v1/ai-transparency`.
 *
 * A node that has not told us its market-surveillance authority gets the honest sentence instead
 * of a guess, which is the same thing the JSON does with `null`. Guessing a regulator into a
 * compliance page would be a false statement in the one document a reader checks.
 */
function Facts({ stmt }) {
  const op = stmt?.operator || {};
  const authorities = stmt?.supervisory_authority || {};
  const ams = authorities.ai_market_surveillance;
  return html`
    <dl class="tp-facts">
      <${Fact} label=${tr('transparency.opOperator', 'Operator')} value=${op.legal_name} />
      <${Fact} label=${tr('transparency.opBusinessId', 'Business ID')} value=${op.business_id} />
      <${Fact} label=${tr('transparency.opAddress', 'Established in')} value=${op.address} />
      <${Fact} label=${tr('transparency.opContact', 'Contact')} value=${op.contact}
        href=${op.contact && op.contact.includes('@') ? `mailto:${op.contact}` : null} />
      ${ams
        ? html`<${Fact} label=${tr('transparency.opSupervisor', 'AI Act market surveillance')}
            value=${ams.name} href=${ams.url} />`
        : html`
          <div class="tp-fact">
            <dt class="tp-fact-key">${tr('transparency.opSupervisor', 'AI Act market surveillance')}</dt>
            <dd class="tp-fact-val">${tr('transparency.opSupervisorUnstated',
              'Not stated for this node. It follows from where the operator is established, and it is a different regulator from the data protection authority.')}</dd>
          </div>`}
      <${Fact} label=${tr('transparency.opNode', 'Node')} value=${stmt?.node_id} />
    </dl>
  `;
}

export default function Transparency({ navigate }) {
  const [stmt, setStmt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [labelled, setLabelled] = useState(null);

  useEffect(() => {
    fetch('/v1/ai-transparency')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok === false || !j?.data) { setFailed(true); return; }
        setStmt(j.data);
      })
      .catch((err) => { swallowed('transparency: statement fetch', err); setFailed(true); });
  }, []);

  // Something on this node that actually carries a label, resolved rather than hardcoded — a
  // pinned filename would rot on a rename and be a lie on anybody else's node.
  useEffect(() => {
    fetch('/v1/apps?limit=100')
      .then((r) => r.json())
      .then((j) => setLabelled(pickLabelledApp(j?.data?.apps || [])))
      .catch((err) => { swallowed('transparency: labelled example lookup', err); });
  }, []);

  const byHash = stmt?.detection?.by_hash || '/v1/provenance/by-hash/{sha256}';
  const signatory = stmt?.code_of_practice?.signatory === true;
  const sections = (stmt?.code_of_practice?.sections || []).join(', ');
  const signedOn = stmt?.code_of_practice?.signed_on || '';
  // The sections NOT signed, shown in the same breath as the ones that are. Saying only "we signed"
  // invites a reader to assume the whole Code, and Section 1 is exactly the part this node cannot
  // honour — same discipline as the limits section above.
  const notSigned = (stmt?.code_of_practice?.not_signed || []).map((n) => n.section).join(', ');

  return html`
    <div class="ld tp">
      <section class="ld-hero tp-hero">
        <h1 class="ld-h1">${tr('transparency.title', 'How this node marks AI-generated content')}</h1>
        <p class="ld-hero-sub">${tr('transparency.intro',
          'When a model writes something here, the node records how it was made — which model, when, on whose account, and how much a person was involved — and keeps that record at an address of its own. Where a person reads that content on this node’s own pages, the record becomes a visible label: the official EU AI Office icon and a sentence in English or Finnish, beside the content, with a link to the full record. Software gets the same facts from the response itself, in the HTTP headers, the page metadata, and the markdown and MCP surfaces.')}</p>
      </section>

      <!-- The boundary comes before the boast. Anything below this section is easier to believe
           because this section is here, and burying it would cost exactly that. -->
      <section class="tp-limits">
        <h2 class="tp-limits-title">${tr('transparency.limitsTitle', 'What this does not do')}</h2>
        <p class="tp-limits-lead">${tr('transparency.limitsLead', 'Read this before relying on anything above.')}</p>
        <ul class="tp-limits-list">
          <li>${tr('transparency.limit1', 'This node does not watermark text. It does not see the words as a model produces them, and that layer belongs to whoever runs the model. What the node does is record how a piece of content was made, and show it.')}</li>
          <li>${tr('transparency.limit2', 'A mark can be removed by copying. Paste the words somewhere else and the label is gone. The record at its own address survives that, which is why there are two layers — but nothing here makes text tamper-proof, and we will not pretend otherwise.')}</li>
          <li>${tr('transparency.limit3', 'Content made before this node started recording carries no record, and will not acquire one later. A statement about words nobody witnessed being written would be a fabrication.')}</li>
          <li>${tr('transparency.limit4', 'A missing record means nothing was stated. It never means a person wrote it.')}</li>
        </ul>
      </section>

      ${labelled ? html`
        <p class="tp-seeit">
          ${tr('transparency.seeItLead', 'Somewhere to see one:')}
          ${' '}
          <a href="#" role="button" onClick=${(e) => { e.preventDefault();
              openAppSandboxed(`/v1/apps/${encodeURIComponent(labelled.owner)}/${encodeURIComponent(labelled.filename)}?mode=inline`,
                labelled.manifest?.name || labelled.filename); }}>
            ${labelled.manifest?.name || labelled.filename}
          </a>
          ${' '}
          ${tr('transparency.seeItTail', 'is an app on this node that generates text, and the node found the disclosure call in the source it serves.')}
        </p>` : null}

      <section class="tp-section">
        <h2 class="tp-h2">${tr('transparency.opTitle', 'Who runs this node, and who supervises it')}</h2>
        <p class="tp-p">${tr('transparency.opLead',
          'These are read from this node’s own live statement as you load this page, so they are exactly the values a machine is given.')}</p>
        ${failed
          ? html`<p class="tp-p tp-muted">${tr('transparency.opUnavailable',
              'This node’s statement could not be loaded just now. It is served at /v1/ai-transparency.')}</p>`
          : (stmt ? html`<${Facts} stmt=${stmt} />` : html`<p class="tp-p tp-muted">${tr('transparency.loading', 'Reading the node’s statement…')}</p>`)}
        <p class="tp-p tp-note">${tr('transparency.opNote',
          'The AI Act supervisor is not the data protection authority. This node names them separately, because naming the wrong one in a compliance document is worse than naming none.')}</p>
      </section>

      <section class="tp-section">
        <h2 class="tp-h2">${tr('transparency.checkTitle', 'Check a piece of content yourself')}</h2>
        <p class="tp-p">${tr('transparency.checkLead',
          'Anyone can check content this node served, byte for byte, with no account and no key. Take the exact bytes you received, hash them with SHA-256, and ask:')}</p>
        <pre class="tp-code"><code>GET ${byHash}</code></pre>
        <p class="tp-p">${tr('transparency.checkLimit',
          'This works where the node served you the same bytes it hashed. Where the node re-assembles a document on the way out, the hashed bytes cannot be rebuilt from what you received and the lookup will find nothing — use the record id from the response’s Link header instead. That is a real limit, not a lookup worth retrying.')}</p>
        <p class="tp-p">${tr('transparency.checkAnswer',
          'An answer covers content that is publicly readable on this node right now. Make the content private and its record stops resolving for strangers, so an empty answer is never an acquittal.')}</p>
      </section>

      <section class="tp-section">
        <h2 class="tp-h2">${tr('transparency.reportTitle', 'If something should carry a label and does not')}</h2>
        <p class="tp-p">${tr('transparency.reportLead',
          'Anyone can report it. A visible label links to its own record, and that record id is what to report.')}</p>
        <pre class="tp-code"><code>${FLAG_SAMPLE}</code></pre>
        <p class="tp-p">${tr('transparency.reportReaches',
          'Reports reach the node operator’s moderation queue — the one that already has reviewers and an appeal path — and an organism’s admins for content inside an organism. A decision can be appealed at POST /v1/flags/{flagId}/appeal.')}</p>
        <p class="tp-p">${tr('transparency.reportContact', 'If you would rather write to a person, the operator’s address is above.')}</p>
      </section>

      <section class="tp-section">
        <h2 class="tp-h2">${tr('transparency.copTitle', 'The Code of Practice')}</h2>
        <p class="tp-p">
          ${signatory
            ? t('transparency.copYes', { sections: sections || '—' })
            : tr('transparency.copNo',
              'The operator of this node has not signed the EU Code of Practice on Transparency of AI-generated Content. The live statement says the same, and it ships saying so precisely so that the answer would mean something if it ever changed.')}
          ${signatory && signedOn ? ` ${t('transparency.copSignedOn', { date: signedOn })}` : ''}
        </p>
        ${signatory && notSigned ? html`
          <p class="tp-p">${t('transparency.copNotSigned', { sections: notSigned })}</p>` : null}
        <p class="tp-p">${tr('transparency.copIcons',
          'The icons on the labels come from the EU AI Office. Using them says nothing about being a signatory of the Code, and we do not present it as if it did.')}</p>
      </section>

      <section class="tp-section">
        <h2 class="tp-h2">${tr('transparency.devTitle', 'For developers')}</h2>
        <p class="tp-p">${tr('transparency.devLead1',
          'An app built on this node inherits all of it. One call returns the text and the record; one more renders the label, in both themes and both languages.')}</p>
        <pre class="tp-code"><code>${SDK_SAMPLE}</code></pre>
        <p class="tp-p">${tr('transparency.devLead2',
          'The field is content. An app that ignores provenance keeps working exactly as it did. The obligations for what you publish stay yours.')}</p>
        <ul class="tp-links">
          <li><a href="/v1/ai-transparency" target="_blank" rel="noopener noreferrer">${tr('transparency.linkJson', 'This node’s statement, machine-readable')}</a></li>
          <li><a href="/v1/transparency.md">${tr('transparency.linkMd', 'This page as markdown')}</a></li>
          <li><a href="/v1/schemas/ai-provenance/v1.json" target="_blank" rel="noopener noreferrer">${tr('transparency.linkSchema', 'The provenance record schema')}</a></li>
          <li><a href="https://github.com/miikkij/aimeat-protocol/blob/main/docs/ai-transparency.md" target="_blank" rel="noopener noreferrer">${tr('transparency.linkGuide', 'The operator guide, for running your own node')}</a></li>
        </ul>
      </section>

      <div class="ld-ctarow">
        <a class="btn-outline" href="/v1/business"
          onClick=${(e) => { e.preventDefault(); navigate('/v1/business'); }}>${tr('transparency.ctaBusiness', 'For your business →')}</a>
        <a class="btn-outline" href="/v1/privacy">${tr('transparency.ctaPrivacy', 'Privacy →')}</a>
      </div>
    </div>
  `;
}
