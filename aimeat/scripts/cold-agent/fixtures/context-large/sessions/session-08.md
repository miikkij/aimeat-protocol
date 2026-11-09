# Larder · session 8 · 3 March 2026 · Money and codes

Coffee at my kitchen table this time, not the Garage. The little heater out there gave up over the weekend and two hours of sitting in a coat didn't appeal to either of us. Rasmus brought cinnamon buns from the bakery by the tram stop, which is apparently now a Tuesday sit-down tradition. Sleet on and off all morning, the kind that never quite becomes snow.

Four things on the list today: the house cut, how members actually open a cell, caretakers, and grower news. I'm starting with the growers because it's the nicest part and I wanted to say it out loud.

## Growers: we have three

We have three growers signed. Pekka at Saltmeadow Gardens and Liisa at Three Oaks Market Garden both sent their GSAs back since last week, and I countersigned both for Larder over the weekend. So the count is now 3: Ridgeback Farm, Saltmeadow Gardens and Three Oaks Market Garden. Rasmus changed the number on the whiteboard from 1 to 3 with a lot of ceremony and a slightly dried-out marker.

Some notes on the two new ones, mostly for my own memory:

- **Pekka (Saltmeadow Gardens).** Very practical, slightly suspicious of apps, very interested in the money. He grows a lot of roots and cabbage-family things out by the coast road. His first question was which of his vegetables would end up in a chill cell and which in a dry one. I told him we'd come back to him once we know how the boxes split across a K-12. He also asked twice whether we were "one of those platform things", and I hope I convinced him we're not.
- **Liisa (Three Oaks Market Garden).** Organised, and she has clearly done box schemes before in some form. She asked for the box sheet format before she asked about anything else, and wants to know if she can send a photo of a handwritten sheet instead of filling in a form. She sends one box sheet per box week like everyone, so for her it's only about the format. I said a photo is probably fine for now and I'd send her the template anyway.

Both of them, and Aino as well when I think about it, called the house cut "commission" on the phone. Pekka said it in his first sentence: "So what's your commission?" Rasmus pulled a face because to him "commission" sounds like an estate agent, but it's what growers hear, and it's the same thing. I've already caught myself saying "commission" on grower calls and "house cut" in here. Fine. Two words for one number, as long as the number is the same.

That brings us to the awkward bit. All three GSAs went out with the grower share line in the schedule left blank, to be filled in once we had a figure. That was my call. I didn't want to write a number into a contract before the two of us had agreed one. So today the house cut wasn't optional. We had to settle it.

## House cut: 20 %, then 15 %

Rasmus had a spreadsheet ready, of course. We didn't go through costs line by line, because we don't have real ones yet. He sketched the categories: van hire on van day, the Kestrel lease, SMS, card fees, and some margin for the things we haven't thought of. His argument was simple. At 24 € a standard box, we need enough per box that hitting the north number actually pays for the dawn run and the pods. Otherwise we've built a very nice charity for growers.

We settled on **20 % of the box price** fairly quickly. That makes the house cut 4.80 € per standard box and the grower share 19.20 €. It's a round number, it's easy to explain to a grower, and it looked reasonable next to what Rasmus thinks the van and lease will eat. I wrote it down. For about ten minutes it was the decision.

Then I did what I'd promised myself I'd do with any number before it goes into a GSA: hold it up against Aino. In January at Ridgeback she told me roughly what she takes at her market stall for a bag about the size of a standard box. I worked it through on the back of the agenda. **At 20 %, 19.20 € is less than her market stall pays her** for the same vegetables. Not by a huge amount, but it's less. She would also be packing the box herself at the farm, which she counts as her own time. So we'd be asking her to give us her Tuesday harvest for less than she gets by standing in the cold on a Saturday. Nobody sensible says yes to that for long. Aino would probably say yes anyway because she likes us, which makes it worse.

