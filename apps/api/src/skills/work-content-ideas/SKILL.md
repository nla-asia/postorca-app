---
name: work-content-ideas
description: Find up to three content ideas for one social account in what the founder actually worked on recently - commits, uncommitted work and changed files in their project folders - each a real moment turned into a post they could make, one idea artifact each.
---

# Ideas from the founder's work

The founder would rather build than post. These ideas are about their work, not one platform. Your job is to follow along: look at what they worked on since the last run, find the moments worth telling, and turn each into an idea they can post. These ideas carry real details from their work, so the posts made from them don't have to ask the founder for a story.

## What counts as a moment

A moment is something that happened, with a when and a what, that people outside the project would care about:

- **A problem and how it was solved**, especially one with a surprising cause ("half an emoji crashed the whole run").
- **A number:** before and after, how long something took, how many tries, how big a change was.
- **A decision with a trade-off:** what was chosen, what was given up, why.
- **Something shipped:** a feature that now works, shown from the user's side.
- **A mistake or a surprise:** what didn't go as planned and what it taught.
- **A lesson about the tools:** working with AI agents, a framework, an API, if the work shows it.

**Rank them by whether a stranger would stop scrolling.** From strongest to weakest:

1. **Something went wrong in a surprising way**, especially an AI agent or a tool behaving unexpectedly, with a specific cause ("one message had no timestamp, so a task grew to 150% of its memory limit").
2. **A number that tells a story**: a before and after, a count of tries, how long something took.
3. **A decision with a real trade-off**, where reasonable people would choose differently.
4. **Something shipped**, only when it rides a topic people are talking about right now. "I added X" is a changelog, not a post: a feature without a surprise, a number or a trade-off behind it is not a moment. Something people can see is different: a demo can plainly say what was added (see Product demos).

Always look at fixes and failures first: commits that fix, revert or work around something, and docs or reports that record what went wrong and what was tried. They usually hold the best story, even when the commit message makes them sound dull.

Not moments: routine refactors, dependency bumps, formatting, typo fixes, renames, and work too small to explain. A quiet day may have nothing worth posting; then deliver no ideas and say so. Never stretch a dull change into a story.

Read the commit messages and the changes themselves; a commit message alone often hides the interesting part. Docs and notes changed in the same work (plans, checklists, reports) often say why something was done and what the numbers were.

## From a moment to a post

The work is the spark, not the subject. A post that retells the change ("I fixed X by doing Y") reads as robotic and boring. Ask what the moment shows that is true beyond this project, and build the post on that.

- **Pick one register, never the middle.** Either go **fully technical**, when the concept is clear, interesting and precise enough for engineers to learn something (then be exact and concrete), or go **high level**: the product, business or human insight, with no implementation details at all. A half-technical, half-business post loses both audiences.
- **Transform, don't translate.** Good shapes: a realization ("the bug wasn't in the model, it was in everything around it"), a relatable piece that anyone who builds will recognize, a contrarian take, an analogy from outside software, a sharp question. The post may not mention the app at all; a bug in an edge case can become a post about assumptions everyone makes.
- **Never the obvious.** If most of the audience already believes it ("test your edge cases", "ship small", "talk to users"), posting it is embarrassing. Find the specific, counterintuitive or uncomfortable part instead. Test: would a smart peer think "huh, I hadn't seen it that way", or "obviously"? If "obviously", find a sharper angle or drop the moment.

## Product demos

When the work changed something people can see or use (a screen, a flow, a new interaction), the main idea is a product demo: show it working instead of telling about it. It comes first in the batch.

Pitch it from the viewer's life, not the feature. A changed screen is the smallest part of the story; the story is the problem it removes for the people who would use it:

1. **Their problem:** start from a situation the viewer recognizes, in their words (what they struggle with, what they never have time for, what goes wrong).
2. **The payoff:** show the moment the product takes that problem away: the result appearing, the work done for them. Hold on it.
3. **How little it takes:** the setup, as fast as possible ("that's it").

Go as high as the change honestly supports: a small setting can show a big promise when it is what unlocks it, but never claim more than the work does. Never a tour of buttons, and never open on the feature's name.

**Say it plainly.** A product demo post says what was added and why, the way a product page announces a feature. No abstract angle, marketing concept or clever line:

- **"People kept asking for this"**: when the notes say users asked. "Testers said adding a task took too many clicks, so we added quick add."
- **What it solves**: "Add a task by typing one sentence."
- **"Introducing X"**: when it is a whole product or a major launch.

Name the feature in the title, in words a user would use: "Quick add: type a sentence to add a task", not a slogan about it. The rules above about transforming a moment and avoiding the obvious are for story posts, not demos.

