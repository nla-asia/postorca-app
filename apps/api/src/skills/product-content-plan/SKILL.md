---
name: product-content-plan
description: "Understand the project, identify the requested product content type and follow its planning guide."
---

# Product content plan

## 1. Understand the project first

Before reading a type-specific guide or drafting a plan, make a real attempt to understand the intended project.

- Identify the project from the request and brand profile. Use `active_project` when supplied and its source `folders` (or older `path` field); ask if the intended project is unclear.
- Read the brief, README or product docs, and relevant code with the available project tools (`list_dir`, `read_file`, `git_activity`). Establish what the product does, who it helps, its main capabilities and its main user flow.
- When a running app or supplied product screenshots are available, inspect the main screens and user flow without recording. Use this to understand the actual experience before planning shots. The selected guide determines the video's visual treatment.

If files or app access are unavailable, report the gap directly in chat, separately from the plan and script. Keep access-status notes out of the deliverables. Use the material you can verify and carry this project understanding into the selected guide.

## 2. Identify the type and follow its guide

Identify the content type from the request and context, then read and follow its guide. Ask only when the type is unclear and the distinction would change the result. A launch can introduce a whole product or announce one feature; use the subject and purpose to decide.

Read the selected reference with `read_skill`, using `name: "product-content-plan"` and its `file` path:

| Type | Purpose | Guide |
| --- | --- | --- |
| Product introduction | What it is, who it's for and why they'd care | [references/product-introduction.md](references/product-introduction.md) |
| Product demo | Show the product doing a useful job | [references/product-demo.md](references/product-demo.md) |
| Product how-to | Teach a particular task | [references/product-how-to.md](references/product-how-to.md) |
| Product feature release | Announce a specific new capability | [references/product-feature-release.md](references/product-feature-release.md) |
| What's new | Explain useful changes from a particular period | [references/whats-new.md](references/whats-new.md) |

For an introduction with a demo beat, read both the introduction and demo guides. Follow the selected guides for all planning and scripting instructions.
