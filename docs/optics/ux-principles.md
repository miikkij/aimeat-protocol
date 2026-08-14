# AIMEAT UX Optics — Design Principles for User-Facing Content

These principles govern ALL user-facing views, cards, pages, prompts, and guidance in AIMEAT. Every portal change, new page, or user-visible text must follow these rules.

---

## 1. The "No way, is it really this easy?" Reaction

Every card, page, and guide must produce the moment where the user can't quite believe what they're reading — and immediately wants to try it. Not "here's a list of features", but **a concrete promise that sounds too good to be true, but is true.**

Bad: "Build apps with any AI, browse the app catalogue and offer or find help."
Good: "Make your own app by chatting with your favourite AI. Copy the prompt, paste it in your chat, and you'll have a working app in minutes."

## 2. Don't Tell — Let Them Do

Every element on the page is either **something the user can do right now** or it doesn't belong there. Tag chips that don't do anything → remove. Feature lists → remove. If you can't click it, it's noise.

Allowed: button that does something, textarea to copy from, link that goes somewhere
Forbidden: decorative tags, feature bullet lists, buzzword walls

## 3. One Concrete Starter Challenge

Each card has one clear "try this" — not three, not five. One thing that is easy, fast, and proves to the user that the system actually works.

Example: "Try making an app that lets you post a message to the Welcome board from your own browser — and watch it appear here too!"

Three things happen: (1) the user does something real, (2) they see the result in the portal, (3) they realize "this isn't a demo, this is a real system".

## 4. Concepts Only When They Have Context

Memory, Morsels, App Catalogue, MCP, Agent Runtime — these are all real things, but they are introduced **only when the user is already doing something where they are relevant.** Not upfront. Not as a list. Not as tags.

User makes an app → then tell them "by the way, this is saved in your memory, you can come back to it anytime."
User wants to share → then tell them "add it to the catalogue."
Never the other way around.

## 5. Visual Brightness and Energy

Text stands out clearly from the background. Cards feel **fresh and new**, not like a muted grey velvet fog. Important text is bright/white, secondary text is clearly dimmer but still readable. Muted text contrast must be sufficient even for tired eyes.

Rules:
- Body text: sufficient contrast (not `#888` on dark background, at least `#aaa`)
- Inspiring statements: `--text-bright` (#fff) or accent colour
- Overall feel: energetic, not "enterprise SaaS dashboard"

## 6. Copy Prompt = The Bridge Where AI Takes Over

The prompt textarea is not a "feature". It is **the bridge that takes the user from the portal into the AI chat where the real magic happens.** The frame around it must be:
- Short promise of what will happen (1 sentence)
- The prompt
- "Copy" button
- Hint for beginners ("start with something simple!")

No feature tags. No paragraph of process description. Copy → go to chat → AI handles it.

## 7. Every View Has Proof of Life

The user must see **evidence that this is a real, living system.** A welcome board with real messages. An app catalogue with real apps. Not empty space saying "coming soon" — real content that moves.

---

## Summary Checklist

Before shipping any user-facing change, verify:

- [ ] Does it make the user want to try it immediately?
- [ ] Can every visible element be interacted with? (if not, remove it)
- [ ] Is there exactly one concrete starter challenge?
- [ ] Are concepts introduced only when contextually relevant?
- [ ] Is the text bright and readable, not muddy?
- [ ] Is the prompt section minimal: promise → prompt → copy → hint?
- [ ] Is there proof of life (real data, real activity)?
