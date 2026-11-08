# Larder · session 4 · 3 February 2026 · Boxes nobody collects

Sleet all morning, so we held the Tuesday sit-down in the Garage with the heater on and the door shut. Rasmus brought the good coffee and a bag of the cardamom buns from the bakery by the tram stop, which he said was an apology in advance for the amount of time he was about to spend on the app. In the end we spent most of the session on something else: what happens to a box that nobody comes for.

## Boxes nobody collects

This came up because of a phone call I had with Raimo yesterday afternoon. Raimo showed me round Alder Court when I did the lobby walk there. I'd been lumping him in with the HA in my head, but he isn't on the board and doesn't go to their meetings. He is the person who actually looks after the building: he changes the lobby bulbs, clears the bike room, shouts at the delivery vans parked on the pavement, and holds the keys to every door downstairs. Every building I've walked so far has someone like him. In Lakeport they're all called caretakers, the HAs call them caretakers, and the residents do too, so that's our word now. The HA gives permission. The caretaker is the one who has to live with whatever we put in the lobby.

Raimo asked me straight out: "What do you do when someone doesn't come down for theirs?" He said he already ends up holding parcels for half the building because couriers leave them with him when nobody answers. I told him we hadn't decided. That wasn't quite true. We'd never even talked about it, which is worse.

So I put it to Rasmus first thing. He had a status in the Ledger for it already, called "uncollected". (The Ledger is what Rasmus calls the admin back end he's been building since the start: members, boxes, drops and payments all live there. He named it that in his first commit as a joke about two people pretending to be a company with proper books, and neither of us has come up with anything better, so it's stuck.) "Uncollected" is accurate, but it sounds like an accounting line, and I said so. I said the box just sits there in its compartment after the pickup window has closed with nobody claiming it, like an orphan. Rasmus laughed, then changed the status name while I watched. So: an **orphan box** is a box still in its compartment when the pickup window closes.

About ten minutes later he complained that "orphan_box" was too long for a column header and shortened it to **OB**. By the end of the session we were both saying "OB" out loud, which I find slightly grim but very practical. In these notes OB and orphan box are the same thing.

A small language note while I'm at it. Rasmus kept saying "cell" all morning, and it took me a while to realise he meant compartment. He's been reading locker manuals at night, and in all of them each lockable door is a numbered "cell". He's taken the word into the Ledger, where every compartment has a cell number. For us cell and compartment mean exactly the same thing. I'll keep writing "compartment" in anything a member will see, because "your box is in cell 4" sounds like a prison drama. Rasmus can have "cell" in the code.

### What we talked through

We went through the options properly, because this one will come up every single box week once there are real members.

- **Leave it where it is.** This was Rasmus's default, mostly because it needs no code. But the compartment is then blocked for the next drop, and the vegetables sit in a lobby getting sadder. If they start to smell, the person who notices first is Raimo, and the next thing he does is talk to the HA. A box also belongs to its box week. One that lingers into the next week muddles what the member paid for and what they got.
- **I drive round and bring it back to the Garage.** I offered this, half-heartedly. It means an extra drive we can't plan, because we won't know in advance how many OBs there will be or where. Then the box is in my garage, which is the one place the member definitely doesn't live. And then what? I'd be standing next to a pile of other people's leeks with nobody to give them to.
- **Leave it with the caretaker.** This is what Raimo was already hinting at. The caretaker is in the building, has the keys, and knows most residents by face. The member can still get the box they paid 24 € for: they knock on a door downstairs instead of opening a compartment, which is a bit more friction but still the same building. It frees the compartment for the next drop, and it doesn't put me on the road.

Rasmus's objection to the third option was the obvious one. We would be asking someone who doesn't work for us to do something for us, every week, on top of the parcels he already hates holding. That is fair. Raimo didn't sound like he minded, but Raimo is one caretaker. I've met others on lobby walks who clearly see anything new in their lobby as more work. What's in it for caretakers is not something we settled today. It's a real worry, not a detail, and I've put it on the parking lot so it doesn't get lost.

Other things we noticed and left alone:
- Where the caretaker keeps an OB. Raimo has a little office off the bike room; not every building will have one.
- What happens when the caretaker is off sick or on holiday.
- How the box physically gets from the compartment into the caretaker's hands. Rasmus said "that's a me problem" and wrote it down.
- How the member finds out their box has moved.

None of those changes the basic answer, though.

**Decision: an orphan box is left with the building's caretaker.** Our reasons: the caretaker is on site and holds the keys, the member can still collect what they paid for, the compartment is freed for the next drop, and it doesn't create unplanned driving for me. The details of how this works with each caretaker are still to come.

I said "customer" twice during this bit ("the customer paid for it", "the customer will be annoyed"), and Rasmus gave me the look both times. Member. I know. I'm getting better.

