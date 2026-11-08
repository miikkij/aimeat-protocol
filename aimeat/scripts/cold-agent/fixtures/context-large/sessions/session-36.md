# Larder · session 36 · 15 September 2026 · Colder chill cells

Oskar from Kestrel came to the Garage this morning. This was the Kestrel Oskar, not our lobby host at Harbour Row, who had nothing to do with today. Rasmus had asked him in for the chill cells, and he stayed for most of the sit-down. Grey and mild outside, the kettle on twice before ten. Maija wasn't in the room but kept the session chat open from home, which is how the FAQ below ended up in these notes.

Before Oskar arrived, Rasmus and I agreed to keep the talk on temperatures and nothing else. We did. When Oskar asked in passing how things were going in general, Rasmus said "busy" and pulled the cold chain log back up on the screen.

## Why the chill cells came up again

It started with August. We had a run of hot weeks, and in the hottest of them a few things lined up. Aino messaged twice that "the cabinet at Mill Gate felt warm" when she put her boxes in. A lobby host at Weaver's Yard sent a photo of salad that had gone soft by the second evening. And Rasmus kept seeing the chill cell temperature lines on the Pulse climbing in the afternoons and taking a long time to come back down.

None of it was a disaster. Nothing was off, and nobody asked for a make-good over it. But it was enough that Rasmus went through the cold chain log for every pod for the whole of August. He laid the drop scan times from Field next to it, so we could see which bumps came from doors opening and which came from the lobby itself warming up.

What he found, roughly:
- Every back-load and every front-pick puts a small spike into the log. That part is expected and the cells recover quickly.
- The real problem is the slow drift in warm lobbies in the afternoon. The cells sit above target for long stretches and only pull back down in the evening.
- Ferry Close and Saltworks were the worst. Both have lobbies with big south-facing glass. At Ferry Close the shroud sits right in the sun until about three.
- The cells that looked worst were the ones holding a box late in its window. A box that has sat there most of the 36 hours, or an OB waiting for the orphan run, gets the full afternoon drift.

Oskar's first reaction was the useful one. He said the setpoint is a target, not a ceiling. The cell swings around it as the compressor cycles. So if you set 4 °C, you should expect readings above 4 in a warm lobby with doors opening, and you should judge the cell by its peaks rather than its average. He had the K-16 manual open on his phone and read us the part on control range, which none of us had ever looked at closely.

## What we decided in May, and why

On 26 May we settled on 4 °C for the chill cells, with the cold chain log recording every 10 minutes. I went back to my notes from that session to check why. As far as I can reconstruct it, there were three reasons:

1. **It was Kestrel's suggested value.** It matched what the growers were used to from their own cold rooms.
2. **Freezing worries.** We were nervous about leaves frozen at the back of the cell near the cold plate, which Pekka had warned us about from a bad experience with a borrowed fridge.
3. **Power worries.** We were still nervous about the lobby socket. Running the chill cells colder sounded like asking for trouble with a power draw we didn't fully understand yet.

It was also late spring. Lobbies were cool, the pods were fewer, and nobody had seen a K-16 go through a hot week. 4 °C was a reasonable number for what we knew then.

## Going to 3 °C

We spent a good hour on this. The short version: we're moving the chill cell target down to 3 °C. This replaces the 26 May decision of 4 °C.

The reasons, as they came out in the discussion:

- **Margin for the peaks.** With the target at 4, the afternoon drift in a warm lobby takes the cells further above it than we're comfortable with. Taking a degree off the target pulls the whole swing down by a degree. Oskar's view was that this is the cheapest fix there is: no new parts, no visit, just a setting on each spine.
- **The window is 36 hours now.** It is no longer as short as the box life we planned around in spring. A box at the far end of the window has had a lot of hours in the cell, and that's exactly where the August log looked worst. Rasmus: "we made the window shorter, but the box still lives in there for a day and a half."
- **OBs.** Until the orphan run picks them up, they sit in a chill cell like everything else. If they're going to the Pantry, they should go in decent shape.
- **The Garage side.** The Garage is a food premises now, and the Harvest boxes leave here hub-packed. I'd like to be able to show anyone who asks a cold chain log that sits comfortably inside the range, not one that keeps brushing the top of it. This was my argument more than Rasmus's, but he didn't disagree.

On the May worries, Oskar answered both.

On freezing, he said the K-16 cell holds 3 °C without leaves at the back freezing, as long as air can move. The usual cause of frozen bits is a crate pushed flat against the back wall, with nothing between it and the cold plate. That's a packing habit, not a setpoint problem. I've made a note to look at how the Harvest crates sit when they go in. I also want to check whether any of the grower-packed crates are a size that fills the cell edge to edge.

On power, he said the draw goes up a little at 3 °C but stays well inside what the ordinary lobby socket handles. Nothing changes there; no extra line needed. Rasmus wants to watch it on the Pulse for a couple of weeks anyway, which is fair.

We didn't touch the cold chain log interval. It keeps recording as it does now.

