# Larder · session 20 · 26 May 2026 · Bigger pods and the cold chain

Oskar from Kestrel came to the Garage at ten, straight after the dawn run, so all three of us were a bit grey round the edges. Rasmus had driven the loop, I'd done the pack line last night, and Oskar had come in from the Kestrel depot with a brochure and a laptop. To be clear for anyone reading back: this is Oskar from Kestrel Lockworks, not our Harbour Row Oskar. Harbour Row Oskar wasn't in today and nothing below is his. Coffee from the thermos, the garage door half up because it was already warm. That turned out to matter for the afternoon.

## Where we are

Rasmus read out last week's numbers before anything else, because they're why Oskar was here at all. Boxes picked up last week: **88**. Pickup rate: **91 %**. That's the best week of the pilot by a distance. It's well clear of the kill criteria line, and close enough to the north number target of 100 that we've stopped saying "if" and started saying "when". Rasmus was pleased in his quiet way. He put the number on the whiteboard and drew a box round it, and didn't say anything for a while.

The shape of the problem is just as clear. The pods are full. Most Tuesdays now the loop sheet has more boxes for some stops than there are compartments to put them in, and I spend the pack line evening juggling. Who's a half, who's on a skip week, which box can go in a dry cell without wilting. The chill cells are the real squeeze. Three per pod was fine in March when the first drop was 11 boxes into pod zero. It isn't fine when leafy boxes are a third of the pack sheet and the window is 48 hours long.

The window is the part I keep coming back to. The longer window is a big reason the pickup rate has climbed, because the shift workers aren't missing their boxes any more. But it also means a box sits in its compartment a lot longer. A lettuce that was happy for an evening is less happy on Wednesday night in a dry cell in a sunny lobby.

## Going back on the K-12

We decided on **17 February** that the pods would be Kestrel K-12 units, 12 compartments, 3 of them chill cells. I went back to the notes from that sit-down before today. The reasons then were sound. We didn't know whether the bet would hold. The K-12 was the smallest unit Kestrel would lease, it was the one they could get to us quickly, and the plinth fitted every lobby slot we'd seen on lobby walks. We didn't want to be paying for empty doors while we found out whether anyone would front-pick a box at eleven at night. Rasmus's line at the time was "rent the smallest thing that can prove us wrong". I still think that was right for February.

It's not right for late May. Oskar had brought the spec sheet for the **K-16**, which is Kestrel's next model up: 16 compartments, 4 of them chill cells. Same spine, same lock controller, same hatch arrangement. Rasmus says that means the Larder layer doesn't need to change beyond the cell count, and the door pulses go out the same way. The footprint is wider. Oskar thinks the plinth is the same depth, but he wants to check that rather than promise it.

We went round it for a good hour. The case for:

- The K-12s are full now, and the waitlist in the wave 1 buildings hasn't stopped growing.
- One more chill cell per pod is the bit that actually fixes the leafy-box problem. Four extra doors would be nice. One extra chill cell is the thing.
- Ferry Close and Weaver's Yard are new enough that swapping them now is less disruption than swapping them later, once members have learned "their" door.
- Rasmus would much rather have one pod model in the Ledger than two. Mixed fleets mean two versions of everything: the loop sheet layout, the drop scan screens in Field, the compartment numbering. He was firm that if we go up, we all go up.

The case against was mostly cost and lobbies. Oskar couldn't give us a lease figure for the K-16 on the spot. He'll send it, and until then the lease stays as it is on paper. I don't want anyone reading these notes to think we've agreed a new number, because we haven't. There's the lobby fee question too. A bigger pod takes more floor, and I can imagine an HA asking whether 40 € still covers it. Nobody has asked yet. I'm not going to raise it before they do, but I'm also not going to be surprised.

