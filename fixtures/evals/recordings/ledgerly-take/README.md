# Ledgerly, one take

One long, imperfect recording of the Ledgerly fixture app (`scripts/evals/ledgerly-fixture.mjs`),
made with `scripts/evals/recordings/record-ledgerly-take.cjs` on 2026-11-01: a
retina-sharp screencast of the app's page (no browser bars) with a drawn pointer, the way
a founder might record a whole flow in one go and leave the mistakes in.

`ledgerly-take.mp4` (46.5 s, 2880 × 1800), with what is on screen when:

- 0–7 s: the dashboard, the pointer wandering (dead air).
- 7.3–12.2 s: a wrong turn: Clients, then the invoice list.
- 12.2 s: New invoice; Juniper Studio chosen.
- 17.3–18.5 s: a typo, "Webiste", backspaced and retyped as "Website redesign"; rate 2400.
- ~21–29 s: "+ Add line", "Copywriting", quantity 4, rate 150; the total reaches $3,000.00.
- ~30–35 s: a long pause on the total.
- 36 s: Save draft, the invoice page, Mark as sent; 38.8 s Sent; Record payment; 42.3 s Paid.

The case checks that the wrong turn and the typo were cut (`cuts` in
`apps/api/src/evals/edit-cases.ts`).

And the track the founder hands over with it:

| File | Track | Source | License |
| --- | --- | --- | --- |
| `music.mp3` | "Motivating Mornings" by Ahjay Stelino, 1:36, upbeat corporate (the same file as `../ledgerly/music.mp3`) | https://mixkit.co/free-stock-music/discover/motivating-mornings/ | Mixkit Stock Music Free License: free for use in videos, no attribution required; not to be redistributed on its own |

For testing only: keep these files in this private repository and out of any public
release or package.
