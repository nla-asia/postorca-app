# Product demo

Show the product doing a useful job. Choose a real user need, the actions that address it and the visible result. The viewer should understand what happened and why it helps.

## Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list with `list_dir`, `read_file` and `git_activity`. Use `active_project` when supplied; otherwise identify the intended project from the brand profile and ask if ambiguous. Older project records may expose only `path`.

Read the relevant README, docs, screens and behavior for this content's purpose. Use the app's own names and establish what users can actually do and receive. History distinguishes established capabilities from recent changes. Notes and feedback help explain the user's need; keep private and internal material out of public copy.

## Plan the content

Open on the need or a preview of the result, then show meaningful actions in an order the app supports. Explain what the user does or gets instead of narrating every click. Routine navigation, sign-in and preparation can happen off camera or across a clear cut. Preserve dependencies the viewer needs to understand the result.

Trace the flow in the code where available and inspect it in the running product. Establish the starting state, required inputs, state changes and actual output. Distinguish actions the product performs from statuses the user sets; don't imply an email was sent, a payment collected or work completed just because a label changed.

Plan live clips for actions that establish the demonstration and hold the result long enough to read. Use close-ups with enough context to follow the flow. Type, diagrams or other visuals can explain context, but the demonstration itself shows real product behavior.

Prefer one focused journey for a short demo. If multiple journeys are requested and fit the duration, introduce each clearly. End on the useful result, with the product name and next step when appropriate.

## Write and check the script

Write in plain language as the product's owner speaking to the intended audience. Follow `voice.md` from your instructions and use recent posts (`list_my_posts`) when needed to understand how the founder speaks. Keep features, results, speed claims, prices and availability grounded in supplied or verified sources. Keep narration aligned with the visuals and read it continuously to catch disconnected lines or repetition.

Count the actual spoken words and estimate speech at about 2.5 words per second. Check each shot's timing, including time to read important visuals and hold a result. Keep meaningful uncertainty visible to the founder.

## Deliver the plan and script

This stage produces a written plan and script. Recording, asset generation and editing wait for the founder's approval.

Include:

- **Content type**, what the product is and who this piece is for.
- **Format:** duration, aspect ratio, voiceover and captions. Follow the request; otherwise explain your choices.
- **Story:** what the viewer should understand or be able to do by the end, with choices and omissions explained.
- **Numbered shots:** timing, what the viewer sees, added on-screen text and the voiceover. Specify the visual mode: **live clip** for a recorded product action, **product shot** for a prepared real screen, **type card**, **illustration**, **footage** or **animation**. Identify supplied assets or assets to create. For product screens, name the observed state, useful crop and preparation needed; keep anything unverified explicit.
- **Assumptions:** anything the founder must confirm or supply.

On a content task, save `plan.md` and `script.md` with `save_content_file`, then reply with the script. Ask the founder to approve or say what to change, and stop. No recording, asset generation or editing before approval.

## After approval

Apply requested changes. If the story changes, show the revised script and wait for approval again. On a content task, save the updated `script.md` and record explicit approval with `approve_content_script`, quoting the founder.

Use `product-content-capture` for real screens and recordings the approved plan needs. Type and other assets need no screen capture. For a video, activate the video plugin and read `video-create` and `product-content-edit`; use `media-create` when assets need to be generated. Preserve the approved story, visuals, voiceover, duration and format, and report any necessary changes.
