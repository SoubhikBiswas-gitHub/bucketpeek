## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Comments

- Write a comment only when the code can't say it: a non-obvious reason, a hidden constraint, a workaround for a specific bug. Never restate what the code does, and never narrate the task or change history.
- Use `//` line comments only. Don't use `/* */` or `/** */` (JSDoc) blocks. Inside JSX, where only `{/* */}` works, put the comment as `//` above the element instead, or drop it.
- Keep each comment short: one line, two at most.

## Commits

- No `Co-Authored-By` or any attribution line.
- Never mention tools, agents, AI, worktrees or internal branch names (`worktree-agent-*`) in commit messages.
- Merge commits describe the change in plain words ("Merge: …"), never `Merge branch '<internal-branch>'`.
