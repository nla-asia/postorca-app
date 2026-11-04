# Product introduction

Help a new viewer understand what the product is, who it's for and why they'd want it. Choose a clear promise and the capabilities that explain it. A first introduction isn't a tour of every feature or a lesson in operating the app.

The examples in this guide are acceptable baselines. Use your judgment to write better versions for the actual product, audience and founder's voice. Keep the language simple and natural. Explain each idea clearly, using more than one sentence when helpful.

## Understand the product

Use the brief, brand profile and supplied material. When code is available, read the selected project and relevant source folders in its `folders` list with `list_dir`, `read_file` and `git_activity`. Use `active_project` when supplied; otherwise identify the intended project from the brand profile and ask if ambiguous. Older project records may expose only `path`.

Read the relevant README, docs, screens and behavior for this content's purpose. Use the app's own names and establish what users can actually do and receive. History distinguishes established capabilities from recent changes. Notes and feedback help explain the user's need; keep private and internal material out of public copy.

## Story

For a short introduction, a useful shape is:

1. Open with a natural video starter that speaks to the intended customer. It often leads into their problem; a straightforward introduction can name the product immediately. Choose an approach from the examples below.
2. Name the product and explain it in a plain sentence: its category and main promise. Make the audience clear here or in the opening.
3. Develop the promise through two or three capabilities, described as what the viewer gets. Order them so the story builds rather than sounding like a feature list.
4. Choose a close that fits the story: reinforce the benefit, recap the product or invite a next step. Use a URL or availability detail only when confirmed.

Adapt to the requested length. A longer introduction can give the problem and benefits more room; it doesn't automatically need more features or section cards. A live proof beat is optional. The viewer should still understand the benefit without a demonstration or numerical proof.

## Example product

The examples below use **FileNest**, a fictional app that finds files from descriptions of their contents. Write the actual product's name and supported capabilities when creating a script.

## Opening / hook examples

Use simple, plain language and speak directly to the customer or user. Give them a natural way into the video so the opening feels like the start of a conversation. Choose a starter that fits the product, audience and founder's voice.

| Starter type | Example |
| --- | --- |
| Question | “Do you have trouble finding your files?” |
| Audience call-out | “If you're always searching for files, this is for you.” |
| Familiar situation | “Sometimes you remember what's in a file, but not where you saved it.” |
| Topic opener | “Let's talk about finding your files without opening every folder.” |
| Straightforward introduction | “Today, I'd like to introduce you to FileNest, a simple way to find your files.” |

These examples show an acceptable starting point. Adapt the wording to the customer's actual problem and the product's supported benefits. Choose one starter for the opening and let it lead naturally into the next line. If the starter already explains what the product is, build on that explanation in the next beat.

## Product definition examples

Say what the product is and what it helps the user do, in plain language. Let this line follow naturally from the starter.

These are three alternative ways to introduce FileNest. Choose one approach that fits the actual product:

- “This is FileNest, an app that helps you find your files.”
- “FileNest lets you find files by describing what's in them.”
- “With FileNest, you can find a file even if you've forgotten its name.”

If the starter already explains the product, use the next line to add something useful instead of repeating the definition.

## Capabilities and benefits examples

Explain what the user can do and why it helps. Give the explanation enough room to be clear; it can take more than one sentence.

The first two examples are alternative ways to describe FileNest's search. The third explains opening a file from the results:

- “Describe what you remember, and FileNest looks for the file.”
- “You can search what's inside your files, even if you've forgotten their names.”
- “Once you find the file you need, just click it in FileNest to open it. You can start working on it right away, without going through your folders to find it again.”

Choose capabilities that matter to the actual audience and explain their benefits in the user's terms.

## Closing examples

Choose a close that fits the audience and purpose. It can reinforce the benefit, recap the product or invite a next step. Use an invitation when that next step is actually available.

| Closing type | Example |
| --- | --- |
| Benefit | “With FileNest, you can spend less time looking for files and get back to your work.” |
| Recap | “That's FileNest. Describe the file you need, and it helps you find it.” |
| Invitation | “If this would help with your work, give FileNest a try.” |

## Visuals

Typography, illustrations, footage and animation can carry the introduction, with or without product screens. The opening doesn't need a product screen or logo card. Choose visuals that explain the situation or promise instead of leaving the words to do all the work.

When planning product shots, use screens supported by the implemented code or product docs. Inspect the running app when needed to resolve uncertainty about a screen or behavior. Capture real screens for production and check those captures before use. Choose a state that shows the capability clearly, plan a crop so the relevant detail reads, and note any preparation needed. Prepared screens can arrive ready without clicks or navigation on camera. Don't invent a UI state or result to illustrate a claim. Conceptual visuals may explain the situation or promise without pretending to be the product interface.

Use live product action when a short demonstration helps prove the promise; read [product-demo.md](product-demo.md) for that beat. Keep it focused so the introduction retains its purpose.

## Writing

The spoken script itself must explain what the product is; putting that only in the plan isn't enough. Read the narration continuously in the founder's voice. Benefits should form a connected explanation rather than a succession of slogans or feature labels. Keep the close grounded in what the product helps someone do.

Write in plain language as the product's owner speaking to the intended audience. Follow `voice.md` from your instructions and use recent posts (`list_my_posts`) when needed to understand how the founder speaks. Keep features, results, speed claims, prices and availability grounded in supplied or verified sources. Keep narration aligned with the visuals and read it continuously to catch disconnected lines or repetition.

Count the actual spoken words and estimate speech at about 2.5 words per second. Check each shot's timing, including time to read important visuals and hold a result. Raise unresolved questions with the founder in chat.

## Deliver the plan and script

This stage produces a written plan and script. Recording, asset generation and editing wait for the founder's approval.

Include:

- **Content type**, what the product is and who this piece is for.
- **Format:** duration, aspect ratio, voiceover and captions. Follow the request; otherwise explain your choices.
- **Story:** what the viewer should understand or be able to do by the end, with choices and omissions explained.
- **Numbered shots:** timing, what the viewer sees, added on-screen text and the voiceover. Specify the visual mode: **live clip** for a recorded product action, **product shot** for a prepared real screen, **type card**, **illustration**, **footage** or **animation**. Identify supplied assets or assets to create. For product screens, name the state supported by your project research, useful crop and preparation needed.
- **Assumptions:** creative choices for the founder to review. Access requests belong in chat.

Report access problems and requests for help in a separate chat message. Keep them out of `plan.md` and `script.md`. If missing access prevents verifying a planned screen, ask for the needed access or choose a supported alternative before finalizing the plan.

On a content task, save `plan.md` and `script.md` with `save_content_file`, then reply with the script. Ask the founder to approve or say what to change, and stop. No recording, asset generation or editing before approval.

## After approval

Apply requested changes. If the story changes, show the revised script and wait for approval again. On a content task, save the updated `script.md` and record explicit approval with `approve_content_script`, quoting the founder.

Use `product-content-capture` for real screens and recordings the approved plan needs. Type and other assets need no screen capture. For a video, activate the video plugin and read `video-create` and `product-content-edit`; use `media-create` when assets need to be generated. Preserve the approved story, visuals, voiceover, duration and format, and report any necessary changes.
