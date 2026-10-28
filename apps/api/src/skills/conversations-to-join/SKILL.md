---
name: conversations-to-join
description: Find up to five fresh, relevant conversations on one platform that are alive enough to join, and draft a specific reply for each.
---

# Conversations to join

Find up to five recent conversations on one platform where the founder can add something genuinely useful, and draft a reply for each. Relevance matters more than popularity: the goal is a reply that adds something real where people will see it. The founder reviews and posts the replies themselves.

## Which conversations

- **Relevant.** On the founder's topics, including what is happening in their industry right now, and somewhere their work gives them something real to add.
- **Fresh.** Posted within the last 48 hours. Read the post's date on the post itself.
- **Alive, not dead.** Either the author is popular, in which case any number of replies is fine, even on a post from a few minutes ago:
  - X, Instagram, Threads, Facebook: 1,000+ followers
  - LinkedIn: 100+ followers or connections
  or the post already has at least 10 replies or comments from different people.
- **Different people.** No author twice in one list, and no post suggested before. Avoid authors suggested in the last week unless their new post is clearly the best conversation to join; your memory keeps who was suggested (see Memory).
- Skip political or heated threads, giveaways, engagement bait, and posts already buried under hundreds of replies, where a new reply won't be seen.

## Process

1. Activate the browser plugin and read its skill. Open the account's own page and read it. If it is signed out or shows a different account, stop and say so.
2. Read who was suggested before from memory: `<platform>/conversations-suggested.md`, for example `x/conversations-suggested.md`. Read the account's recent posts to learn how the founder writes and what they care about.
3. Search the platform for each of the founder's topics and for current industry news, preferring the latest results, and skim the home feed. One search is never enough: run several with different keywords until you have strong candidates or have clearly exhausted the topics.
4. For each candidate, check freshness and whether it is alive from what the post and its search result show: date, reply or comment count, and the author's follower count where the platform shows it (on X, hovering or the author line often shows it; on LinkedIn, the post header shows followers for many authors). On LinkedIn, never open someone's profile to check their numbers; they would see that the founder viewed it. If the follower count isn't visible, use the 10-comments rule.
5. Open each pick and read its replies before drafting, so the reply does not repeat what others said.
6. Close the tabs you opened.
7. Save today's list to memory before delivering (see Memory).

## Each reply

- **Adds one specific thing:** a clear take, a concrete example, or a sharp question, ideally from the angle only this founder has. No generic agreement, nothing any founder could have written, and nothing the post or other replies already said.
- **Short and native.** Fits the platform (on X, at most 280 characters; aim for 250 or fewer), and sounds like the founder's own posts.
- **Not an ad.** No links and no company mention unless the post directly asks for a tool.
- **Never invents facts about the founder.** Where a detail only they know would make the reply stronger, use a small marked placeholder such as [how long it took], and ask about it.

Refer to the founder by name, or as "they". Do not guess pronouns.

## Deliver

Deliver each conversation as one reply card with create_reply, intent `conversation`, created as soon as its reply is written. The founder sees the post with the reply under it and buttons to reply, copy and mark it done, so the card holds only:

- **platform**, and **target**: the exact link, the author's name and handle, when it was posted (ISO time if you can read it, otherwise as shown), the post's text as shown (its first lines if long), and the numbers you saw as `stats` (replies or comments, reposts, likes, views, and `author_followers` if shown).
- **text**: the reply, ready to paste once any placeholder is filled, and nothing else.
- **why**: one short line on the specific point the reply adds.

If you found fewer than five good ones, deliver only those. No documents, and no notes about how you wrote them. Your final message says how many you found and asks one specific question for each placeholder. To fix a card, or fill a placeholder after the founder answers, delete it with delete_artifact and create it again. Make sure every tab you opened is closed, then end with a one-line summary.

Never reply, like, repost, or follow. Drafting is the whole job.

## Memory

Keep one file per platform, `x/conversations-suggested.md` for X, with the description "Conversations already suggested to join on X: posts and authors by date". Under a heading for today's date, list each suggested post's link and author. Keep the last 30 days and remove older entries. Edit the file in place rather than starting a new one.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
