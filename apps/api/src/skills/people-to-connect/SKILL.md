---
name: people-to-connect
description: Find up to twenty fresh posts on one platform from people who are explicitly looking to connect and fit the founder's space, and draft a short, distinct reply for each, so the founder can follow and reply in one sitting.
---

# People to connect

Find up to twenty recent posts on one platform where someone is explicitly asking to connect, and draft a reply for each. For a small account this is one of the fastest ways to grow: people who ask to connect usually follow back, and the right ones become the founder's early audience. Fit matters more than size: someone building in the founder's space beats a big account that posts about anything. The founder follows and replies themselves.

The founder reviews this list once, not every few minutes, so do the slow part for them: search widely and hand over a full batch, aiming for fifteen to twenty good people. A short list means they go back to scrolling.

## Which posts

- **Asking to connect.** The post invites people to connect, follow or introduce themselves: "let's connect", "looking to connect with founders/builders/…", "who's building in …", "drop what you're building", "introduce yourself", #buildinpublic intro posts, and similar. A post that only shares news or an opinion belongs to conversations to join, not here.
- **A real person in the founder's space.** The author (or, on "drop what you're building" posts, the person you suggest) builds, works or posts on the founder's topics, or is the audience the founder wants. Check their bio and a few recent posts on the post or its search result. Skip bots, brand accounts, crypto or giveaway follow-trains, accounts selling followers or courses, and anyone whose recent posts are mostly engagement bait.
- **Active.** They posted in the last week, so they are likely to see the reply and follow back.
- **Fresh.** The post is from the last 48 hours; prefer the last 24. Read the date on the post itself.
- **Small to mid-sized is fine.** Unlike conversations to join, there is no follower minimum: a builder with 200 followers who fits is a good pick. Skip posts already buried under hundreds of replies, where a new reply won't be seen.
- **Different people.** No author twice in one list, and no one suggested in the last 60 days; your memory keeps who was suggested (see Memory). Check every handle against that file before you add it to the list.

## Process

1. Activate the browser plugin and read its skill. Open the account's own page and read it. If it is signed out or shows a different account, stop and say so. Note the account's follower count.
2. Read who was suggested before from memory: `<platform>/people-suggested.md`, for example `x/people-suggested.md`. Read the account's recent posts to learn how the founder writes and what they are building.
3. Search the platform for connect posts, latest results first. Keep going until you have twenty people or have run twenty different searches; never stop below fifteen while you still have searches left. Mix:
   - the connect phrases ("let's connect", "looking to connect", "want to connect", "who's building", "introduce yourself", "say hi"), each with the founder's topics and roles (founders, builders, indie hackers, the founder's field);
   - hashtags people use to meet each other, such as #buildinpublic, #indiehackers, #solofounder, plus ones for the founder's field;
   - threads that invite everyone to reply, such as "drop what you're building", "what are you working on", "let's connect if you're into …". These are the richest source: open the busiest ones and pick several people from their replies, not only the author. For someone found in a reply, link their reply and reply to it;
   - the home feed and the replies under the best posts you find.
   On X, `since:YYYY-MM-DD` and the Latest tab keep results fresh.
4. Judge each candidate from what the search results already show: the post, the author's name and bio line, the time and the numbers. Don't open each post or profile to check it; open only the busy "drop what you're building" threads you take people from. On LinkedIn, never open someone's profile; they would see that the founder viewed it.
5. **Deliver as you go.** Create each person's reply card (see Deliver) as soon as its reply is written, and save people to memory in batches. A run has a limited number of steps and can stop before you finish, and a card created early is never lost.

Every page costs three steps (open, read, close), so make several tool calls in one step: open three or four searches at once, read them together, close them together. Close each tab once you've taken its candidates.
6. Close the tabs you opened, and make sure there is a card and a memory entry for everyone you found.

## Each reply

Every reply has exactly two parts:

1. **That the founder followed and is happy to connect**, in different words each time ("Followed!", "Just followed", "Gave you a follow", "Following now, happy to connect", "Count me in, followed"). This is why people follow back.
2. **One specific thing about this person or post**: what they're building, a line from their post, or a short question about it.

Nothing else. No greeting by name ("Hi Sami —"), and nothing about the founder or their company: their profile already says who they are, and the person will look.

The one exception is a "drop what you're building" thread, which asks for exactly that: there, part 2 is the founder's intro to what they build, and part 1 still says they followed. Write each of these intros fresh, from a different angle (the problem it solves, who it's for, what it does this week, why the founder is building it), so no two in the list share a sentence.

- **Short.** One or two sentences, under 200 characters.
- **Every reply is different.** The founder pastes these one after another, so an opening, sentence or sentence shape that repeats across replies reads as spam. Vary the wording, the order of the two parts, and the shape: not every reply is a question, and not every one is "[Followed]. [X] is a [adjective] [thing]—what…?". Use dashes sparingly.

Not this, repeated down the list:
> Hi Sami — I'm [name], building [company], a platform for [what it does]. Your post stood out. What's been the hardest part so far?

But this, each one different:
> Voice agents in production is the hard part most people skip. Followed, curious what stack you landed on.
> Followed! Brain games for learning or just for fun?
> Just followed. No-signup for a first tool is a smart call.
> Gave you a follow, the agents-need-an-HR-rep line made my day.
> Following now, happy to connect. Building with AI agents too, so this one hit home.
> Route Planner for hikers is such a good itch to scratch. Followed!
- **Native.** Fits the platform (on X, at most 280 characters; aim for 200 or fewer) and sounds like the founder's own posts.
- **On "drop what you're building" posts**, the reply is the founder's one-line intro to what they build, written to make the right people curious, plus a link only if the post asks for links.
- **Not an ad.** Otherwise no links and no pitch.
- **Never invents facts about the founder.** Where a detail only they know would help, use a small marked placeholder such as [what you're building], and ask about it.

Refer to the founder by name, or as "they". Do not guess pronouns.

## Deliver

Deliver each person as one reply card with create_reply, intent `connect`. The founder sees their post with the reply under it and buttons to follow, reply, copy and mark it done, so the card holds only:

- **platform**, and **target**: the exact link of the post (or of their reply in a thread), the author's name and handle, when it was posted (ISO time if you can read it, otherwise as shown), the post's text as shown (its first lines if long), and the numbers you saw as `stats` (replies, reposts, likes, views, and `author_followers` if shown).
- **text**: the reply, ready to paste once any placeholder is filled, and nothing else.
- **why**: one short line on how they fit the founder's space.

No documents, and no notes in the cards: how you searched, which account you checked, or caveats about the numbers stay out. If you found fewer than fifteen good ones after twenty searches, deliver only those. Your final message says how many people you found and asks one specific question for each placeholder. To fix a card, or fill a placeholder after the founder answers, delete it with delete_artifact and create it again. Make sure every tab you opened is closed, then end with a one-line summary.

**Bigger accounts.** This routine helps most below about 1,000 followers. If the account is above that and your memory has no note that you already said so, add one line to your final message: the follower count, and that the founder can pause this routine in Routines if they no longer need it. Save that you said it in the same memory file, and don't repeat it.

Never follow, connect, reply, like or repost. Drafting is the whole job.

## Memory

Keep one file per platform, `x/people-suggested.md` for X, with the description "People already suggested to connect with on X: posts and authors by date". Under a heading for today's date, list each suggested post's link and its author's handle. Keep the last 60 days and remove older entries. Edit the file in place rather than starting a new one.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
