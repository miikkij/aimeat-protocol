# Larder · session 6 · 17 February 2026 · Hardware and the first pod

Sleet all morning, the kind that never quite becomes snow. Oskar arrived at the Garage a little after ten with a cardboard tube of drawings under his arm and a shoebox holding a spare lock controller, which Rasmus was holding before Oskar had his coat off. I made coffee in the big pot. This was the first time the three of us have been in one room. Until now it has been Rasmus emailing Oskar and Oskar sending PDFs back.

For the record, Oskar is our contact at Kestrel Lockworks, the company that leases us the pods. Nobody said the full name more than twice all morning. By the end it was just "Kestrel", and Oskar says it is the same inside the company: the full name is on the invoices and that's about it. So in these notes it's Kestrel from now on. We are leasing, not buying. We didn't get into the lease itself today and I didn't want to. One thing at a time.

## Which pod

Oskar brought drawings of three units and we went through them on the workbench, with the lock controller as a paperweight. The smallest has no refrigeration, and we dropped it almost at once. A standard box with salad leaves in it can't sit in a dry cell for a day once the weather turns, and we would be designing for February and getting caught out in June. The largest is a lovely object, but it is far too wide for most of the lobby slots I have seen on lobby walks. I had my notebook with the rough measurements from the buildings so far, and it only fits in the very generous lobbies, which are not the ones we're likely to get.

That left the K-12, Kestrel's pod with 12 compartments. 3 of them are chill cells and the rest are dry cells. **Decision: the pods are Kestrel K-12 units, 12 compartments, 3 of them chill cells.** The reasons, as we said them:

- it fits the lobby slots I've actually seen, not the ones I wish I'd seen;
- three chill cells is enough to learn whether members want the cold option, without paying for cold we can't fill;
- Oskar checked our cardboard mock-up of a standard box against the drawings, and it fits in both kinds of cell with room to spare for a bag on top;
- Rasmus has already read the K-12 manuals end to end, which is half the reason he says "cell" and I say "compartment". We are both too stubborn to switch, and Oskar didn't seem to mind which one he heard.

Rasmus asked whether the chill/dry split can be changed later. Oskar said not on a K-12. You get what the frame is built for. We are fine with that for now.

## The spine and the heartbeat

Most of the K-12 is just doors. The interesting part is the column down the middle with the screen at the top, the modem behind it and the lock controller at the bottom. Oskar kept calling it "the control column". About the third time, Rasmus said it looks like a spine, and it does, with the doors hanging off it like ribs. Oskar laughed and said "the spine" was better than anything in their manuals. By eleven he was saying it himself. So: the spine.

The spine is what Rasmus cares about. Every 5 minutes it sends a status message, which Oskar calls a heartbeat, the way everyone in his line of work does. It says the pod is alive, which doors are shut, and whether the chill cells are holding. Right now the heartbeat goes to Kestrel's own system. Rasmus wants it coming into the Ledger as well, so that we can see a pod is alive from the Garage without phoning Raimo. Oskar thinks that can be done and will send the documentation for the message format. Rasmus asked a lot of questions about what happens when the modem drops out. Does the spine store heartbeats and send them later, or are they just lost? Oskar wasn't sure and will ask their technical people. What we do when heartbeats stop is a later conversation. Today was only about getting them into the Ledger at all.

Picker will also have to talk to the spine somehow, because members have to get into their compartment. How exactly is not decided. Rasmus wants to read the lock controller manual properly before he has an opinion, and I said that was the right order for once.

## How many

Before Oskar came, Rasmus had written "how many?" on the whiteboard, and we had both been circling it for a week. Rasmus came in at three and I came in at five. Rasmus's argument for three was that every pod is a building, an HA and a caretaker to keep happy, and the two of us are already stretched. Mine for five was that a pilot with too few buildings tells us about those buildings, not about the bet. One lobby where it works might just be one keen caretaker.

**Decision: the pilot starts with 4 pods.** Four is the most we can look after ourselves. That matters because we are doing the last metre with our own hands, and I would rather find out what goes wrong at the compartment door myself than hear about it secondhand. Four is also enough different lobbies that one good or bad one doesn't decide everything. Oskar said four is a normal first order for them and didn't seem to think it odd that we are starting small. Which buildings get the other three is not decided, and it depends on lobby walks we haven't done yet.

## Pod zero

Rasmus started calling the first one "pod zero" halfway through the coffee, because he counts from zero like every programmer. He also said, a bit more seriously, that the first one is the test, not really part of the count. I resisted for about a minute and then found I'd written it in my own notebook. It stuck.

**Decision: pod zero goes into the lobby of Alder Court.** This was the easiest decision of the day, and we still talked it through so that the reasons are written down:

- Raimo. Alder Court has a caretaker who already knows who we are, answered the phone when I called, and seemed curious rather than tired at the idea. For a first pod, that is worth more than a big lobby.
- The lobby walk there was the best one so far. The HA people were friendly, and the space by the mailboxes is out of the way of the stairs and the door draught.
- There's an ordinary wall socket within reach of that spot (see below on why that is enough).
- It's close enough to the Garage that if something goes wrong in the first week I can be there quickly.

