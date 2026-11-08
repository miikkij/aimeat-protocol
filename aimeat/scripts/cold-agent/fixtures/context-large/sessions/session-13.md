# Larder · session 13 · 7 April 2026 · Weather, leases and data

Wet one. The dawn run went out this morning in sideways rain, and the Harbour Row fob took three goes at the reader before the door gave in. I spent the first quarter of an hour of the sit-down drying loop sheets on the radiator in the Garage while Ilona made coffee and told me the gutter over the side door needs looking at. Fitting weather, given what was at the top of the list.

Three things today: what we do when weather kills a drop, where member data lives, and finally lease versus buy on the pods. We got through all three, in that order, which hasn't happened for a few weeks.

## Rainy-day rule

Ilona had a call with Pekka on Sunday. Nothing has gone wrong yet, but the forecast for the next fortnight is grim. He told her straight that when the low field at Saltmeadow Gardens goes under he can't harvest, and he'd rather ring us early than send half a box. Liisa has said similar things about Three Oaks in a hard frost. Aino is the most weather-proof of the three because of her tunnels, but even she won't promise anything in a proper storm.

So we need a rule, and we need it before the first time it happens, not at ten on a Monday night with members expecting a box and the van already booked. Ilona called it "the rainy-day rule" half as a joke ("we literally need a rainy-day rule") and by the second coffee neither of us was calling it anything else. It means: what happens to a drop when a grower cancels it because of weather. Not a short box, where some items are missing and the swap card and the 3 € make-good already cover it. This is the whole box not coming.

We went through two options.

**Delay.** The box comes later, either later that week or folded into the next one. The case for it is obvious: the member still gets their vegetables. The case against piled up quickly:

- The dawn run is on Tuesdays and the van is hired on van day. A delayed drop means a second van day that week, at the same hire cost, for a fraction of the boxes.
- With a 24-hour pickup window, a box dropped on a Thursday lands in a completely different routine for the member. People have built Tuesday into their week, and our own PUR is the thing the kill criteria watch. A mid-week drop with no warning is exactly how you grow OBs.
- Folding it into next week means two boxes for one member in the same box week. A K-12 has 12 compartments and 3 chill cells, and Alder Court is already close to full on a normal Tuesday. Two boxes per member doesn't fit.
- There's no guarantee the field is dry by Thursday either. If it isn't, we have to delay the delay.
- Card on file is charged on the drop day. A moved drop day means the Ledger has to handle a charge on a day it doesn't expect, and that's where bugs breed.

**Skip.** The box simply doesn't come that week and we say sorry properly. Clean for the loop, clean for the pods, clean for the grower, who isn't asked to harvest in a flood to meet our schedule.

We went with skip. Then the argument was about how big the sorry should be. Ilona started at the full box price: the member has lost a week of meals they planned around, and it isn't their fault. I started lower, because it isn't our fault either, and a full refund on top of no box eats the house cut many times over. At 15 % we keep about 4 € on a standard box, so handing out 27 € per member per bad week would mean one storm wipes out a month's margin. The 3 € short-box make-good is clearly too small for a box that never arrives; it would feel like an insult. We met at half.

**Decision: rainy-day rule. When a grower cancels a drop because of weather, the box is skipped, not delayed, and each member gets a make-good of half the box price.** On a standard box at 27 € that's 13.50 €; on the half at 17 €, 8.50 €.

Naming came up straight after. "Rainy-day rule" is fine between us, but in Picker it sounds like we're quoting our own rulebook at people. I suggested Picker shows it as a "weather skip": to the member it looks and behaves like a skip week they didn't choose, with the make-good shown next to it, so the word explains itself. Ilona liked it because it puts the reason in the label, not in small print. So internally it's the rainy-day rule; in Picker and in member notes it's a weather skip. Same thing.

Things we did not settle and don't want to settle without the growers:

- What happens to the grower share on a weather skip. Ilona wants to talk it through with Aino, Pekka and Liisa one by one before we write anything down. She doesn't want them to feel punished for weather, and she doesn't want us paying for vegetables that never left the field either.
- How early a grower has to call it. Ilona would like it to be the day before the dawn run at the latest, but wants to hear what's realistic from the farms first, so no cut-off yet.
- What "half the box price" means for a member on a season pass, who has paid ahead at a discount. I said I'd work the numbers out in the Ledger and bring them back rather than guess today.

Ilona also wants the building champions to hear about the rainy-day rule from us before the first one happens, so they're not caught out in the lobby by a neighbour asking where their box went. Oskar at Harbour Row in particular gets asked everything; a BC who knows the answer is worth more than any message we push.

I need to build the weather skip into Picker and the Ledger: a way for Ilona to mark one grower's drop as cancelled for weather, which then skips those boxes, credits the make-good to each affected member and sends the member note. Not hard, but it has to work the first time, because the first time will be a bad morning.

## Member data

This one started somewhere else. I've been reading the Kestrel spine manual properly (the parts past the wiring diagrams) and found the section on the cold chain log. The spine keeps a running record of the temperature inside each chill cell. It's the supplier's own term and it's a good one. Ilona's ears went up immediately because of the food premises registration for the Garage: if anyone from the city's food authority ever asks how we know a box stayed cold between the drop and the front-pick, that log is the answer. The registration is for the Garage, not the pods, but she'd rather be able to show it than not. I'll pull a copy of the log into the Ledger next to the heartbeat so it isn't sitting only on a box in a lobby. (We did not talk about what temperature counts as "cold enough"; that's for another day.)

