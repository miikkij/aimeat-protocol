# Larder · session 31 · 11 August 2026 · An Android app after all

Tuesday sit-down in the Garage again, because my flat has no working fan and the Garage at least has the concrete floor. Hot, close morning, the kind where the pack line tables stick to your arms. Ilona brought cold-brew in a jam jar and a bag of Aino's early plums she'd been given on the way, which we ate while the laptop booted. Just the two of us. Maija is off this week, so the grower desk questions waited.

The red list was short for once. Nothing blocking the Thursday dawn run, and Saltworks and Ropewalk 3 have had a quiet week. Most of the morning went on one thing I've been dreading raising, and Ilona got to it before I did.

## Going back on the web-app rule

On 10 February we decided that Picker would be a web app first, with no native app during the pilot. I wrote most of the argument for it myself, so this is a bit of eating my own words. The reasons then were sound. I'm the only one writing code. A native app means app store reviews, two builds, signing keys, and update cycles I don't control. Back then we had no members yet and didn't know if the bet would hold at all. A web app could change on a Tuesday afternoon and be live by the evening, and that mattered more than anything else when we were still guessing.

What's changed is mostly money and the people actually using Picker.

Money first. Every wake code is a text message, and those messages are now a real line in the monthly costs. The QR stub became the main way to open a compartment, and I'd hoped that would push the wake code down to a rare fallback. It hasn't. A lot of members open Picker in the browser, the session has expired, they don't want to log in again in a lobby with a crate in one arm, so they hit "send me a code" instead. Then they get the wake code by SMS, and we pay for it. Some members do it every single week. Ilona pulled the figures from Backroom while I was making the second coffee and laid them next to the house cut. We didn't like the comparison. With the house cut at 14 % and the cargo bike leg already costing more than planned, paying for texts that a push notification would do for free is a silly leak.

Then the members. Ilona has been keeping a rough tally of the messages that come in through Picker and through the lobby hosts. The single most common request this summer, after "can I change my box tier", is some version of "is there an app". Nearly all of them come from Android phones. People want the QR stub on the lock screen, a notification when the drop lands, and the app to remember them. A web app can do some of that, and I've tried. Browser push on Android works, sort of. It falls over when people clear their browser data, which a surprising number of people do every week. Ilona's line was "we're making them do work so we can avoid doing work", which is fair and a little unkind.

I made the case for holding out once more, for the record. We're seven weeks from the end of the extension on 30 September, and a native app is exactly the kind of thing that eats a month. Ilona's answer was that the pilot ending isn't the business ending. If we keep going, we'll want the app anyway, and the SMS bill is real now, not in the autumn. She also pointed out that the February decision assumed most members would use the QR stub from a home-screen shortcut. Almost nobody did that. We were right about what to build and wrong about how people would behave.

**Decision: Picker gets a native Android app.** This replaces the 10 February decision that Picker is a web app first, with no native app during the pilot. Two reasons: wake code text messages cost too much, and Android members have been asking for it. The web app stays. It's still what new members land on and what iPhone users keep using. The native app sits on top of the same Backroom endpoints.

Somewhere in this I started calling it "the Android build", because that's how it sits in my head: a build target, not a separate product. I said it three times in five minutes and Ilona started using it too, a little mockingly at first ("is the Android build going to pack crates as well?"). By the end of the morning it was just what we call it. So: the Android build is the native Android version of Picker. It is not a new app with a new name. It's still Picker.

## Android or iOS first

This was a real question when we sat down, and I'll note it as raised today: Android or iOS first for the native app?

Arguments for iOS: I have an iPhone, so I'd be testing on my own phone every day. Ilona thinks the iPhone share in the Harbour Row and Mill Gate lobbies is higher than elsewhere, though she admits that's a hunch from seeing phones in people's hands on lobby walks.

Arguments for Android: almost all the app requests come from Android users. Browser push on iPhones behaves differently and, from my own testing, the home-screen version of Picker on iOS is fine for the QR stub as long as people add it. Android users are the ones losing their sessions and falling back to wake codes. The SMS cost lives mostly on the Android side. And the Android store process is lighter for a one-person shop, which matters more than I'd like to admit.

We went round twice. Ilona asked whether doing Android only would look like we'd forgotten the iPhone members. My view is that nobody gets anything taken away. iPhone members keep the web app exactly as it is.

**Decision: the native app is Android first; iOS waits.** That settles the question we raised this morning. We didn't set a date for iOS and I don't want one yet. It waits until the Android build is live, the SMS numbers show whether it worked, and we know how the pilot ends.

On the parking lot: one codebase for both platforms. I'd rather not decide the framework in a sweaty garage. Also on the parking lot is Ilona's idea that the app could show the crate deposit balance on the home screen, so people notice they have crates lying around. Not a bad idea, just not for the first version.

## What the first version actually does

I tried to keep this small and mostly managed it. The Android build, first version:

