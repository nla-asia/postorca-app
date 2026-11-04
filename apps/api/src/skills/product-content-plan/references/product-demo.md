# Product demo

Explain how the product works by showing it in use. Help the viewer understand its main parts, what they can do and what happens next. Benefits come through the explanation and demonstration.

## Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list with `list_dir`, `read_file` and `git_activity`. Use `active_project` when supplied; otherwise identify the intended project from the brand profile and ask if ambiguous. Older project records may expose only `path`.

Read the relevant README, docs, screens and behavior for this content's purpose. Use the app's own names and establish what users can actually do and receive. History distinguishes established capabilities from recent changes. Notes and feedback help explain the user's need; keep private and internal material out of public copy.

## Plan the content

Choose the scope from the request. A product demo can be a walkthrough of the main parts of the product, covering several connected features, or a focused demonstration of one feature or task. When the request is broad, choose the main parts that help a new viewer understand the product. Follow a requested duration; otherwise choose enough time to explain and show the selected scope. Do not default to a 30-second clip.

### Required components

Include these components in the plan and script. They give the demo a structure without forcing every video into the same script. Components can share a shot; repeat the demonstration and transitions as the selected scope needs.

1. **Opening:** Welcome the viewer and say what you will show.
2. **Starting point:** Explain where the viewer is in the product and any setup they need to understand.
3. **Demonstration:** Show what each selected part does, the actions you take and what happens next. Repeat for each selected feature or flow, in an order that makes sense.
4. **Transitions:** Connect the sections so the viewer can follow. A short demo can use a brief phrase to move from the starting point into the action.
5. **Close:** Briefly recap what you showed and how the viewer can use it, with a next step when useful.

Routine navigation, sign-in and preparation can happen off camera or across a clear cut. Keep any setup the viewer needs to understand the flow.

### Demonstration details

Trace the flow in the code where available. Code and docs can support the plan; inspect the running product when needed to resolve uncertainty about behavior or layout. Establish the starting state, required inputs, state changes and actual output. Distinguish actions the product performs from statuses the user sets; don't imply an email was sent, a payment collected or work completed just because a label changed.

Plan live clips for actions that establish the demonstration and hold the result long enough to read. Use close-ups with enough context to follow the flow. Type, diagrams or other visuals can explain context, but the demonstration itself shows real product behavior.

Give important actions and results enough time to be understood. A short demo may cover one journey; a longer walkthrough may show several parts and how they connect.

### Baseline example

These examples show an acceptable starting point. Adapt them to the real product and feel free to write better ones; they are not a fixed script or required sequence.

- **Opening:** “Hi, welcome to FileNest. Let me show you how it works.”
- **Starting point:** “This is your workspace. You can see your recent files here, and your folders are on the left.”
- **Demonstration:** “Let's upload a proposal. Once it's here, I can open it and read it without leaving FileNest.”
- **Transitions:** “Now that the file is in our workspace, let me show you how to share it.”
- **Close:** “That's a quick look at FileNest: bringing in your files, finding what you need and sharing them with your team.”

## Write and check the script

Write in plain language as the product's owner explaining it directly to the viewer. Use natural phrases such as “This is your dashboard,” “Let me show you” and “Once you save it, you'll see it here” when they fit. Explain what matters on each screen and what happens as you use it. Follow `voice.md` from your instructions and use recent posts (`list_my_posts`) when needed to understand how the founder speaks. Keep features, results, speed claims, prices and availability grounded in supplied or verified sources. Keep narration aligned with the visuals and read it continuously to catch disconnected lines or repetition.

Count the actual spoken words and estimate speech at about 2.5 words per second. Check each shot's timing, including time to read important visuals and hold a result. Raise unresolved questions with the founder in chat.

## Deliver the plan and script

This stage produces a written plan and script. Recording, asset generation and editing wait for the founder's approval.

Include:

- **Content type**, what the product is and who this piece is for.
- **Format:** duration, aspect ratio, voiceover and captions. Follow the request; otherwise explain your choices.
- **Story:** what the viewer should understand or be able to do by the end, with choices and omissions explained.
- **Numbered shots:** timing, what the viewer sees, added on-screen text and the voiceover. Specify the visual mode: **live clip** for a recorded product action, **product shot** for a prepared real screen, **type card**, **illustration**, **footage** or **animation**. Identify supplied assets or assets to create. For product screens, name the state supported by your project research, useful crop and preparation needed. Capture real product behavior during production and check the recordings before use.
- **Assumptions:** creative choices for the founder to review. Access requests belong in chat.

Report access problems and requests for help in a separate chat message. Keep them out of `plan.md` and `script.md`. If missing access prevents verifying a planned screen, ask for the needed access or choose a supported alternative before finalizing the plan.

On a content task, save `plan.md` and `script.md` with `save_content_file`, then reply with the script. Ask the founder to approve or say what to change, and stop. No recording, asset generation or editing before approval.

## After approval

Apply requested changes. If the story changes, show the revised script and wait for approval again. On a content task, save the updated `script.md` and record explicit approval with `approve_content_script`, quoting the founder.

Use `product-content-capture` for real screens and recordings the approved plan needs. Type and other assets need no screen capture. For a video, activate the video plugin and read `video-create` and `product-content-edit`; use `media-create` when assets need to be generated. Preserve the approved story, visuals, voiceover, duration and format, and report any necessary changes.