## Chill cells

The orphan-box talk drifted, as it would, into what an OB looks like in July rather than February. Root vegetables will forgive a day in a lobby, and leafy greens won't. I texted Aino during the coffee refill to ask what on her box sheets she'd worry about first. She wrote back "salad, herbs, anything soft, and don't let anyone leave strawberries anywhere warm". That matches my gut.

Rasmus said some of the manuals he's been reading show refrigerated cells, and he kept calling them "refrigerated cells" until I said it was too much of a mouthful and called them **chill cells**. He accepted that on the condition that he gets to keep "cell". So a chill cell is a refrigerated compartment. We didn't get any further than liking the idea. Whether we want them, how many, and how cold are all things for later.

What did come up, and what neither of us could answer, is power. A plain compartment needs very little: a lock and a bit of electronics. A chill cell is a small fridge. I remember a socket by the mailboxes at Alder Court, but I have no idea what it's on, whether it's on the building's common electricity, or whether the HA would let us run something off it all year. Rasmus is going to dig the power figures out of the manuals so we at least know what we're asking for.

**Open question: can chill cells run in a lobby without a separate power line?** We don't know yet. I'm not putting it on the red list, because it isn't blocking anything this week, but I don't want it to drift either.

## The member app gets a name

Finally, the bit Rasmus had brought the buns for. He's been calling it "the member app" since January, and he wanted a real name before the folder full of placeholder screens gets any bigger. Recap of what it is: the app is where members see their box, pay for it and open their compartment.

Names we went through, roughly in order:
- **"Larder"**, the same as the product. I was against this. "Larder" already does a lot of work for us, and if the app is called Larder too, half our sentences become ambiguous ("is Larder down?" — the app or the whole thing?). Rasmus agreed fairly quickly.
- **"Locker"**: too generic, and it describes the pod, not what the member does.
- **"Pickup"**: Rasmus said it sounded like a dating app, and after that neither of us could hear it any other way.
- **"Picker"**: Rasmus's suggestion. It came from the idea that the member is the one who picks up the box; they're the picker. I liked that it's a word about the person and what they do, not about the hardware. It's short, it works in a sentence ("open Picker", "it's in Picker"), and it sounds friendly enough to put on a note in a lobby. It also sits nicely next to the Ledger: the Ledger is our side, Picker is the member's side.

We said "Picker" out loud in a few sentences to see if it held up. "Your box is waiting, open Picker." "Picker says it's an OB, ask Raimo." The second one made us both laugh, but it worked.

**Decision: the member app is called Picker.** Reasons: it describes what the member does, it doesn't collide with "Larder", it's short and easy to say, and it pairs naturally with the Ledger.

Rasmus wants to talk about how Picker is actually built at some point, whether it's a proper phone app or something lighter. We deliberately left that alone today. Naming it was enough for one Tuesday. He did say he wants Picker to tell a member when their box has become an OB and that it's with the caretaker. Neither of us has thought about what that message should say, so that's an action rather than a decision.

## Parking lot additions

- What caretakers get out of holding OBs (see above; this matters more than it looks).
- Rasmus's idea of a small light on the pod that blinks when there's an OB inside. Probably silly, possibly not.
- Whether an OB that the caretaker is holding should look different in the Ledger from one still in its compartment. Rasmus thinks yes; I don't care yet.
- My half-idea of a little printed card for caretakers explaining what an OB is in plain words. I'm doing a rough draft anyway, see actions.

The sleet had turned to proper rain by the time we finished. Rasmus took the last bun "for the road", even though the road is four streets long.

## Actions

- **Ilona**: call Raimo back. Tell him that orphan boxes will be left with the caretaker, and ask what would make that bearable for him (where he'd keep them, how he'd want to be told).
- **Ilona**: ask Raimo what the socket by the mailboxes at Alder Court is on, and whether he knows of any other power in the lobby.
- **Ilona**: draft a short plain-language paragraph for caretakers explaining what an OB is and what we'd be asking of them. Draft only; not to be sent to anyone yet.
- **Ilona**: ask Aino which items on a typical box sheet hold up longest outside a fridge, so we know how worried to be about OBs in summer.
- **Rasmus**: rename the "uncollected" status to OB everywhere in the Ledger, and work out how an OB moves from "in compartment" to "with caretaker".
- **Rasmus**: rename the member-app folder and placeholder screens to Picker.
- **Rasmus**: sketch the message Picker shows a member when their box becomes an OB.
- **Rasmus**: pull the power figures for chill cells out of the manuals, so we know what we'd be asking a lobby for.
- **Both**: bring the chill-cell power question back to the next Tuesday sit-down once we have Raimo's answer and Rasmus's numbers.