- Sign in once and stay signed in. This is the whole point.
- Show this week's box, the box tier, the pod and the compartment.
- The QR stub, full-screen, with the brightness pushed up. Ilona asked for this after watching a member at Ferry Close squinting at their screen in front of the spine.
- A push notification when the drop scan for their box comes in, instead of the SMS. Members who don't have the app still get the text.
- Skip week and the weather skip notices, same as in the web app.
- The wake code fallback stays, but as a button that shows a code in the app rather than sending a text. If the app can show a code, we don't need to send one. I need to check with the lock controller side that a code generated this way behaves the same as an SMS one. In principle it's the same thing sent through a different pipe.

Things explicitly not in the first version: paying at the pod (that question is still open and I'm not sneaking an answer in through the app), card management beyond what the web app does, add-ons, anything for lobby hosts.

Ilona asked about the season pass, half joking, whether an app would have made it easier to manage. Possibly. But it's gone and everyone is on the drip plan, so the app only needs to show the drip plan. One less screen.

A worry I raised and we left as a worry: the more members open compartments from a native app, the more support requests land on whoever is on the phone that week. "The app won't open my door" is a worse problem than "the website won't open my door", because people expect apps to just work. Ilona thinks the coordinator role can soak some of this up once Maija is comfortable in Backroom. I'm not sure it's fair to hand her that on top of the grower desk. We'll see what the volume looks like.

## The Pulse

The second half of the morning was lighter. We spent it on the pod health page, because I'll be in that part of Backroom anyway, wiring up the push notifications to the drop scan events.

Ilona's complaint about the page is the name, not the content. Nobody says "pod health". Maija calls it "the dashboard", I say "the status page" or, when tired, "the Ledger page" (which it hasn't been since the rename, and Ilona made a face). The lobby hosts who've seen it over Ilona's shoulder call it "the screen with the dots". With more people looking at it, she wants one name that sticks.

She suggested "the Pulse" because what it mostly shows is the heartbeat from each spine. A grey dot means no heartbeat in the last couple of cycles, and you can almost watch it beat if you leave it open during the dawn run. I liked it immediately, mostly because it's short enough to say on the phone: "check the Pulse, is Kiln Lane grey?" It also fits next to Backroom and Field without sounding like a fourth app.

**Decision: the pod health page in Backroom is renamed the Pulse.** Same page, same data: every pod's heartbeat, chill cell temperature against the 4 °C target from the cold chain log, and faults. Sticky doors, failed door pulses, and anything the spine reports.

While we were on it we talked about what the Pulse should show that it doesn't now. None of this is decided, just noted:

- A ghost drop flag. When a drop scan arrives but the photo proof looks empty, or the compartment's door sensor never registered a close. Right now I find ghost drops by reading logs after a member complains. Getting it on the Pulse during the run would save a lot of awkward calls.
- A phone-sized view for whoever is doing the cargo bike leg, so they can glance at the next stop without opening the full Backroom.
- Temperature graphs that actually show the history instead of only the current value. Ilona wants this for the chill cells on hot days like today.

The phone view tempted me, because it overlaps with what I'll learn building the Android build. But I don't want two native apps on my plate, so it goes on the parking lot as "Pulse on a phone, later". The ghost drop flag I'll try to slip in, because it's mostly a query and an icon.

## Odds and ends

- Ilona asked how the wave 1 buildings will take the change, since those members have had the web app since March and have the most settled habits. I think they'll be the slowest to install and the most relieved once they do. We agreed not to push anyone. A member note per building when it's live, nothing louder.
- Last week was 131 boxes picked up against the 160 north number target for the end of the extension. We said the number out loud, looked at each other, and moved on. Not today's topic. PUR is comfortably above the kill criteria line and Ilona said so twice, which I take to mean she's been worrying about it.
- I mentioned I'd half-thought about whether the app could let members photograph a damaged crate for a crate deposit dispute. Ilona said, "Not in this version," before I'd finished the sentence. Parking lot.
- We briefly talked through whether a 16-compartment pod is too big for the smaller buildings, because Ilona had walked past Weaver's Yard and the pod looked huge in that lobby. Still open; we didn't get anywhere and didn't try hard.
- The fan in the Garage is officially dead. Ilona's bringing the one from her bedroom on Wednesday for the pack line.

## Actions

- **Rasmus**: set up the Android build project and the store developer account; first internal build on my old Android test phone before the next sit-down.
- **Rasmus**: check that a wake code shown in the app behaves the same at the spine as one sent by SMS, on pod zero at Alder Court, ideally with Raimo around in case a door sticks.
- **Rasmus**: rename pod health to the Pulse in Backroom, in the menu, the page title and the alert emails. Leave the internal code names alone for now.
- **Rasmus**: prototype the ghost drop flag on the Pulse using drop scans and photo proofs; report back whether it's cheap or not.
- **Ilona**: pull SMS costs per building per box week from Backroom for the last two months, so we have a before figure to compare against once the Android build is live.
- **Ilona**: draft a short member note announcing the Android build, to be sent per building only once it's actually in the store, with no promises about iOS.
- **Ilona**: tell Maija about the rename to the Pulse when she's back, and ask what she'd want on it from the coordinator side.
- **Ilona**: bring the bedroom fan to the Garage before Wednesday's pack line.
- **Both**: add to the parking lot: one codebase for both platforms, crate deposit balance on the app home screen, Pulse on a phone, photo-based crate disputes.
