---
name: product-content-plan
description: Choose the type of product content and write its plan and script, using the matching reference for an introduction, demo, how-to, feature release or what's new. Get the founder's approval before capture or production.
---

# Product content plan

Write the plan and script the founder approves before anything is recorded, generated or edited. First decide what the viewer needs from this piece; the content type determines the investigation, story and visuals.

## 1. Choose the content type

Infer the type from the request and context. State it at the top of the plan and script; ask only when the distinction is unclear and would change the result. A launch can introduce a whole product or announce one feature: use the subject and purpose to decide.

Read the matching reference with `read_skill`, using `name: "product-content-plan"` and the reference's `file` path. Read only what this request needs:

| Type | Viewer needs | Reference |
| --- | --- | --- |
| Product introduction | What it is, who it's for and why they'd care | [references/product-introduction.md](references/product-introduction.md) |
| Product demo | See the product do a useful job and understand how it works | [references/product-demo.md](references/product-demo.md) |
| Product how-to | Learn to complete a particular task | [references/product-how-to.md](references/product-how-to.md) |
| Product feature release | Understand a specific new capability and why it matters | [references/product-feature-release.md](references/product-feature-release.md) |
| What's new | Understand useful changes from a particular period | [references/whats-new.md](references/whats-new.md) |

For an introduction with a demo beat, read the introduction and demo references. Keep the introduction's story and use the demonstration to support its promise.

## 2. Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list (`list_dir`, `read_file`, `git_activity`). Use `active_project` when supplied; otherwise identify the project from the brand profile and ask if ambiguous. Older records may expose only `path`.

- **README and docs:** what the product is, who it's for and what it promises.
- **Screens and behavior:** what users can actually do and receive, named in the app's own words.
- **History:** established capabilities versus recent changes; releases and round-ups depend on this distinction.
- **Notes and feedback:** background for understanding the user's need. Keep private and internal material out of public copy.

Understand enough to choose what matters for this type of content. An introduction needs the overall purpose; a how-to needs the requested task in detail. Don't treat the newest commit as the whole product or investigate every setting for a narrow lesson.

**When using product screens, inspect those screens before scripting them.** Open the running app without recording. If access or data is missing, identify what needs the founder's help and keep it unverified in the plan. Don't invent controls, statuses or results. Inspect phone-only behavior, such as a native share sheet, on the phone or Simulator.

For a demonstration or lesson, trace the relevant actions through their handlers, conditions, state changes and results. Check that each action is reachable from the previous state and establish what the user receives. Keep preparation and routine navigation in recording notes when they don't need narration.

An introduction can use typography, illustration, footage or animation without product screens. Verify its claims from the available sources; a running app isn't required for content that doesn't show or demonstrate its UI.

## 3. Write the script and shot plan

Describe what the viewer will see alongside each narration line. This is a written shot plan; recording, generating assets and editing happen after approval.

Follow the selected reference. Write as the product's owner speaking to the intended audience. Follow `voice.md` from your instructions and use recent posts (`list_my_posts`) when needed to understand how the founder speaks.

- Give the viewer a reason to keep watching. The content type determines whether the opening is a problem, promise, result or task being taught.
- Give each beat one purpose. Choose visuals that support it: product screens, type, illustrations, footage or animation. Product screens are optional for an introduction.
- Align narration and visuals. Conceptual visuals can express the user's situation or benefit; product screens must support the specific behavior or result described over them.
- Ground claims in sources. Don't invent features, speed claims, users, results, pricing or availability. Explain benefits concretely and leave unsupported claims out.
- Read the voiceover continuously. Shot boundaries aren't a reason to write disconnected slogans.

Check transitions and results for action sequences, then read the complete voiceover as a first-time viewer. Estimate speech at about 2.5 words per second, count the actual words and allow time to read important visuals. Keep meaningful uncertainty visible to the founder.

## 4. Deliver the plan and script

Keep the review concise:

- **Content type**, plus **what the product is** and **who this piece is for**.
- **Format:** duration, aspect ratio, voiceover and captions. Follow the request; otherwise explain your choices.
- **Story:** the point of this piece and what the viewer should understand or be able to do by the end.
- **Numbered shots:** timing, visual mode, what the viewer sees, added on-screen text and voiceover. Use **live clip** for a recorded product action, **product shot** for a prepared real screen without operator actions, **type card** for typography, or specify **illustration**, **footage** or **animation**. Identify supplied assets or assets to create. For product footage, name the screen, observed state, useful crop and preparation needed; keep unverified staging requirements explicit.
- **Assumptions:** choices, omissions and anything the founder must confirm or supply.

On a content task, save `plan.md` and `script.md` with `save_content_file`, then reply with the script. Ask the founder to approve or say what to change, and stop. No recording, asset generation or editing before approval.

## 5. After approval

Apply requested changes. If the story changes, show the revised script and wait for approval again. On a content task, save the updated `script.md` and record explicit approval with `approve_content_script`, quoting the founder.

Use `product-content-capture` for real screens and recordings the approved plan needs. Type and other assets need no screen capture. Activate the video plugin and read `video-create` and `product-content-edit` to produce the video; use `media-create` when assets need to be generated. Preserve the approved story, visuals, voiceover, duration and format. Report any necessary changes from the approved script.
