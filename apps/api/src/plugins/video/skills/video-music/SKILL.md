---
name: video-music
description: "Find free music the founder may use, or use a track they give you, and configure looping, fades and ducking."
---

Read video-create. Use music when requested, when the brief specifies a mood, or when there is no voiceover; otherwise speech and captions suffice. Prefer instrumental under speech.

When the founder gives you a track, use it: an attached file or saved audio ref directly, or a file they name on their computer read with read_file, which returns a ref. Otherwise find one online. Work out the mood first: calm instrumentals for focus or reflection, upbeat tracks for launches, warm slow tracks for personal moments. Activate the browser plugin and search for a free track that fits. Open the track's own page and check its license: it must allow free use in a social media video, including commercial use, with at most a credit line. Skip share-alike (CC BY-SA) and no-derivatives (ND) licenses, which put conditions on the finished video, and note any credit required. Skip tracks with vocals under a voiceover, unclear licenses, sign-up walls or previews only.

browser_fetch_file can only save a file whose own address you have; it cannot press a download button that runs a script or answer a Save dialog. On the track page, look for a link that points at the audio file itself (its address ends in .mp3, .wav, .m4a or similar), or the file address of the page's audio player when it plays the full track, and pass that to browser_fetch_file; it returns a ref. If the only way to download is a button without such an address, or a pop-up blocks the page, move on to another site rather than retrying. Do the whole search in the browser, close the tabs you opened, then activate the video plugin once and use the ref. Do not generate music. If no suitable track can be found or saved, make the video without music and say why.

Report the track's title, source link, license and any credit line with the video, so the founder can add the credit when posting. Metadata alone does not verify the sound: do not claim the mood or the music balance without listening.

Set start_seconds past a quiet intro if needed. Defaults are volume 0.15 with voiceover and duck enabled, or 0.6 for music-only. Speech lowers the track and pauses let it rise. Fades default to 0.5 seconds in and 1 second out; a beat can start without a fade and a slow ending can use 2–3 seconds. The track loops from its chosen start. Pace music-only shots around 2 seconds upbeat or 3 seconds calm while keeping overlays readable. Report why you chose the track.