Rasmus argued for a bit. Isn't the market stall a different thing? Weather, unsold stock, a whole day standing there? All true. But a grower doesn't think in "total cost of the Saturday". They look at the number per bag. If ours is lower than the stall's, we're the worse deal. And if our first grower feels short-changed, that gets around to Pekka and Liisa within a week.

So we changed it. **The house cut is 15 % of the box price**, not 20 %. At 24 € that's a house cut of 3.60 € and a grower share of 20.40 €, which clears what Aino gets at her stall. I crossed out the 20 % in my notebook rather than tearing out the page. Rasmus insisted the record should show we got it wrong for ten minutes. Fair.

Rasmus is not thrilled. 3.60 € a box is thin, and he said so twice. His view is that 15 % only works if volume comes, so the north number matters even more than before. I agree. I'd still rather start thin with growers who feel well treated than comfortable with growers who feel used. I don't know Pekka's and Liisa's stall numbers as well as Aino's. Aino's was the one I could actually check, and if it holds for her I'm less worried about the others.

For the GSAs: I'll fill in the grower share on all three schedules and send them back with a short note. I'll call it "commission" in the note, obviously.

## Opening a cell: the wake code

Second big topic. Rasmus had three options for how a member opens their compartment at the pod:

1. **A QR code in Picker** that the member holds up to the spine. Rasmus's doubt: the spine would need to read it reliably in a badly lit lobby, and the member has to have Picker open on a working phone, right there, with battery.
2. **Bluetooth from the phone.** We dropped this fast. Picker is a web app, Bluetooth from a browser is patchy across phones, and we're not building a native app during the pilot. Rasmus said "no" before I'd finished the sentence.
3. **A numeric code typed on the spine's screen.** The member gets a code, walks up, types it in, and the cell opens.

We went with the third. **A member opens their compartment with a 6-digit wake code sent to them by SMS.** Here's how it works. When a box goes in on the dawn run, the Ledger generates a code for that box and texts it to the member. The member types it on the spine. The spine asks the Ledger whether the code is good. If it is, the Ledger sends a door pulse back to the spine and the right cell clicks open.

The reasons we gave each other:

- **SMS reaches everyone.** It works for members who never open Picker, for older residents, and for anyone whose phone is three generations old. Getting the box from the cell into the member's hands is the last metre, and it shouldn't depend on an app working.
- **It can be passed on.** If your partner or your neighbour picks up your box, you forward the text. No accounts, no sharing a login.
- **Six digits.** Four felt too guessable. With twelve cells in a K-12 and someone bored in a lobby at 2 a.m., we didn't love it. Eight is miserable to type in gloves. Six is what banks use and people are used to it.
- **It's the simplest thing to build.** Rasmus thinks he can have a rough version against the Ledger well before pod zero sees real members.

About the words. "Wake code" is mine, sort of by accident. The spine's screen sleeps until someone touches it, and I kept saying "the code that wakes the cell up". Rasmus laughed at that, then quietly named the field `wake_code` in the Ledger schema while we were still talking, so that was that. We've been saying "wake code" all afternoon.

"Door pulse" is Rasmus's. Kestrel's manual has a name for the unlock signal that's about four nouns long. Rasmus has been calling it a door pulse in his head for weeks, and today he said it out loud. It's the signal the Ledger sends to a pod's spine to unlock one cell. Short, and it says what it is. It's staying.

Worries we wrote down and didn't solve:

- **The spine is offline.** No door pulse, no open door, and a member standing in the lobby with a valid wake code and no box. The heartbeat will tell us within five minutes that a spine has gone quiet, but knowing isn't the same as fixing it. Rasmus wants to look at whether the spine can check codes locally when it can't reach the Ledger. On the parking lot.
- **The SMS doesn't arrive.** Should the wake code also show in Picker? Probably, but we didn't decide. Also on the parking lot.
- **SMS cost.** It's per message and it's one more line on Rasmus's spreadsheet, which has just got tighter at 15 %. Rasmus will find out real prices before we panic.