Oskar's main question about Alder Court was the floor. A K-12 doesn't stand on its own feet. It sits on a plinth, a base frame that spreads the weight across the lobby floor so it doesn't press on a few small points. "Plinth" is Oskar's word and the normal word in the trade. Rasmus wanted to call it "the pelvis" to match the spine, and we told him no. Oskar unrolled the plinth drawing and I photographed it. I'm fairly sure Raimo will want to know about the lobby tiles before anything heavy goes on them, and I would rather show him the drawing than have him find out on the day. Oskar will send a proper PDF version with the installation notes.

## Lobby power: settled

This one has been on the red list since 3 February, when we asked whether chill cells could run in a lobby without a separate power line. I had half-convinced myself we'd end up asking every HA to pay an electrician, and that would have finished a lot of buildings before we started.

Oskar's answer was short. The K-12 is built to plug into an ordinary wall socket, chill cells included, and that is how they normally install it. The spine and the cooling share the one plug. There's no separate supply and no special line. Rasmus asked twice in different ways, and the answer was the same both times.

**Decision: chill cells run on the lobby's ordinary socket; no separate power line is needed.** The question from 3 February is closed. I crossed it off the red list on the whiteboard in front of everyone, which felt good. It also means the socket by the Alder Court lobby slot does the job, so pod zero doesn't wait on an electrician.

The other old question, whether we need a food-premises registration, is still open. I asked Oskar whether other Kestrel customers with chill cells had run into it. He said that isn't something Kestrel deals with, which is fair. It stays on the red list.

## The north number

Oskar left around half twelve, and Rasmus and I kept going over leftover pastries. Rasmus has been saying for a while that we watch too many numbers in the Ledger: sign-ups, boxes packed, payments, Picker logins. On a good day he looks at all of them and on a bad day at none. He wants one number that we steer the pilot by, the one we check first and argue about, the way you steer by north. He called it the "north number". I said it sounded like a lottery, then used it twice in the next five minutes, so that settled that.

The real discussion was which number. Sign-ups came up first and went out quickly, because signing up is cheap. Boxes sold came next, and it was closer, but it still isn't the bet. The bet is about whether people actually walk down to their own lobby and take the box out. An orphan box is a box someone paid for and never collected, and that should count against us, not for us. So the number has to be pickups.

**Decision: the north number is boxes picked up per week, and the pilot's target is 100.** We didn't do anything clever to get to 100. It's a round number that would clearly mean the bet is working, and that we can't hit by accident. Whether four pods can carry it depends on things we haven't settled yet, and I don't want to pretend we have. Rasmus is going to put it at the top of the Ledger's front page, where he has already abbreviated it to NN because "north number" didn't fit in the header. NN is now what we both say when we're in a hurry, so that's two names for one number. I can live with it.

One small point: a box counts once it has been picked up, so the Ledger has to know a door was opened and the box taken out, not only that it was dropped in. That ties back to the heartbeat and the lock controller. If the spine can tell the Ledger a door has opened, the NN more or less counts itself. If it can't, we're counting by hand, and that's no way to steer anything.

## Parking lot

Half-ideas from today that we're putting aside:

- Showing the grower's name on the spine's screen during a drop week, so that whoever opens the door sees "Ridgeback Farm" and not just a door number. Aino would like that, I think.
- A sticker or panel on the side of pod zero about Larder, so neighbours walking past know what it is. Rasmus worries it'll look like an advert in somebody's lobby. Raimo might have views.
- Oskar mentioned some lobbies put a little shelf beside their pods. We didn't talk about what we'd use it for and I'm leaving it there.
- Rasmus's "pelvis". No.

## Leftover worries

I'm a bit nervous that we've now picked the hardware before we've picked most of the buildings, so the K-12 has to fit lobbies we haven't seen yet. I said this out loud. Rasmus pointed out that we picked it precisely because it fits the lobbies we have seen, and the rest will probably look like those. Fair, but I'll keep the measuring tape in my bag for every lobby walk from now on.

The other worry is just time. Pod zero being real changes my week, because there's now an actual object, an actual lobby and an actual Raimo who will ask actual questions.

The sleet had stopped by the time we finished, which nobody remarked on.

## Actions

- **Rasmus**: read the K-12 lock controller manual properly, then write up what Picker needs from the spine to open a compartment.
- **Rasmus**: put the north number (NN: boxes picked up per week, target 100) at the top of the Ledger front page.
- **Rasmus**: once Oskar's documentation arrives, sketch how heartbeats get into the Ledger.
- **Oskar**: send the heartbeat message format documentation for the K-12 spine.
- **Oskar**: ask Kestrel's technical people whether the spine stores heartbeats when the modem drops out.
- **Oskar**: send the plinth drawing and installation notes as PDF.
- **Ilona**: call Raimo, tell him pod zero is coming to Alder Court, and go over the plinth drawing with him, especially the floor.
- **Ilona**: confirm the socket by the Alder Court lobby slot is the one we'll use and photograph it for Oskar.
- **Ilona**: take the 3 February lobby power question off the red list for good. Food-premises registration stays on it.
- **Ilona**: carry the measuring tape on every lobby walk and note whether a K-12 on its plinth would fit.
- **Ilona**: tell Aino about the grower-name-on-screen idea and see whether she likes it (parking lot only, no promises).