That turned into the real question: what do we actually hold about members, and where does it sit? I listed it on the whiteboard: names, phone numbers (the wake codes go by SMS, so there's no way round those), which building and which compartment, when each box was picked up, payment references for the card on file, skip weeks and season passes. Add the heartbeats and now the cold chain log. None of it is exotic, but it's people's phone numbers and where they live, down to the lobby.

Then the slightly embarrassing part. The Ledger's database still runs on the server I set up in January, which I chose for price and speed of setup, and I have never actually checked which country it sits in. Ilona gave me a look. In fairness to me, in January we had zero members. We have members now.

Oskar at Harbour Row (our BC there, not the Kestrel Oskar) mentioned to Ilona last week that a neighbour had asked him who can see their phone number. Nothing formal, just lobby talk, but it's the kind of question an HA chair like Sirpa could easily ask at a meeting, and "I'm not sure where the server is" is not an answer we want to give.

Ilona wanted the simple version: the data stays somewhere we can explain in one sentence. I've started saying "EU host" for it: a hosting provider whose servers are physically in the EU. It keeps us inside one set of data protection rules, it's an easy thing to say to a member, a BC or an HA, and Ilona thinks the grant reviewers are likely to ask about it too. Cost-wise there's no real difference at our size. I checked a few on my phone while we talked, and they're all in the same range as what we pay now.

**Decision: member data stays on an EU host.** That covers the Ledger's database and anything else that holds member data, backups included. The cold chain log isn't personal data as such, but it goes along with everything else; I don't want two homes for the Ledger.

Moving it is on me. The careful part is the switch-over: wake codes can't stop working in the middle of a pickup window, so I'll do it on a quiet day, well away from a Tuesday, and keep the old server read-only for a little while afterwards in case something got missed.

## Pod lease

The question from 31 March: lease the pods or buy them. Since then Oskar at Kestrel has come back with a monthly figure. Kestrel's word is "lease": we rent each pod from them by the month instead of paying for it outright. The figure he gave is 85 € a month per pod.

With 4 pods that's 340 € a month. Put the lobby fee on top and each pod costs us 125 € a month standing in its lobby before a single box goes in. I did the sum out loud and it sobered us both: at 15 % of 27 € we keep about 4.05 € per standard box, so a pod needs around 31 standard boxes a month through it just to pay for itself, before vans, before the Garage, before us. It's not a scary number against the NN target of 100 a week across the pilot, but it's a real one.

The case for buying is that you stop paying eventually, and if Larder is still going in a few years, owning would have been cheaper. That's about all there is on that side, and it depends on things we don't know yet.

The case for leasing was stronger on every point we actually care about this spring:

- No outside investors during the pilot. Buying four pods outright would come out of our own pockets, and that money is better spent on vans and members.
- The pilot runs until the end of June. If the kill criteria trigger, we'd rather hand pods back than own four lockers with nowhere to stand.
- We still don't know if the K-12 mix is right for every building. Three chill cells out of twelve fits Alder Court today; we have no idea yet about the others in summer. Leasing doesn't lock us into one answer.
- The grant isn't decided. Ilona doesn't want to make a purchase that only makes sense if we get it.

Ilona's line, which I'm writing down because it was the whole argument in one sentence: "We're still finding out if this works. Rent until we know."

**Decision: pods are leased from Kestrel, not bought, at 85 € a month per pod.** That settles the open question from 31 March: lease, not buy.

What it does *not* settle is who insures a pod standing in a lobby. That one is still open and it's going on the red list. A lease makes the question sharper rather than answering it, since the pod is now plainly Kestrel's property sitting in an HA's lobby. I'll ask Oskar at Kestrel what they expect from us on that front before anything is signed, rather than assume.

## Parking lot additions

- Ilona: some kind of forecast warning in the Ledger so we see a bad week coming before the growers ring. Nice, not now.
- Me: what happens to a grower's surplus after a storm, if any of it survives. Could find its way onto the honesty shelf, could not. Not today.
- Ilona again, half-joking: a raincoat for whoever does the dawn run. Possibly the most urgent item on the list.

## Actions

- **Rasmus**: build the weather skip into Picker and the Ledger (mark a drop cancelled for weather, skip the boxes, credit half the box price to each member, push the member note).
- **Rasmus**: work out what the half-price make-good means for season pass members and bring the numbers to the next sit-down.
- **Rasmus**: pick an EU host, move the Ledger and its backups over on a quiet day away from a Tuesday, and keep the old server read-only for a while afterwards.
- **Rasmus**: pull the cold chain log from each spine into the Ledger alongside the heartbeat.
- **Rasmus**: ask Oskar at Kestrel what they expect from us on insuring leased pods; add insurance to the red list.
- **Ilona**: confirm the lease with Oskar at Kestrel at 85 € a month per pod for the 4 pods.
- **Ilona**: talk the rainy-day rule through with Aino, Pekka and Liisa, including what happens to the grower share and how early they can call a cancellation.
- **Ilona**: brief each building champion on the rainy-day rule, starting with Oskar at Harbour Row.
- **Ilona**: keep the cold chain log in mind for the Garage's food premises paperwork, in case the city asks.
- **Ilona**: get someone to look at the gutter over the Garage's side door.