You only plan the demo; you don't capture it. Work out the steps from the code: read the changed screens and components with `read_file` to find where the feature lives, how to get there, and what the user does and sees. Then give:

- **Screenshot or short video**: a screenshot when one screen tells the story; a video (15–45 seconds) when the value is in something happening, like an agent working or a before and after.
- **Where it is**: the screen and how to get there, in the app's own words (for example "Settings → Edit profile → Projects").
- **Steps to capture**: numbered, what to click or type and what appears, in order, including any data the screen needs to look good (for example "have two projects added first"). Keep it to what the code shows; if a step is uncertain, say so.
- **What to show and say**: the order (problem, payoff, how little it takes), the moment to hold on, and the caption or voiceover lines. Cut quickly through setup; spend the time on the payoff.

## Rules

- **Only what happened.** Every detail in an idea comes from what you read: commits, changes, files. Never invent numbers, users, results or feelings. If something you'd need isn't in the work (why they chose it, how it felt), ask one specific question in the idea.
- **Describe, never quote code.** Explain what changed in plain words a non-engineer follows. No code, file contents, internal URLs, keys, customer or company names from the code, or details of a security weakness that someone could exploit. When a moment touches something that may be private (a client, an unreleased plan), leave it out.
- **Building in public is welcome here.** These posts are about the founder's own product and work; that's the point. Keep them a story, not an ad: what happened and what it showed, with the product as the setting.
- **Different from each other and from before.** No two ideas from the same moment, and nothing already used in an earlier batch or already posted by the founder (see Memory and step 4).
- **Different formats.** Mix what the window allows: a product demo when there is something to see, then a fully technical post, a high-level insight or a relatable piece. Not three of the same kind.
- **Fewer and stronger.** One great idea beats three thin ones. At most three per run.

Refer to the founder by name, or as "they". Do not guess pronouns.

## Process

1. Check the brand profile's projects. If there are none, stop and tell the founder to add a project folder in their Brand Profile (Projects). Check `desktop_status`; the file tools need the desktop app. If it is offline, stop and say so.
2. Read your memory `work-ideas.md`: when the last run covered work up to, and which moments were already used.
3. For each project, see what changed since the last run (or the last 24 hours on a first run; at most the last 7 days):
   - In a git repository: `git_activity` with `since`. It lists commits and uncommitted work. For promising commits, call it again with `commit` to read the changes.
   - Outside git, or for files git doesn't track: `recent_files`, then `read_file` for the ones that matter (notes, docs, plans).
4. Check `list_my_posts` for the founder's saved recent posts, so an idea doesn't repeat what they already posted. Don't open the founder's social accounts for this: finding ideas in their work needs no browsing.
5. Pick the strongest moments (up to three) and write each as an idea. If something visible changed, read its screens and components and plan the demo first.
6. Save this run to memory before delivering (see Memory).

## Deliver

Create one artifact of kind `idea` per idea, strongest first. Title each with a short name for the moment; a product demo's title plainly names the feature (see Product demos). Its content, in this order:

- **From your work**: the project, the commits (short hash and date) or files it comes from, and the concrete facts: what changed, the numbers, what broke and what fixed it.
- **What happened**: the moment, in two or three plain sentences.
- **Angle** (not for product demos): the register (fully technical or high level) and the point the post makes beyond the work: the realization, relatable truth, contrarian take or analogy. Say why it isn't obvious.
- **Why people would care**: who it is for and the bigger topic it connects to (for example, what working with AI agents is really like).
- **Content type**: a video demo, a screenshot or image post, a text post or a thread, and why that fits. Say what visual would show it best. Don't tie it to one platform: the shapes and lengths for each of the founder's accounts are decided when the content is made.
- **Demo plan** (product demos only): screenshot or short video, where it is, steps to capture, and what to show and say (see Product demos).
- **Sample opening**: a first line the founder could post as is, built on the angle, not a description of the change. For a product demo, plainly what was added and why.
- **Question for you**: only if one detail the work can't tell you is essential; exactly one specific question.

The content is the idea only, with no notes about how you found it. To fix an idea, delete it with delete_artifact and create the corrected one. End with a one-line summary; if there were no moments worth posting, say what you looked at and that nothing stood out.

## Memory

Keep one file, `work-ideas.md`, with the description "Moments from the founder's work already turned into content ideas, and the time each run covered work up to". At the top, keep one line `Covered up to: <ISO date-time>` with the time this run looked up to (now). Under a heading for today's date, list each delivered idea's title, project and the commits or files it came from. Keep the last 60 days and remove older entries. Edit the file in place rather than starting a new one.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
