---
name: product-introduction
description: Introduce the founder's whole product in a launch or introduction video, from its code and the running app - first a script the founder approves, then the recorded and edited video. For one feature or a moment from recent work, use create-content or work-content-ideas instead.
---

# Product introduction

The founder asks for a video that introduces their product as a whole: a launch video, an introduction, "what is X" for people who have never seen it. Often nothing has been posted about it yet, and all there is to go on is the code. This is not about the latest change: a new viewer needs to learn what the product is, who it is for and what it does.

It takes two steps, because a script is fast and cheap to change and a video is not:

1. **The script.** Understand the product, then reply with a script the founder can review at a glance. Don't record, edit or generate anything yet.
2. **The video.** When the founder approves or adjusts it, apply their changes and produce the video.

## 1. Understand the product

Read the project in the founder's Brand Profile projects (`list_dir`, `read_file`, `git_activity`):

- **README and docs:** what the product says it is, who it's for, how it runs and where (its local address).
- **The app's screens:** the pages, routes and main components show what a user can actually do. Name the flows in the app's own words.
- **The history:** the commit history shows what the product is made of over time, not only what changed last. A long-built core flow matters more than a recent tweak.
- **Notes:** user feedback, beta notes or plans can confirm what matters to users. They are background for choosing flows, not material for the video.

From these, work out:

- **What it is**, in one plain line a stranger would understand.
- **Who it's for**, when the README or docs say; otherwise leave it out rather than guess.
- **The core flows:** the 3–4 things a new user does, in the order they meet them, ending on the payoff, the moment the product does its job.

Then open the running app in the browser (the README's address) and look at those screens, without recording, so the script matches what is really there. If it isn't running, say which command starts it (from the README or scripts) and ask the founder to start it.

**A mobile app is introduced on the phone,** where people use it. Check whether it runs in the iOS Simulator: `list_capture_targets` lists a booted Simulator, and the project's scripts or README say how it runs on iOS; if it does, look at it there too. Its web version (React Native, Flutter and others often have one) works for flows that look the same on web; anything only the phone does, such as the share sheet, the camera or notifications, is shown on the phone, never left out because the web version lacks it. Say in the script where each shot is recorded.

## 2. The script for the founder

One message, short enough to review without scrolling back and forth:

- **What it is** and **who it's for**, one line each.
- **Format:** length, shape (16:9 for X, LinkedIn, YouTube; 9:16 for Reels, TikTok, Shorts), voiceover and captions. Follow the founder's request; otherwise around 30–45 seconds for the platform.
- **Shots**, numbered, one per beat. For each: what's on screen (which screen and what happens), its on-screen text if it has any, and the voiceover line for it. On-screen text is a line the video adds over the shot, not text already in the app. The opening shot always has one, short and naming the product, because many people watch with the sound off. The voiceover read in order is the whole script, about 2.5 words per second of video.
- **Assumptions:** what you chose and left out and why, in a line or two, so the founder can correct it quickly.

End by asking the founder to approve it or say what to change.

**The story is a straightforward product demo:** name the product and say in one line what it does, then show the core flows working, each with a plain line on what the viewer sees, and close on the product's name. Say it the way a product page introduces a product ("Introducing [product]…" fits a launch). The product is the subject, not how it came about: no user research, feedback numbers, complaints or backstory; those belong in posts about one feature or moment. No slogans, abstract concepts or features it doesn't have, and no tour of every button: three or four flows done well.

## 3. The video

When the founder replies:

- **Apply every change** they asked for. If they rewrite the story, show the new script and wait for approval again; otherwise go ahead.
- **Capture:** read the `product-demo-capture` skill with `read_skill` and follow it, with the approved shots as its demo plan: one clip per flow, each starting from a clean, ready screen.
- **Edit:** activate the video plugin, read its `video-product-demo` skill and build the video from the clips, with the approved voiceover as `voiceover_script`, each scene starting on its line and showing its on-screen text. The founder's requested length and format win over that skill's defaults.
- **Check and deliver** as those skills say. In the final message, say in a line what changed from the approved script, if anything had to.
