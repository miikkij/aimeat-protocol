# Larder · session 5 · 10 February 2026 · How long a box waits

Sleet all morning, and the heater in the Garage only really warms the half of the room nearest the workbench, so we sat with our coats on and two coffees each. Ilona had the supplier's cell spec sheets printed and spread across the bench. I had the Ledger open on the laptop. The plan for today was one question: how long a box is allowed to sit in a pod before it stops being the member's job and becomes ours. We answered that. We also settled something about Picker I'd been circling for weeks, and we ran into one problem neither of us had seen coming.

## Getting the words straight

The first half hour went on vocabulary, which felt like a waste at the time but probably wasn't. We kept talking past each other, and when I wrote down what we'd each been saying, the problem was that we were using four different phrases for two things.

**Drop.** Ilona has been saying "drop" since her calls with the courier people last week, and I'd started copying her without asking what she meant. It turns out she means two things and is fine with both. One is the whole delivery: the van stops, the boxes go into a pod's compartments, and that's one drop. The other is the moment a single box goes into its cell: "the drop for that box was at 7:40." I wanted to split these into two words. Ilona said nobody in the courier world bothers and context always makes it clear, and she's right. In the Ledger a drop will be one record per pod per delivery, with a timestamp on every box inside it. That covers both meanings.

**Pickup window.** This one is Ilona's. She was describing the parcel lockers at the big grocery chain, where you get a message saying how long you have to collect, and she called that "the pickup window." It stuck because it's written from the member's side. I'd been saying "retention time", which is how a locker thinks about it, not how a person does. In conversation it was "the window" within ten minutes. I typed **PW** as the column name in the Ledger because I didn't want a long field name, and Ilona laughed at me. By the end of the session she was writing PW on the whiteboard as well, so it's staying. All three mean the same thing: the time a member has to collect a box after its drop.

**Dry cell.** I needed a word for a cell without cooling, now that we say "chill cell" for the refrigerated ones. The supplier's manuals use a model code with too many hyphens. I said "dry cell" without thinking, Ilona said it sounds like a battery, and I said that's fine, nobody will confuse a vegetable locker with a battery. So it's dry cell and chill cell.

**Drop day.** We kept saying "whatever day the drops happen", so Ilona shortened it to drop day: the day of the week drops are made. We did not decide which day. That depends on growers and harvest rhythm, and it isn't today's question. I'm noting it here so nobody reading back later thinks we picked one.

## How long the window is

With the words fixed, the argument went quickly. Writing down how we got there anyway, because I expect we'll be asked.

We started with the two extremes and moved inward.

*No window at all*, meaning the box stays until the member comes or the next drop needs the cell. Ilona killed this in about a sentence. A box sitting in a dry cell for days isn't vegetables any more, it's compost. The cell also has to be empty for the next box week. And an HA that let us into its lobby doesn't want to hear that something has been rotting in there since last Tuesday.

*A short window*, a few hours on the evening of the drop. I put this up mostly to knock it down. It cuts straight against the bet. The whole point is that pickup is open around the clock, so someone on a night shift, or someone who gets home at 2 a.m. after a late train, can still get their box. A short window turns "around the clock" into "around the clock, as long as you're around this evening." If that's the product, we might as well be a market stall.

So the real range was somewhere between "most of a day" and "a couple of days". Most of the discussion was about the far end of that.

The case for longer is obvious. Fewer orphan boxes, fewer annoyed members, more slack for people who travel. The case against comes down to the dry cell. We don't know yet whether we'll have chill cells at all. The power question is still open, and we agreed not to re-argue it today, because every time we start on it we lose an hour. So the window has to work for the worst case: a box in a dry cell, in a lobby that's warm in winter because of the radiators and could be warm in summer for other reasons.

Ilona rang Aino in the middle of this, on speaker. Aino was out in the cold somewhere at Ridgeback and kept going quiet while she walked. Her answer was practical. Roots and squash don't care much. The leafy things and anything soft are fine for a day in a cool lobby. Past that she wouldn't want her name on the box when a member opens it. She also said, half joking, that she'd rather a member came for the box late than found it limp, because the limp box is the one people tell their neighbours about. I wrote that down because it's true.

Then the orphan box side. An OB goes to the caretaker, as agreed earlier, and we didn't touch that today. But the window length decides how often that happens, and so how often we're asking a caretaker to deal with our mess. I thought about Raimo at Alder Court and how he'd react to a carrier bag of wet chard at his door every week. A window that's too short produces orphan boxes we didn't need to produce. A window that's too long means the caretaker gets something sadder when it does happen. Ilona's point was that an OB costs us whichever way it goes. Whatever we decide about refunds, an orphan box is house cut walking out of the building, plus a bit of goodwill we can't easily earn back.

One more thing pushed us to a single number rather than a rule with exceptions. It has to be easy to say. Ilona has to explain this to HAs, and I have to put it in Picker in one line. "Collect by this time tomorrow" is a sentence anyone understands. "Collect within the window, which depends on whether your compartment is chilled" is a support ticket waiting to happen.

**Decision: the pickup window is 24 hours from the drop.**

What we agreed that means in practice:

- The clock starts when the box goes into its cell. That's the end of the last metre, not when the van pulls up outside or when the drop as a whole is "done". If the last box in a pod goes in forty minutes after the first, that last member gets their 24 hours from their own box's drop time. Ilona thought this was fussy. I said the Ledger is recording the timestamp per box anyway, so it costs nothing, and it means nobody loses forty minutes because they're at the end of the row.
- Same rule for dry cells and chill cells. If we ever do get chill cells running, we can argue then about whether they earn a longer window. Not now.
- When the window closes, the box is an orphan box and the existing process takes over.

I asked whether 24 hours really covers the bet: does one full day mean "around the clock"? Ilona said yes, and I agree. Every hour of the day appears exactly once inside the window, whatever time the drop happens. Whatever your schedule, there's a moment in your normal day when you can come down to the lobby. That's the bet in its plainest form, and 24 hours is the smallest window that keeps it honest.

Ilona slipped once and said "the customer has a day", then corrected herself to "member" and glared at me before I could say anything. I said nothing.

## Picker stays in the browser

This came out of the window discussion rather than being on the agenda. Once we had "collect by this time tomorrow", the next question was how the member finds out, and how they're reminded when the window is nearly over. A native app gets you proper notifications, an icon on the home screen, all of that. For about five minutes I talked myself into building one.

Then I talked myself out of it, out loud, which is what the Tuesday sit-down is for.

I'm the only person writing software here. I'm building Picker, the Ledger and Field at the same time, and Field is barely started. A native app means at least one more codebase, store review every time I change a label, and the slow-motion problem where half the members are on last month's version. A web app means one codebase, I push a fix and everyone has it the same minute, and I can fix the countdown at 11 p.m. on drop day if it's wrong.

Ilona's reason was better than mine. She thinks the install step is where we'd lose people. For the bet to work, a resident has to go from "what's this thing in my lobby" to "I've opened my compartment" with as little in between as possible. A link or a code on the pod that opens straight into Picker in the browser is one step. "Go to the store, find it, install it, make an account, come back" is five, and every one of those is a place where a member gives up and goes to the supermarket.

The cost is mainly notifications. Browser notifications on phones are unreliable, especially on some phones, and I don't want the PW reminder to depend on something that may or may not arrive. I'll look at what the browser can actually do. If it's not good enough, we'll remind people some other way. That's a separate question and I'm not deciding it in these notes.

**Decision: Picker is a web app first. No native app during the pilot.**

The native app goes on the parking lot. We didn't discuss which platform it would be if we ever build one, and I'd rather we didn't until there's a reason to. How Picker actually talks to the lock to open a compartment is also still mine to work out. A web app doesn't make that easier, but it doesn't rule anything out that a native app would allow, as far as I can see from the spec sheets.

## Are we a food business?

This is the one that came out of nowhere. Ilona was reading the chill cell section of the spec sheet while I was writing up the window. She stopped and asked: if we're storing food in a lobby for up to a day and handing it over to people, are we running a food premises? Does Larder need a food-premises registration?

I didn't know. Neither did she. We spent twenty minutes being clever about it, which got us nowhere. There are good arguments both ways. A pod isn't a shop: we don't prepare anything, we don't open the boxes, the grower packs them and they stay closed until the member opens them. On the other hand, we're now deliberately holding food in a place we chose, for a period we just decided on, in cells that may or may not be cooled. If I were the city, I could see wanting to know about that. The window decision makes the question sharper, because "up to 24 hours in a dry cell" is exactly the kind of thing an inspector would ask about.

We did not answer it. We shouldn't try to answer it ourselves either. Ilona will ring the city's food control people and ask the question straight. Until then it's open.

What worries me is less the paperwork than what it might do to the HA conversations. If registration turns out to be needed and it comes with conditions about the space, those conditions land on the HA's lobby, not on us. I'd rather know before Ilona's next few lobby walks than after. Ilona wanted it on the red list. I argued it isn't blocking anything this week, because nothing goes into a pod this week. She said it blocks her talking confidently to an HA, and that's work. It's on the red list.

## Bits that didn't go anywhere

- Ilona wondered aloud whether members could "extend" their own window from Picker if they know they'll be late. I said nice idea, nightmare for the next box week. Parking lot.
- I had a half-idea that the pod could show a little countdown on the door of each cell. Ilona asked whether I'd seen the price of the supplier's displays. I had not. Parking lot, possibly the bin.
- We should probably write down, for growers, what "24 hours in a dry cell" means for what goes into a box sheet. Not today. Ilona will raise it with Aino informally first.
- The heater gave up at about half past two and we finished in the kitchen.

## Actions

- **Rasmus:** Ledger: add per-box drop timestamp to the drop record and compute the PW deadline from it (24 h from each box's own drop).
- **Rasmus:** Picker: show "collect by" date and time on the box screen, worded as plainly as possible; send Ilona the wording before building.
- **Rasmus:** Test browser notifications on both our phones and write up what actually arrives and when.
- **Rasmus:** Add "native app" and "member-extendable window" to the parking lot.
- **Ilona:** Call the city's food control office and ask whether Larder needs a food-premises registration; bring their answer, or the lack of one, to next Tuesday.
- **Ilona:** Tell Aino the window is 24 hours from the drop, and ask which things in a typical box would suffer most in a dry cell over that time.
- **Ilona:** Draft the one-paragraph explanation of the pickup window for HAs.
- **Rasmus and Ilona:** Keep the chill cell power question out of next week's agenda unless one of us has new information.