In the end it wasn't close. **Decision: new and existing pods move to the Kestrel K-16, with 16 compartments, 4 of them chill cells.** This replaces the 17 February decision on the K-12. The pilot has outgrown the pod we picked to test it. The extra chill cell is what the longer window needs, and one model across all pods is simpler for the software and the loops. Oskar is going back to Kestrel with that and will come back with how a swap would run and what it does to the lease. We didn't set an order for the swaps today. My instinct is the fullest pods first, but that's for when we know Kestrel's side.

Rasmus raised one thing before we moved on, and nobody had an answer. **Is a 16-compartment pod too big for the smaller buildings?** Some of the lobby slots we've seen on lobby walks for the later wave 2 buildings were tight even for a K-12. Kiln Lane in particular, from my memory of the walk, is basically a corridor with a mailbox wall. Going all-K-16 might mean a building we'd otherwise take can't fit a pod. Or it might mean a pod with a lot of empty doors in a building that only ever fills eight. We left it open. I don't want to decide it from memory; I want to stand in a couple of those lobbies with a tape measure first.

## Temperature, and the log

This was the second half of the morning. It's the part I'd been more worried about, if I'm honest, because the cold chain is where we could actually hurt someone rather than just annoy them.

Oskar showed us that the chill cells on our K-12s have been running on Kestrel's factory setting since install. Nobody on our side ever changed it, because nobody on our side ever asked. The cold chain log has been recording on whatever its default was too. Rasmus pulled a week of it up and it's patchy: long gaps, then bursts. Oskar thinks the log has been saving only when something changed rather than on a clock. Either way it's not something I'd want to show Hilda if she ever asked how an orphan box had been kept. She hasn't asked. I'd still like to be ready for it, given those boxes sit for the full window before they go on the orphan run.

We talked about what temperature to hold. Rasmus wanted to go as cold as the cells would go. Oskar pointed out that the back of a chill cell runs colder than the setpoint, and things touching the back wall can freeze. Frozen herbs in a member's box is its own kind of make-good. I wanted something I could write on the onboarding pack and in a GSA conversation without anyone needing a thermometer lesson. We settled on one number.

**Decision: chill cells are held at 4 °C, and the cold chain log records every 10 minutes.**

The 4 °C is cold enough for leaves and soft fruit across the full window and not so cold that the back row freezes. The 10 minutes came out of a back-and-forth between Rasmus and Oskar. Rasmus's first thought was to log on every heartbeat, since the spine is talking to the Ledger every 5 minutes anyway. Oskar said the spine stores the log locally first and sends it up with the heartbeat. On a pod whose modem drops out, logging that often fills the local store faster than he'd like. Ten minutes is fine-grained enough to catch a door left open or a cell that's struggling, and gentle enough on the spine. Rasmus was happy once he understood he could still see a live temperature on each heartbeat. The ten-minute log is the record; the heartbeat is the glance.

Oskar says the K-16 spines take the same setting. The decision carries across the swap without anything new to agree.

## Ice bricks and frost guard

Two smaller things came out of the temperature talk, and both got names that I suspect will stick.

The first was the afternoon heat. With the garage door up it was already properly warm by the time we got to this, and I said out loud what I'd been doing on the last couple of hot Tuesdays. When a leafy box has to go in a dry cell because the chill cells are taken, I've been slipping a frozen pack in with it. They're the hard blue blocks from the camping shop, not the soft gel ones. Rasmus kept calling them ice packs. I said they're not packs, they're bricks, you could build a wall with them. By the third time he said "ice brick" himself without noticing, so that's what they are now. An **ice brick** goes in a dry cell on a hot day. That's all it is for the moment. I've not made it a rule, and I've not worked out how they come back to the Garage. They're cheap, but they're not free, and I already have a crate problem without adding a brick problem. The K-16's fourth chill cell should mean fewer dry-cell leafy boxes anyway. I'll keep doing it on hot Tuesdays and see.

