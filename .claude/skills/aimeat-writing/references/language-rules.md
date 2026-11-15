# Language rules: how this product names things in English, Finnish and Spanish

Read this before composing any user-visible text in a language other than English. It exists
because every terminology failure measured on this project had one of two causes, and both are
cheap to prevent and expensive to find later:

1. **The writer did not know what the thing is.** "Remote node" is a phrase you can translate
   without understanding, and the result is a word that is grammatically fine and means nothing.
2. **The writer did not know what the product already calls it.** A screen settles on a word, and
   six weeks later a different writer picks a second word for the same thing. Nothing tells either
   of them about the other. That is how one concept ends up with three names.

**Do not give this file to a cold reader.** The reader simulation in the main skill works precisely
because the reader has no context: their confusion is the finding. Brief them and you destroy the
only check that catches "a first-time user will not understand this". This file is for the writer,
and for a reviewer checking terminology consistency, which is a different job.

---

## What a person is actually looking at

Not the architecture. The view from the chair of someone who signed up yesterday.

A person gets **their own AIMEAT**. It is a running system with their name on it, reachable at an
address, and everything in it belongs to them. They can use the one at aimeat.io or run one on
their own machine.

Inside it they keep **memory**: notes, settings, research, the contents of shared work. It is
refined knowledge they brought, not logs. It is theirs, and they decide who reads it.

They connect **agents**: the AI they already use, Claude or ChatGPT or their own code. An agent
acts in the person's name, on permissions the person granted and can withdraw. It is not a separate
account, and it never has more reach than it was given.

They run **apps**: single-page web apps published on their AIMEAT, most of them built by asking an
AI for them. And **extensions**, which are sandboxed code that can call outside services on their
behalf without ever seeing their keys.

They share through **organisms** and **workspaces**: a group of people and AIs, and the documents
and records they hold in common.

Two other people's systems matter to them. **Another AIMEAT** is someone else's, which they may be
able to sign into, and whose public things they may be able to read. A **server** is the machine
underneath one, and it is the right word only when the sentence is genuinely about the machine: who
holds a credential, what has an address, what is reachable from the internet.

Money and pace are separate. **Morsels** pace how fast agents may write into the store; they buy
nothing and are never money. An **AI allowance** is real spending the house grants a person for
model calls, and it runs out.

## The decided words

The en, fi and es columns of the concept table (the `terms-*.md` files, listed in
`language-context.md`) are the decided words, and they are what ships today. A word there is not a
suggestion: using a different one creates the inconsistency this file exists to stop. If a decided
term is wrong, change it in its row and everywhere at once, and add the dated line to
`language-context-changes.md`.

## Never translated, in any language

`AIMEAT` · `morsel` / `morsels` (English and Spanish; Finnish says *murunen*, the write pacer row in `terms-ai-and-pacing.md`, Jouni 2026-10-02) · `MCP` · `GHII` / `GAII` / `GEAI` · `cortex` · `EXCHANGE` ·
`TURBO` · product names · and machine tokens a person reads as the machine's own vocabulary
(`done`, `failed`, `AUTH`, `DELIVR`, `FRESH`).

**Finnish inflects AIMEAT directly, with no colon**, because it is read as a word and not spelled
out: AIMEATissa, AIMEATista, AIMEATiin, omassa AIMEATissasi, omaan AIMEATiisi. This is what the
front page already ships.

## Forbidden, and what to say instead

**`node` / `solmu` / `nodo` in anything a person reads.** `pnpm check:locales` refuses them and
`security/locale-jargon-baseline.json` holds the ones still outstanding. The reason is not style:
the word names a thing the reader has no picture of, so the sentence stops carrying meaning at
exactly the point it matters. Say whose system it is, or name the place, or say server when you
mean the machine. On an operator surface the word stays, because an administrator arrives knowing
it: the admin pages, federation administration, the start wizard, the CLI.

**Node.js keeps its name**, and a `{placeholder}` is not prose. The gate knows both.

**The house / talo / la casa, for whoever pays.** No gate catches this one; it is a ruling
(2026-09-13), and the developer's words for it were *there is no house*. The metaphor carried
nothing in any of the three languages. Finnish has the idiom *talon piikkiin* but derives no noun
from it, so *talon saldo* returns no hits at all; in Spanish *la casa* is the bank in a casino, and
a Bogotá reader took a line about AI credit for an offer of free chips. Both cold readers refused
it separately, with searches.

Say what the thing is instead. On an operator surface that is **this server** or **the server's
key**, which is what the configuration page already glossed it as. On a person's surface it is
**this server**, or **here**, or no actor at all when the sentence stands without one.

