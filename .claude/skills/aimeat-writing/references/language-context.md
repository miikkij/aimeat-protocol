# Language context: what you are naming, and what this product already calls it

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

---

## The concept table

The **decided** column is what ships today. A word here is not a suggestion: using a different one
creates the inconsistency this file exists to stop. If a decided term is wrong, change it here and
everywhere at once, and say so in the Changes section.

| The thing | In one sentence | en | fi | es |
|---|---|---|---|---|
| the person's own system | the running AIMEAT their account lives in | your own AIMEAT | oma AIMEAT | tu propio AIMEAT |
| someone else's system | another AIMEAT they can sign into and whose memory they browse | environment / remote environment | ympäristö / etäympäristö | entorno / entorno remoto |
| the machine | the host, when the sentence is really about the machine: what holds a credential, what has an address, what is reachable | server | palvelin | servidor |
| whoever pays for the shared AI key | the operator of this installation, on an operator surface | this server / the server's key | palvelin / palvelimen avain | este servidor / la clave del servidor |
| stored knowledge | what the person and their agents wrote here | memory | muisti | memoria |
| one stored thing | a single record under one key | entry | merkintä | entrada |
| the AI acting for them | scoped, named, revocable, acts in their name | agent | agentti | agente |
| a published web app | one file, runs on their AIMEAT | app | sovellus | aplicación |
| sandboxed outside-calling code | holds no key of theirs | extension | laajennus | extensión |
| a shared group | people and AIs sharing work | organism | organismi | organismo |
| a shared container | documents and records inside an organism | workspace | työtila | espacio de trabajo |
| an operating guide | instructions for one named capability | skill | taito | habilidad |
| the write pacer | not money, not credit, never buys anything | morsel | murunen | morsel |
| granted model spend | real money the house fronts, and it runs out | AI allowance | tekoälysaldo | saldo de IA |
| permission a person grants | revocable, per agent, per area | permission | oikeus | permiso |
| sign-in from elsewhere | another AIMEAT vouching that a sign-in is really them | federation | federaatio | federación |
| the account holder | the human who owns everything here | owner | omistaja | propietario |
| this product's settings area | where a person changes their own things | Settings & Controls | Asetukset ja hallinta | Configuración y controles |
| the service the person is on | the AIMEAT they are reading this screen on, which is a thing with a name | this service, or its name | tämä palvelu, tai sen nimi | este servicio, o su nombre |
| the list of public systems | where a public AIMEAT can be found by others | the federation directory | AIMEAT-palvelimien luettelo | el directorio de la federación |
| a machine credential | what a program presents to prove it may connect | token | token | token |
| a machine identifier | a name for a thing, never for a person | identifier / ID | tunniste | identificador / ID |
| a person's login name | the public half of a sign-in | username | käyttäjätunnus | nombre de usuario |
| one thread in Messages | everything said between the same parties under one subject | conversation | keskustelu | conversación |
| where a person puts conversations away | nothing is deleted; a conversation comes back when someone other than their own agents writes | archive / archive (verb) | arkisto / arkistoida | archivo / archivar |
| a rule for the Messages list | folds, groups or archives the conversations it matches; the first one that fits decides | rule | sääntö | regla |

## Never translated, in any language

`AIMEAT` · `morsel` / `morsels` · `MCP` · `GHII` / `GAII` / `GEAI` · `cortex` · `EXCHANGE` ·
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

A concept that is not in the table above has no decided word, and inventing one silently is how the
table stops being true. Add the row in the same change that first uses the term, with the sentence
that says what the thing is. Changing a decided term means changing every string that uses it, in
the same commit, because half a rename is worse than either name.

## What this file does and does not do, measured

Tested on 2026-09-12 against the Personal Nodes screen, 45 keys in three languages. Two writers
got the same task and the same SKILL.md; one also got this file. Two Finnish readers then read one
version each, cold, not knowing there was another.

Both versions drew **14 findings**. The headline count is a tie, and the shape underneath is the
useful part.

- **Three defects this file prevented.** The version without it wrote *tunnus* for a machine
  identifier (the reader reached for *tunniste* independently, citing Sanastokeskus), *läppäri*
  in a sentence that also says TLS, and *sykeviesti*, which no Finnish technical text uses. All
  three are terminology, which is what this file is for.
- **One it caused.** Having learned *oma AIMEAT*, that writer used it in the body under a heading
  that still said *Omat palvelimet*, and the reader asked which of the two they were registering.
  That is why the heading rule above now exists.
- **Seven of the fourteen were the same in both**, and none of them is a word choice: *operaattori*
  and *federaatiohakemisto* naming things the screen never explains, GAII never opened, a token the
  screen asks for but never provides, a half-English placeholder. A writing aid cannot supply
  information the source string does not contain.

So: it moves terminology and nothing else, which is worth its cost because terminology is the part
that compounds across screens. The seven shared findings are why the table now carries rows for the
service, the directory, the token, the identifier and the username: the test named the gaps.

## Changes

- **2026-09-12** — written, after a pass over the Memory and Access screens in which cold readers
  in Finnish and Spanish, working separately, rejected the same two words on evidence. The table's
  decided column records what those screens already shipped rather than proposing anything new.
  Two questions were left open for the developer, and both are now answered below.
- **2026-09-13** — both settled, and the answers went opposite ways. *Environment* and *server* are
  BOTH right and both stay, each in its own sense: an environment is one you sign into and browse,
  a server is the machine when the sentence is about the machine. The readers who wanted one word
  for both were reading a distinction the product actually makes. *The house* goes entirely, from
  the twenty-five internal keys that carried it. Ruled by the developer, recorded on the board as
  decision-ymparisto-ja-palvelin-ovat-oikeat-sanat-toiselle-aimeatille-.
- **2026-09-12, same day** — five concept rows, the heading rule and the placeholder rule added,
  each one named by the A/B test above rather than thought up.
- **2026-09-13** — conversation, archive and rule, with the Messages list's sections and archive.
  *Keskustelu* and *conversación* are what the Messages page already shipped; *arkistoitu* and
  *archivar* were already the words on other pages (organisms, packages, the calibrator), and
  *sääntö* is what the Libraries and Capabilities pages call a rule.
