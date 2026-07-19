# Audio Sample Licenses

All samples in this directory are used under open licenses that permit
redistribution in MIT-licensed software.

## Piano (piano/)

**Salamander Grand Piano** by Alexander Holm
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- https://creativecommons.org/licenses/by/3.0/
- Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html
- CDN: https://tonejs.github.io/audio/salamander/
- Attribution: Piano samples by Alexander Holm, CC BY 3.0

## Guitar (guitar/)

**FluidR3_GM** acoustic_guitar_nylon pre-rendered per-note MP3s
- License: MIT — https://github.com/gleitz/midi-js-soundfonts

## Guitar steel (guitar-steel/), Guitar electric (guitar-el/), Bass (bass/), Flute (flute/)

**MusyngKite soundfont** pre-rendered per-note MP3s (acoustic_guitar_steel,
electric_guitar_clean, electric_bass_finger, flute) — higher-quality renders
than FluidR3 (the soundfont-player default for the same reason)
- License: MIT
- Source: https://github.com/gleitz/midi-js-soundfonts
- CDN: https://gleitz.github.io/midi-js-soundfonts/MusyngKite/
- bass + flute upgraded from FluidR3 → MusyngKite 2026-07-19

## Drums (drums/)

**FluidR3_GM percussion** (GM drum channel) pre-rendered MP3s, renamed from GM
note names to the `SAMPLE_NOTES.drums` ids (kick=C2/36, snare=D2/38, hihat=Gb2/42,
hihat-open=Bb2/46, crash=Db3/49, ride=Eb3/51, tom-low=G2/43, tom-mid=B2/47,
tom-high=D3/50, clap=Eb2/39, cowbell=Ab3/56)
- License: MIT
- Source: https://github.com/dave4mpls/midi-js-soundfonts-with-drums (gleitz
  fork that adds the GM percussion renders missing upstream)

## Strings (strings/), Organ (organ/), E-piano (epiano/), Trumpet (trumpet/)

**MusyngKite soundfont** pre-rendered per-note MP3s (string_ensemble_1,
drawbar_organ, electric_piano_1, trumpet)
- License: MIT — https://github.com/gleitz/midi-js-soundfonts (MusyngKite/)
- Added 2026-07-19 (Band Jam feedback round 2)

Note (2026-07-19, feedback round 2): bass swapped MusyngKite → **FluidR3
electric_bass_finger** (MusyngKite render sustained like a church organ) and
guitar-steel swapped MusyngKite → **FluidR3 acoustic_guitar_steel**.

All note subsets match `SAMPLE_NOTES` in aimeat-audio.js exactly (nearest-sample
pitch shift covers the gaps).
