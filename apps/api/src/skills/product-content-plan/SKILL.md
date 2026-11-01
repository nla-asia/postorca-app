---
name: product-content-plan
description: Plan a piece of product content from the product's code and running app - an introduction to the whole product, a feature launch, a how-to or a what's-new - and write the script the founder approves before anything is recorded or made. Then product-content-capture records it and product-content-edit edits it.
---

# Product content plan

The founder asks for content about their product: a launch video introducing it, an announcement of something just shipped, a how-to for a task users asked about, a round-up of what's new. Often all there is to go on is the code. This skill is the first stage: understand the product, decide what the content shows, and write a script the founder can approve. A script is fast and cheap to change and a recording is not, so nothing is recorded, generated or edited until they approve it.

The stages, each its own skill:

1. **Plan and script** (this skill): `plan.md` and `script.md`, then the founder's approval.
2. **Capture**: read `product-content-capture` with `read_skill` and record the approved shots.
3. **Edit**: activate the video plugin and read its `product-content-edit` skill to build the video from the recordings.

## 1. Understand the product

Read the project in the founder's Brand Profile projects (`list_dir`, `read_file`, `git_activity`):

- **README and docs:** what the product says it is, who it's for, how it runs and where (its local address).
- **The app's screens:** the pages, routes and main components show what a user can actually do. Name things in the app's own words.
- **The history:** the commits show what the product is made of and what changed when. A long-built core flow matters more than a recent tweak, unless the content is about that change.
- **Notes:** user feedback, pilot or beta notes and plans can confirm what matters to users. They are background for choosing what to show, never material for the content.

Then open the running app (the README's address) and look at the screens the content will show, without recording, so the script matches what is really there. If it isn't running, say which command starts it and ask the founder to start it. **A mobile app is shown on the phone,** where people use it: check whether it runs in the iOS Simulator (`list_capture_targets`, the project's scripts or README) and look at it there. Anything only the phone does, such as the share sheet, the camera or notifications, is shown on the phone, never left out because the web version lacks it.

**Understand the whole product before choosing anything.** A real product has many features, screens and settings; the content can't show them all and shouldn't try. Work out what the product is for and the few journeys that deliver it: the paths a user takes from a need to the product doing its job. Then choose what matters for this piece of content and leave the rest out, however much of it there is.

## 2. What the content is

Each kind has its own subject; keep to it:

- **Introduction** (the whole product, often a first post): what it is, who it's for, and the journey that matters most to a new user, step by step in the order they meet it, ending on the payoff. When the product has more than one main journey, give each its own section, introduced so the viewer knows what's next, rather than mixing them; keep to the two or three that matter most. Not the latest change, and not a tour of every feature.
- **Feature launch** (something just shipped): that one change, found in the latest commits, where a user meets it and why it helps them, with only enough of the product around it to place it. Chores and internal fixes aren't features.
- **How-to** (a task users asked about): that one task in the steps a user takes, in order, speaking to the viewer ("tap Share…"). Only the steps the task needs.
- **What's new** (a period's changes): the changes users got in that period, chosen and ordered for the viewer, each shown working with what it does for them. Not a changelog, and nothing older presented as new.

## 3. The script is public

Write it as the product's owner speaking to the people who use it: what they can do and why it helps them, in their words. Internal material (pilot or beta feedback, user counts, notes, plans) and how the product is built (commits, code, technical terms) only guide what to show; none of it is in what viewers see or hear.

What a good script does, for any product:

- **The first shot says what this is:** the product, what's new, or what it teaches, on screen as well as spoken, because many people watch with the sound off.
- **Every shot earns its place:** if the viewer doesn't need it for the point, cut it.
- **One thing per shot, shown working:** each shot shows one screen or action doing its job, with a plain line on what it does for the viewer; never several things listed in one line.
- **Straightforward:** the way a product page would say it. No slogans, abstract concepts or features the product doesn't have.

Before saving, read the script once as a first-time viewer who knows nothing about the product, and fix what they wouldn't follow.

## 4. The script for the founder

One message, short enough to review without scrolling back and forth:

- **What it is** and **who it's for**, one line each.
- **Format:** length, shape (16:9 for X, LinkedIn, YouTube; 9:16 for Reels, TikTok, Shorts), voiceover and captions. Follow the founder's request; otherwise the platform's usual length (around 30–45 seconds for an introduction, shorter for a launch or how-to).
- **Shots**, numbered, one per beat. For each: what's on screen (which screen and what happens, and where it's recorded), its on-screen text if it has any, and the voiceover line. On-screen text is a line the video adds over the shot, not text already in the app. The voiceover read in order is the whole script, about 2.5 words per second of video.
- **Assumptions:** what you chose and left out and why, in a line or two, so the founder can correct it quickly.

On a content task, save the plan (what the content is for, who it's for, the format, what it shows and what you assumed or left out) as `plan.md` and the script as `script.md` with `save_content_file`, then reply with the script. End by asking the founder to approve it or say what to change, and stop.

## 5. When the founder replies

- **Apply every change** they asked for. If they rewrite the story, show the new script and wait for approval again; otherwise go ahead.
- **On a content task,** save the updated `script.md` and record their approval with `approve_content_script`, quoting them. Recording and making anything wait for it.
- **Capture and edit** with the next skills, with the approved shots as the demo plan and the approved voiceover as the script. The founder's requested length and format win over those skills' defaults. In the final message, say in a line what changed from the approved script, if anything had to.