Oskar will have his team push the new setpoint to each spine; it isn't something the Larder layer sets, it lives in Kestrel's own config on the spine. Rasmus will watch the Pulse as each pod changes over and flag any that don't settle. Linden Yard is getting a pod for the move, and Oskar said it can simply be set to 3 °C from the start rather than changed afterwards.

## "Summer setpoint"

Rasmus coined this one halfway through. Every argument we had for 3 °C came out of the hot weeks. He started calling the 3 °C value "the summer setpoint", partly as a joke at the fact that we were deciding it in mid-September with the heat already fading. Oskar picked it up at once because "setpoint" is his word from the manual anyway. By the end all three of us were using it.

So the summer setpoint is the chill cell target we run in hot weeks. Right now that is 3 °C, and right now it's the only target, since we've just set every pod to it.

That leads straight to the question we didn't settle: should the chill cells go to 3 °C in summer only? Rasmus leans towards a seasonal switch. In winter the lobbies are cool, frost guard is doing the opposite job on cold nights, and he wonders whether 3 °C in January is just spending power for nothing. I lean towards one number all year, because one number is easier for Maija to put in front of growers and for anyone reading a log. Oskar said Kestrel has customers who do it both ways and didn't take a side. We left it open. It doesn't need an answer until the weather turns properly, and by then we'll have a few weeks of logs at 3 °C to look at.

Half-idea for the parking lot: if we ever do a seasonal switch, could it follow the actual lobby temperature from the spine instead of a calendar date? Rasmus thinks this is easy in principle and annoying in practice. Parked.

## Member FAQ

While we were talking about the Garage being a food premises and what we hand out to people, Maija pasted the member FAQ into the chat. Her words: "this is what every new member gets from us, for reference." I've copied it here as she sent it.

---

> Larder member FAQ
>
> How does Larder work? Every week a grower near Lakeport packs your box, and on drop day we put it into your compartment in the pod in your lobby. You open the compartment with the wake code we send you by text message.
>
> How long can my box wait? You have 24 hours from the drop to collect it.
>
> What if I cannot collect it in time? An uncollected box is left with your building's caretaker, who keeps it for you.
>
> How do I pay? With a card on file in Picker. We charge it on the drop day.
>
> What does a box cost? A standard box is 24 €.
>
> What is the shelf on top of the Alder Court pod? Our honesty shelf: take surplus vegetables and pay by phone.
>
> Who can I talk to? Your building champion, or Larder by email.

---

We didn't go into it today. It's in the notes so it's somewhere we can find it.

## Bits and pieces

- Oskar had the shroud off the Ferry Close pod last week for an unrelated check on the spine. He said the ochre panel gets properly warm in direct sun but sits clear of the cells and shouldn't be adding much. Rasmus wants to compare that pod's log on a sunny afternoon against a cloudy one before he believes it.
- Rasmus would like the Pulse to show the setpoint next to each cell's live temperature, so a glance tells you whether a cell is above target or just looks warm. Small job, his list.
- Pack sheet thought from me, not discussed properly: the Harvest boxes are the heaviest crates going into the chill cells. If any cell is going to have airflow trouble, it'll be one of those. Worth a look on the next pack line evening.
- Rasmus is moving flats in October and warned us he'll be slow on messages for about a week. He doesn't know which week yet; the landlord keeps shifting the key handover. We told him to take the week and not answer anything from a box of cables on the floor. Oskar offered the name of a man with a van, which made Rasmus laugh, given how we spend our Tuesdays and Fridays.
- Oskar left a little before twelve. Rasmus and I stayed another twenty minutes going over the August log for Kiln Lane and Ropewalk 3. Both looked fine, which fits: neither lobby gets much sun.

## Open questions (still open)

- Should the chill cells go to 3 °C in summer only? (new today)
- Should members be able to pay by card at the pod itself?
- Is a 16-compartment pod too big for the smaller buildings?
- A third wave of buildings this year?
- Will the cut to 26 € bring churn back down?
- Should the swap market become a product of its own?

## Actions

- **Oskar (Kestrel):** have Kestrel push the 3 °C chill cell setpoint to the spine of every pod, and set the Linden Yard pod to 3 °C before it goes in.
- **Rasmus:** watch the Pulse as each pod changes over; flag any chill cell that doesn't settle at the new target within a day.
- **Rasmus:** add the setpoint next to the live temperature for each cell on the Pulse.
- **Rasmus:** compare the Ferry Close cold chain log on a sunny afternoon against a cloudy one, to settle the shroud question.
- **Rasmus:** tell us the moving week as soon as the landlord confirms it.
- **Ilona:** check how the Harvest crates sit in the chill cells at the next drop, and whether any crate is pushed against the back wall.
- **Ilona:** keep a printout of the August cold chain log with the Garage food premises papers.
- **Ilona:** gather a few weeks of logs at 3 °C before we come back to the summer-only question.
- **Maija:** let the growers know through the grower desk that the chill cells now run colder, and pass on Oskar's point about leaving a gap behind the crate. A note in Field is fine.
