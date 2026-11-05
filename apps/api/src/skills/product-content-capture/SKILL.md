---
name: product-content-capture
description: Record the screenshots and screen recordings that approved product content needs - from its plan and script to demo-ready shots - capturing what you can yourself and guiding the founder step by step for the rest, then hand them on to the post or the video (product-content-edit).
---

# Product content capture

A demo idea comes with a demo plan: what to show, where it is in the product, and the steps. An introduction may use prepared product shots alongside type, illustration, footage or animation, or use no product screens at all. This skill handles only the real screen assets in the approved plan: clean, demo-ready screenshots, product shots and short clips. Capture what you can yourself; for what you can't, give the founder a short step-by-step guide, because they can click easily but don't have your context. Then hand the shots on to the post or video.

How to work the browser, the computer or the capture tools is in their own skills and tool descriptions. This skill is about what to capture, how it should look, and who captures it.

Capture starts from a plan and a script the founder has approved. If there isn't one yet, read `product-content-plan` with `read_skill` and write them first; record nothing until the founder approves.

## 1. Shot list

From the approved plan, list the shots that need screen capture, in their script order. Type cards, illustrations, footage and animation need no product screen capture; leave those assets to production. If no shots need screen capture, continue to production without opening the product. For each screen shot:

- **Purpose**: the viewer's problem, the payoff, or the setup (see the work-content-ideas skill's demo shape: problem, payoff, how little it takes). The payoff gets the most care.
- **Screen**: where it is and the state it needs (which page, what data on screen).
- **Mode**: follow the shot's visual mode in the approved script (live clip or product shot).
  - **Live clip (demo mode):** record the action that gets to the screen (the click into the payoff, the result appearing), not just the screen, even when the screen itself doesn't move; a demo built from stills looks like a slideshow. Clips are short, one per step (3–15 seconds); several short clips beat one long take.
  - **Product shot:** the screen prepared in a perfect state, then captured clean: a still (`screen_capture`), or a short loop of 3–6 seconds (`screen_record_start` with nothing touched) when the screen has its own motion worth keeping, such as a result streaming in or a live chart. No operator actions on camera: no clicks, typing, scrolling, menus, navigation or loading, and the cursor parked out of the frame. The video adds framing and motion later, so capture the whole window at full size.
  - For a script without visual modes: a demo video is all live clips, a screenshot post all stills.
- **Shape**: capture once, at full size: the video skill cuts the portrait (9:16, for Instagram, TikTok, Shorts) and landscape (16:9 or square, for X, LinkedIn) versions the founder's accounts need from the same shots. A desktop window is captured as it is; a phone screen is already portrait. A wide window's text can't be cropped into readable portrait shots, though: when a portrait video shows a desktop screen for its text (messages, a list, a document), make that text large before recording, by zooming the app in (View > Zoom In, ⌘+ in most apps and browsers) or making its window narrower so the lines wrap. Put it back as it was afterwards.

Keep only the shots the demo needs. Three good shots beat ten.

## 2. Demo-ready

Every shot, whoever captures it:

- **Clean:** notifications off (Do Not Disturb), unrelated windows and tabs closed, nothing personal on screen: no email inbox, messages, other customers' data, API keys, tokens or internal URLs.
- **Real-looking data:** the screen shows the feature doing its job with believable content, not empty states or "test test". Prefer the founder's real work where it is fine to show.
- **Readable:** text large enough to read on a phone; light or dark mode as the founder's brand prefers, the same in every shot.
- **The payoff held:** a clip of the payoff stays on the result for 2–3 seconds before it ends.
- **Product shots, the same rules:** a product shot is a still, so every flaw stays on screen for seconds. Full data (no empty states such as "Nothing here yet"), nothing internal (internal links, deploy or preview URLs, unrelated tasks or chats), nothing loading. If a screen can't be made to look right with real content, ask the founder for it rather than capturing an empty one.

## Before each capture

Use the setup and boundaries agreed in the plan during preparation and rehearsal as well as recording. If preparation reveals a new choice only the founder can make, ask before proceeding with that part.

