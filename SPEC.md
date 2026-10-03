# What?

a tui, based on @opentui/solid, that will show me an interactive status dashboard for the current worktree's open PR in github.

# Features

### PR feed

- comments (status posts from actions, etc.)
- threads (bot comments, reviews submitted). allow responding to comments inline in feed.

### Actions status

- workflows in progress
- workfflows completed
- Summaries/annotations/warnings e.g. <https://github.com/octocat/hello-world/actions/runs/34373594641/attempts/1#summary-102541424126>
- links to everything
- v1: don't stream logs inline

### merge blockers

- required codeowner reviews, open threads, etc.
