# What's new

Explain useful changes users received during the requested period. Establish that period from the brief; ask if it is missing and the context doesn't settle it.

## Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list with `list_dir`, `read_file` and `git_activity`. Use `active_project` when supplied; otherwise identify the intended project from the brand profile and ask if ambiguous. Older project records may expose only `path`.

Read the relevant README, docs, screens and behavior for this content's purpose. Use the app's own names and establish what users can actually do and receive. History distinguishes established capabilities from recent changes. Notes and feedback help explain the user's need; keep private and internal material out of public copy.

## Plan the content

Use relevant history and release notes to distinguish new behavior from established features, internal chores and unreleased plans. Inspect behavior or screens the piece will show. Don't present an older core feature as new because it is more impressive than recent work.

Choose changes that matter to the audience. Group related changes and give each a clear beat: what changed and what the user can now do or understand more easily. Order them for the viewer rather than copying commit order. Skip implementation details unless they explain a meaningful user benefit.

Use product footage when it helps show the difference; type, illustration or animation can support the explanation. Follow [product-demo.md](product-demo.md) for live demonstrations. Give changes room to be understood instead of reading a changelog at speed. Close with the combined benefit and confirmed availability or next step.

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