The second was the opposite end of the year. Oskar mentioned, almost in passing, that the K-16 spine has a heater mode for lobbies that get cold. The manual calls it something long about "low ambient protection". It keeps the dry cells from dropping too far on winter nights and stops the locks and the screen from sulking. Rasmus said "so, frost guard" and Oskar laughed and said that's better than the manual's name. **Frost guard** it is. We don't need it in May. But Raimo told me back in the winter that the Alder Court lobby heating is turned right down at night. A caretaker in another building said much the same on a lobby walk, about a lobby where the front door gets propped open all day for deliveries. Oskar says the K-12s have something similar, buried deeper in the settings, and he'll show Rasmus where. Nothing decided on when it's switched on. It's the parking lot until autumn.

## Pod health

Rasmus had been holding back on this one until the end, and I think he'd half-built it for today. He's put a new page in the Ledger that shows every pod on one screen: last heartbeat, chill cell temperature, any faults from the spine. That covers a lock that didn't confirm, a modem that's gone quiet, a hatch left open. He called it **pod health** when he opened it. I said that's a good name, and that was that. It's not finished. The fault list is still raw codes from the spine, and the temperature is just a number rather than anything that warns you, but even raw it's useful.

He showed us this morning's Weaver's Yard drop. There was one sticky door. The member there ended up using their wake code instead of the QR stub. You could see the fault come in on pod health and then clear when the door opened on the second pulse. Oskar was quite interested in that and wants to know whether it's the same compartment every time.

I asked where the page's data lives. Rasmus says it's the same Ledger, on the same EU host as everything else, and the cold chain log goes there too once it comes up off the spine. Good. I didn't want a second system somewhere. Oskar asked whether Kestrel could see pod health. Rasmus said not yet, and probably not as a login. Maybe a weekly export. We didn't decide, and Rasmus is wary of anyone outside the two of us poking at the Ledger, so it sits as a maybe.

A few things went on the parking lot from this:

- An alert on pod health when a chill cell is warm for more than a couple of log readings. We haven't settled what "warm" means beyond being above the setpoint, and Rasmus wants to see a few weeks of the new log first.
- Whether OBs that sat in a warm cell should be flagged before the orphan run, so I can decide whether they go at all.
- Showing a member that their box was kept cold. It's a lovely idea, but it's also a promise, and I'm not ready to make it.
- Whether the lobby insurance needs anything new for the bigger pods. I'm assuming Kestrel's lobby insurance just follows the pod, but I'd rather Oskar confirmed it than assume.

## Odds and ends

Caretakers came up again, briefly. A bigger pod is more for a caretaker to keep half an eye on, and Rasmus wondered aloud whether that changes the question of giving them something. It doesn't answer it. That's still open and we didn't try today. The trademark question on Cropbox is still open too; nothing new there. Oskar has seen the green shroud mock-up and says the K-16 shroud is a different panel size. So the Cropbox mark needs re-laying out, but not redesigning.

Rasmus wants the NN on the whiteboard every week now, not just in the Ledger. "So we watch it go up to 100, not just read about it." Fine by me.

The heat broke around two with a short, heavy shower. Oskar left, Rasmus and I finished the coffee, and I wrote this up.

## Actions

- **Oskar (Kestrel)**: send the K-16 lease figure and how Kestrel would run the swap of existing pods; confirm the plinth depth and whether the lobby insurance carries over unchanged.
- **Oskar (Kestrel)**: show Rasmus where the heater setting lives on the K-12 spine; check whether this morning's sticky door at Weaver's Yard is a repeat compartment.
- **Rasmus**: set all chill cells to 4 °C and the cold chain log to every 10 minutes; check on pod health that it's holding.
- **Rasmus**: keep building pod health. Readable fault names first; the warm-cell alert stays on the parking lot.
- **Ilona**: measure the lobby slots at the smaller wave 2 buildings against the K-16 footprint once Oskar sends it, so we can look at the open question with numbers.
- **Ilona**: buy a few more ice bricks for hot Tuesdays and work out how they get back to the Garage.
- **Ilona**: add the 4 °C chill cell setting to the onboarding pack and mention it to growers before the next GSA conversation.
- **Ilona and Rasmus**: plan the order of pod swaps once Kestrel's side is known.
