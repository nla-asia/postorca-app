# Product feature release

Announce one new capability: what changed, who benefits and why it matters. Give enough context about the existing product to make the change understandable.

## Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list with `list_dir`, `read_file` and `git_activity`. Use `active_project` when supplied; otherwise identify the intended project from the brand profile and ask if ambiguous. Older project records may expose only `path`.

Read the relevant README, docs, screens and behavior for this content's purpose. Use the app's own names and establish what users can actually do and receive. History distinguishes established capabilities from recent changes. Notes and feedback help explain the user's need; keep private and internal material out of public copy.

## Plan the content

Identify the release from the brief and confirm its behavior in relevant source and history. When the request only says "what I just shipped," use recent commits and release notes to find the user-facing change. Don't promote a dependency update, internal fix or older capability as a new feature. Keep release scope or availability unverified when the sources don't establish it.

Open with the specific problem or new ability. Name the feature and product, explain the useful difference and show how a user encounters it when that helps. Close with the outcome and a confirmed next step or availability detail.

Choose visuals for the announcement: type, illustration, footage, animation or inspected product shots. If demonstrating the feature, follow [product-demo.md](product-demo.md) for that beat. Don't require a whole-product walkthrough or invent the founder's personal backstory to create a problem-first opening.

## Write and check the script

Write in plain language as the product's owner speaking to the intended audience. Follow `voice.md` from your instructions and use recent posts (`list_my_posts`) when needed to understand how the founder speaks. Keep features, results, speed claims, prices and availability grounded in supplied or verified sources. Keep narration aligned with the visuals and read it continuously to catch disconnected lines or repetition.

Count the actual spoken words and estimate speech at about 2.5 words per second. Check each shot's timing, including time to read important visuals and hold a result. Raise unresolved questions with the founder in chat.

## Deliver the plan and script

This stage produces a written plan and script. Recording, asset generation and editing wait for the founder's approval.

Include:

- **Content type**, what the product is and who this piece is for.
- **Format:** duration, aspect ratio, voiceover and captions. Follow the request; otherwise explain your choices.
- **Story:** what the viewer should understand or be able to do by the end, with choices and omissions explained.
- **Numbered shots:** timing, what the viewer sees, added on-screen text and the voiceover. Specify the visual mode: **live clip** for a recorded product action, **product shot** for a prepared real screen, **type card**, **illustration**, **footage** or **animation**. Identify supplied assets or assets to create. For product screens, name the verified state, useful crop and preparation needed.
- **Assumptions:** creative choices for the founder to review. Access requests belong in chat.

Report access problems and requests for help in a separate chat message. Keep them out of `plan.md` and `script.md`. If missing access prevents verifying a planned screen, ask for the needed access or choose a supported alternative before finalizing the plan.

On a content task, save `plan.md` and `script.md` with `save_content_file`, then reply with the script. Ask the founder to approve or say what to change, and stop. No recording, asset generation or editing before approval.

## After approval

Apply requested changes. If the story changes, show the revised script and wait for approval again. On a content task, save the updated `script.md` and record explicit approval with `approve_content_script`, quoting the founder.

Use `product-content-capture` for real screens and recordings the approved plan needs. Type and other assets need no screen capture. For a video, activate the video plugin and read `video-create` and `product-content-edit`; use `media-create` when assets need to be generated. Preserve the approved story, visuals, voiceover, duration and format, and report any necessary changes.