Three uses are not the metaphor and stay: a picture caption where a house is a house, an *auction
house*, and *house style* (`talon tyyli`), which is its own idiom about whose style it is.

**door / ovi / puerta for anything that is not a door.** `pnpm check:locales` refuses it, and
`security/locale-door-baseline.json` lists the uses allowed, each with its reason. The word had
become this codebase's name for a button, a link, a sign-in method, an endpoint and the way an agent
connects, and on 2026-11-15 the developer saw "What this door does" over an admin section and could
not tell what it meant. Name the thing itself: *the button*, *the link*, *sign-in* (*kirjautuminen*,
*el acceso*), *the call* (*kutsu*, *la llamada*), *your agent is asking to connect*. A real door (a
door code, a door sensor) and the idiom *showed X the door* stay.

**The same habit with other words: a picture in place of the thing's name.** `pnpm check:locales`
refuses five more, each with its own baseline of allowed uses (`security/locale-<word>-baseline.json`):
*road* and *way in* (*tie sisään*, *kolme tietä*; *vía de entrada*, *tres caminos*), a *hand* that
does something (*by your own hand*, *your AI gets hands*), the *machine room* and the *showroom*,
the *wall* for the list of published apps, and single pictures (a shop window, a shelf, the internet
knocking, a price ladder, a cockpit, a fence, *the house*). On 2026-11-15 they stood for a sign-in
method, a set of options, a prompt, a link, "you do it yourself", an admin page, a demo and the
public app list. Ask what the reader sees or does, and write that: *sign in*, *three ways*, *this
prompt*, *a link*, *you revoke it yourself*, *the admin pages*, *a demo*, *the public app list*.
Ordinary words stay: *by hand*, *hands-on*, *into the wrong hands*, a realtime *room*, a time
*window*, a picture caption that describes what the picture shows, Finnish *saman tien* and Spanish
*en camino*, *dejar en tus manos*.

## Register

**Finnish.** Full sentences, not clipped slogans. The developer's own model, which beat a shorter
version: *"Alusta on saatavilla avoimena lähdekoodina ja omistat koko ympäristön itse: vaikka me
katoaisimme huomenna, ympäristö jää sinulle."* Say the thing to the end. A term is either the
language's own established word or the English one kept as is; a third form invented on the spot
is the failure mode.

**Spanish.** Latin American, written for Bogotá, `tú` throughout and never `usted` or `vos`.
`computadora`, `celular`, `presiona` / `haz clic`, `agregar`. Spanish runs 15 to 25 % longer than
English, so a string that fits a button in English may not, and that is checked in a browser.

## Three failures worth remembering

Each cost a correction round, and none would have failed any gate.

- **"Olet kirjautunut muualta" / "Has iniciado sesión desde otro sitio."** Readers of both
  languages took it for a break-in warning, because that is the sentence their bank sends. It was
  trying to say the opposite: you are signed in here from your own AIMEAT, and some of your things
  are still over there. A true sentence that summons the wrong script is still broken.
- **"Tunnus jää tälle palvelimelle."** Meant "your credential never leaves". But *tunnus* is the
  username, which is the one part of a login that is meant to be public, so the sentence promised
  to protect the thing nobody needs protected. The word is *kirjautumistiedot*.
- **"Lisää solmu"** stayed in the file for months after the screen had been rebuilt to say
  "Lisää palvelin". Nobody was wrong; nobody could see the other. About a fifth of the jargon
  backlog turned out to be leftovers of exactly this kind.

## Two rules a screen breaks even when every word is right

**The heading and the text under it name the same thing the same way.** A title that says *servers*
over a paragraph that says *your own AIMEAT* leaves the reader deciding whether they are two things.
Pick the one the screen is about and use it in both, or write the sentence that joins them.

**A placeholder is an example somebody copies, not prose.** Half-translating one teaches the wrong
format: `personal-oma-kone` leaves the reader guessing whether `personal-` is required, and
`bot1#omistaja` teaches an identifier shape that will not work. Keep an example identifier in the
same characters in every language, or make the whole example native. Never half and half.

## Changing or adding a term

A concept that is in none of the `terms-*.md` files has no decided word, and inventing one silently
is how the table stops being true. Search them all first (`grep -i "<word>" references/terms-*.md`),
because a term can sit in an area you did not expect. Add the row in the same change that first uses
the term, with the sentence that says what the thing is, in the area file `language-context.md`
names for it. Changing a decided term means changing every string that uses it, in
the same commit, because half a rename is worse than either name. Write the dated line that says
what changed and why in `language-context-changes.md`, the newest at the top; a row in the table
carries no planning tag (a wish id, a board or round name), because the writer reads the table and
the history belongs in the log.
