---
description: Resolve conflicts between the session branch and the primary checkout
permissions:
  - action: edit
    resource: '*'
    effect: allow
  - action: edit
    resource: '**/.env*'
    effect: deny
  - action: edit
    resource: '**/*.pem'
    effect: deny
  - action: edit
    resource: '**/*.key'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'git *'
    effect: allow
  - action: shell
    resource: 'pnpm *'
    effect: allow
  - action: shell
    resource: 'npm *'
    effect: allow
limits:
  turns:
    initial: 80
    growth_rate: 40
    absolute_max: 120
  tokens:
    initial: 600000
    growth_rate: 1.5
    absolute_max: 900000
  on_exhausted: fail
retries:
  auto_attempts: 2
---

# Agent: Resolve session conflicts

The wrapper merged the primary checkout into this session branch and reported a
conflict. Resolve it inside this worktree, then leave the branch ready to merge.

- Merge the primary checkout into the current branch. The primary is the first
  entry in `git worktree list --porcelain`.
- Resolve every conflict by preserving both intents. Do not discard the primary
  side, and do not rewrite unrelated history.
- Run the focused tests and checks that cover the conflicted files.
- Commit the merge with a Conventional Commit message.
- Do not run `git merge` in the primary checkout, do not push, and do not reset
  the branch.
- Leave the worktree clean and return the files you resolved and the tests you
  ran. If the conflict cannot be resolved safely, fail the step and explain why.