Set the stage first; the recording only starts once everything is in place:

- **The app is at the starting point:** open, signed in, on the screen the shot starts from, with its data loaded and nothing still loading. No leftover dialogs, menus, toasts or half-typed text.
- **The window is in front and fully visible:** bring it to the front, nothing on top of it, not minimized or off screen, sized to the shot's shape. For the Simulator, the right device is booted and the app is open on the starting screen.
- **The screen is clean:** Do Not Disturb on, unrelated windows and tabs closed or out of the way, the cursor parked where it doesn't cover anything.
- **Signed in before recording:** sign-in happens during preparation, never on camera. If the founder's own app needs a login to reach the screens and you don't have one, ask the founder once for its test account (email and password) and sign in yourself in the tab you will capture from. A web app's login often doesn't carry over between browser tabs, so the founder signing in in their own tab may not help; ask them to sign in themselves only when they'd rather not share it or a second factor is needed, and then ask them to leave that tab open and tell you which one. Only for their own app on a local or test address (localhost, a dev or staging server), never for the live product, a social network, email or any other service. Use it to sign in, then forget it: never save it to memory, write it in an artifact, a guide or a post, or let it appear in a shot.
- **Look at it as the recording will:** right before recording, take a `screen_capture` of the exact window you will record and look at it. A page screenshot (`browser_screenshot`) shows only the page; the window also shows the browser's own pop-ups (save password, permissions, translate), banners and other overlays, and those end up in the clip. If one covers the page, close it if you can; if the page tools can't reach it (browser pop-ups usually), ask the founder to dismiss it, for example "Never" on the save-password prompt for this site so it doesn't come back. The browser's tab bar, address bar and "started debugging" banner are fine: the video skill crops them.
- **Rehearse once:** go through the steps once without recording, so you know each one works and where things appear, then return to the starting point.

For a product shot, the stage is the shot: get the screen to its perfect state, check it with `screen_capture`, then take the still or record the loop without touching anything. For a live clip, start the recording, wait a second, perform the steps at a calm pace (with computer use, the real cursor moving and clicking shows in the clip, which suits a demo), hold on the payoff, and stop right away: a clip runs only as long as its step (3–15 seconds), so stop promptly instead of leaving it running while you think. A screenshot gets the same preparation, taken at the exact moment the shot describes.

## 3. Who captures each shot

**First, find the running app.** Read the project's README and scripts for how it runs and its local address, and open that address in the browser plugin before anything else. If it isn't running, check `desktop_status`, list existing `command` sessions and start the documented command in its project `cwd`. Read logs and verify it opens before recording. Reuse servers from planning; a tool timeout is not evidence a command failed to start, so list sessions before retrying.

**First, look for a web way in.** Many desktop and mobile apps can also run as a web page, and the browser is the path you can drive yourself. Check the project's code (package.json scripts, config, framework): an Electron app's renderer usually has a dev server you can open in the browser (often a localhost port); React Native with Expo or react-native-web, Flutter with web support, Ionic or Capacitor, and Tauri apps often run on the web too. If the screens the demo needs work there, capture them as a website. Be smart about it, not stubborn: parts that need the native shell (file pickers, device features, notifications, native menus) may be missing or broken on the web, and the demo must look like the real product. If the web version differs on the screens that matter, use the native app. Use `command` to start a local dev server from the project's scripts when needed; keep it running in its session during capture and use that session to answer any CLI prompts. Stop sessions you started once the remaining work no longer needs them.

Computer use moves the founder's real mouse and keyboard and brings windows to the front, so use it only for screens with no web way in, keep it to the steps you need, and stop if the founder takes over. One plugin is active at a time: activating the computer plugin turns off the browser, so finish the browser shots first. On a Mac, computer use needs the app's Accessibility and Screen Recording permissions; if a tool says one is missing, put granting it at the top of the guide.

Then pick per shot, in this order:

