# Product how-to

Teach the viewer to complete the requested task. State what they'll learn, show necessary actions in their real order and explain what they'll receive at the end.

## Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list with `list_dir`, `read_file` and `git_activity`. Use `active_project` when supplied; otherwise identify the intended project from the brand profile and ask if ambiguous. Older project records may expose only `path`.

Read the relevant README, docs, screens and behavior for this content's purpose. Use the app's own names and establish what users can actually do and receive. History distinguishes established capabilities from recent changes. Notes and feedback help explain the user's need; keep private and internal material out of public copy.

## Plan the content

Inspect the task in the running product and trace conditions or dependencies in the code where available. Identify prerequisites such as an existing project, account state or supported device. Show or state a prerequisite when omitting it would prevent someone repeating the lesson.

Use direct instructions in the app's own words: where to go, what to select or enter and how to recognize success. Give meaningful steps enough time to follow. Keep routine preparation in shot notes when it doesn't affect the lesson; include optional actions only when they help with the requested task.

Use real product recordings for the steps. Text, diagrams or animation can clarify them. Phone-only behavior belongs on the phone or Simulator. Don't substitute a browser flow that lacks the action being taught.

End by showing the result and explaining relevant limits: for example, whether sharing sends a copy or creates a live shared item. Stay on this task rather than introducing unrelated product capabilities.

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