A side benefit came up while we talked it through. Every wake code that gets used gives the Ledger a clean timestamp for the moment of the front-pick. That means we can finally measure the **pickup rate** properly: the share of boxes collected before the pickup window closes. Rasmus immediately shortened it to **PUR**, the way he shortens everything. The north number counts boxes picked up per week. PUR tells us something different: whether the 24 hours actually works for people, or whether boxes are sitting in cells into the next morning. A low PUR means more orphan boxes, and that lands on caretakers, which led straight into the next topic. We didn't set a target for PUR. We just agreed it goes on the Ledger dashboard next to the NN from the first drop.

## Caretakers

Raimo rang in the middle of the wake code discussion, which was good timing. He wanted to know who would be coming into Alder Court early on Tuesdays and how they'd get through the front door. The building's front door opens with a fob, the little blue key tag every resident carries. A van driver at dawn doesn't have one. Raimo said he could lend us one, but he'd rather know who's holding it, which is fair. He also asked again, in a friendly way, what happens when a box is left over. I reminded him that orphan boxes come to him. He said "yes, yes, I remember", in a tone that suggested he'd been thinking about it more than he was letting on.

After the call we sat with it for a while. Our plan leans on caretakers a lot, more than I think we'd admitted to ourselves:

- They hold the lobby keys, and now possibly a fob for the dawn run.
- Orphan boxes end up with them.
- They're the ones who'll notice first if someone kicks a pod, a chill cell starts humming oddly, or the lobby slot gets blocked by a bike.

So the question we wrote down: **should caretakers get something for helping with the pods?** For holding the keys, the fob, the OBs, and for keeping an eye on the pod in general. We went round it. Rasmus's first thought was a free box each box week. My first thought was that some caretakers would find that slightly insulting and would rather have money, or nothing at all. Raimo has never once suggested he wants anything. Then there's the question of whether it should go to the caretaker or to the HA, and whether paying one person changes how the HA feels about the pod. We didn't get near an answer. It stays open, and I want us both to have thought about it properly before we bring it up with Raimo. The worst outcome would be offering something clumsy and making it awkward.

One thing I'll say for the notes: if PUR turns out low, this question gets more urgent, because a caretaker handing out a couple of orphan boxes a week is a favour, and one handing out ten is a job.

## Parking lot additions

- Offline wake code check on the spine when the Ledger can't be reached.
- Showing the wake code in Picker as well as by SMS.
- Pekka's question on which vegetables go in chill cells vs dry cells.
- Whether a photo of a handwritten box sheet is good enough long term, or only for now.

The food-premises registration question is still open. Neither of us made progress on it this week, and we didn't touch it today.

## Actions

- **Ilona:** fill in the grower share on the GSA schedules for Ridgeback Farm, Saltmeadow Gardens and Three Oaks Market Garden (house cut 15 %, grower share 20.40 € on a 24 € standard box) and send them back with a short note.
- **Ilona:** call Aino to talk her through the figure before the paper arrives, so she hears it from me first.
- **Ilona:** send Liisa the box sheet template and tell her a photo of a handwritten sheet is fine for now.
- **Ilona:** ask Raimo how lending a fob for the dawn run would work at Alder Court, and who he'd want to hold it.
- **Rasmus:** add `wake_code` generation per box to the Ledger, plus the SMS send when a box is marked as dropped.
- **Rasmus:** build the code check and door pulse path from the Ledger to the spine, and test it against whatever Kestrel's sandbox allows.
- **Rasmus:** email Oskar for the Kestrel documentation on entering codes on the K-12 spine screen and on the unlock signal.
- **Rasmus:** get real SMS prices from a couple of providers.
- **Rasmus:** add PUR next to the NN on the Ledger dashboard.
- **Rasmus and Ilona:** each come to the next Tuesday sit-down with one concrete idea for the caretaker question. No deciding before then.
- **Ilona:** get the Garage heater looked at, or buy a new one.