- **Website or web app** (the landing page, a web product, a local dev server): open it with the browser plugin and navigate there. A still can be `browser_screenshot` with `labels: false` (just the page, without the browser around it). The browser has no recording of its own, so every clip uses the screen recording tools, and the tab you record must be the front tab of its window. Open the page for a clip with `browser_open` and `new_window: true`: it gets a window of its own and the founder's tabs stay as they are (use it only for recording). Sign in and prepare in that tab, find its window with `list_capture_targets` (by the page's title), start `screen_record_start` on that `window` target, perform the steps in the tab, then `screen_record_stop`. A window behind other apps still records; never record a window whose front tab is another page.
- **Desktop app:** get to the screen with the computer plugin (`activate_plugin` code `computer`, then read its `computer-use` skill): `computer_open` the app, then click and type through the steps with `computer_click` and `computer_type`. Capture that app's window with `screen_capture` or `screen_record_start` (a `window` target), not with `computer_observe`: its screenshots are for you to see where to click, not demo material.
- **iOS app:** use `command` for any documented Simulator build/install/start steps and mobile development server, then with the computer plugin open the Simulator, launch the installed app and navigate to the screen. Once it is ready, capture with the `simulator` target of `screen_capture` and `screen_record_start`: that uses the Simulator's own screenshot and recording, which gives the device screen at full resolution without the window around it. Never record the Simulator as a window or the whole screen.
- **The founder:** anything you can't reach or do reliably: the computer plugin isn't available or lacks permission, a sign-in you have no test account for or a two-factor prompt, a real phone, a state that needs their data, or something you tried and couldn't get right. Sometimes the founder only needs to get the screen ready (sign in, open the right project) and you capture the rest; say so in the guide.

The capture tools (`list_capture_targets`, `screen_capture`, `screen_record_start`, `screen_record_stop`) work whichever plugin is active: keep the computer plugin active while recording and don't switch plugins to start or stop a clip, since every switch costs a step and the turn has a step limit. They need the desktop app, and on macOS its Screen Recording permission (except the Simulator target). If a tool says the permission is missing, put granting it in the guide as the first step.

## 4. The guide for the founder

When the founder has to help, ask once, in your final message, for every shot still missing. No stream of questions, and nothing they can work out themselves. Start with one line on what the demo is for, then for each shot:

- **What it's for**, in one line.
- **Steps**, numbered: where to go, what to click or type, what should be on screen, in the app's own words.
- **How to capture**, with the exact keys: on the Mac, ⌘⇧5 for a screen or window recording (Record Selected Portion fits a window), ⌘⇧4 then Space then click a window for a window screenshot; in the Simulator, File → Save Screen (⌘S) for a screenshot and File → Record Screen (⌘R) for a recording. Say how long a clip should run.
- **Where to save it**: in their working folder, `demos/<idea-slug>/<number>-<shot>.<ext>`, for example `demos/repo-to-idea/2-payoff.mov`.

Start each shot's steps with getting it ready (the app open on the starting screen, the window in front, Do Not Disturb on), then the recording steps. Put the demo-ready points they need in the steps where they apply, not as a separate lecture. End by asking them to reply in this task when the files are saved. Keep the whole guide short enough to follow without scrolling back and forth.

## 5. Check what you got

Look at every shot before using it: open screenshots with `read_file` (from the working folder) or view the capture result; for clips, check the duration and look at frames (the video plugin's preview tools can show them). Each must show the right screen and the payoff clearly, be readable, and have nothing private on it. If one is wrong, retake it or ask the founder again for that shot only, saying exactly what to change.

## Deliver

Deliver each shot with create_artifact (kind image or video, content the file's ref) as soon as it is captured and checked, not all at the end: a turn has a limited number of actions, and a shot delivered early is never lost. Title it for its place in the demo ("2 – Payoff: idea in the Inbox"). Then continue to the content when the task asks for it:

- **A demo video:** activate the video plugin, read its product-content-edit skill and build it from these shots.
- **A screenshot post:** the screenshot (or two, before and after) plus the post text written with the create-content skill, built on the demo's angle.

If shots are still missing, deliver what you have and end with the guide. When the founder replies that the files are saved, list the folder, check them, and continue.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
