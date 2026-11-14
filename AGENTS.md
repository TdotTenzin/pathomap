# Efficiency rules

- For non-trivial code work, load the `token-efficiency` skill before searching.
- Comment-heavy files: skip header comments; grep code symbols and read only the needed slice.
- Grep/glob before read; never read a file you can search.
- Read with offset/limit — only the lines you need, never whole files by default.
- Batch independent tool calls in one message.
- Delegate broad codebase exploration to the `explore` subagent; keep results, not raw dumps, in main context.
- Do not re-read files already shown in context; edit directly.
- No file edits unless asked; no commits/pushes/PRs unless asked.
- Write code immediately when the task is clear — no restating the plan, no narration, no dumping full files back.
- Keep replies to a few lines; bullets over paragraphs.
