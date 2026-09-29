# principles-research

A Claude Code plugin for evidence-grounded research. Ask it about a topic and
you get back a principles brief — core principles, anti-patterns, and the pain
points practitioners actually report — where every claim is cited to a page the
agent really fetched. Briefs are saved to `~/.claude/research/<topic-slug>.md`.

It ships two pieces:

| Piece | Use it for | How it runs |
|---|---|---|
| `principles-scout` agent | small, single-question topics | one agent, 10–20 tool calls, writes the brief itself |
| `principles-atlas` workflow | big, multi-facet topics | scope → one scout per facet → a skeptical auditor re-fetches every citation → one synthesis pass writes the brief |

## Install

In Claude Code:

```
/plugin marketplace add intuito-studio/principles-research
/plugin install principles-research@intuito-studio
```

Or from a terminal:

```sh
claude plugin marketplace add intuito-studio/principles-research
claude plugin install principles-research@intuito-studio
```

Start a new session afterwards.

If the repo is private, you need read access to it on GitHub, and git on your
machine must be able to clone it (SSH key or credential helper).

## Use

**Big topic — the workflow:**

```
/principles-research:principles-atlas onboarding flows for children's learning apps
```

For a deeper run, ask in plain words: *"run principles-atlas on onboarding flows
for children's learning apps, exhaustive"*.

- `standard` (default): up to 5 facets, 10–20 tool calls per scout — about 12 agents.
- `exhaustive`: up to 8 facets, 20–30 tool calls per scout — about 18 agents.

A run takes a while and uses a meaningful amount of your plan's usage. Only
claims the auditor marks "unsupported" are dropped; "weak" ones are kept but
capped at *supported* confidence.

**Small topic — the agent:** ask Claude to *"research the principles of X"* or
*"what makes a good X"*, or name the `principles-scout` agent directly.

## Requirements

- **Claude Code with workflows enabled.** If `/config` shows a *Dynamic
  workflows* row, turn it on and restart. If there is no such row, workflows
  are not available on your plan or are disabled by your organization.
- **Opus access.** The scout is pinned to `model: opus`. Without Opus, change
  that line in `agents/principles-scout.md` to `sonnet` (or delete it to use
  your session model).
- **Firecrawl MCP (optional).** Used as a fallback when a page blocks the normal
  fetch or needs JavaScript. Without it, those sources are skipped.

## What stays on your machine

- Briefs go to `~/.claude/research/`. The scout reads that folder first and
  extends an existing brief instead of starting over.
- The scout keeps its own notes (which sites block fetching, what worked) in
  Claude Code's agent memory. Each person's memory is their own; nothing is
  shared back through this repo.

## Updating

Maintainers: bump `version` in `.claude-plugin/plugin.json` with every change,
then push. Users pull the change with:

```sh
claude plugin marketplace update intuito-studio
claude plugin update principles-research@intuito-studio
```

and restart Claude Code.

## Layout

```
.claude-plugin/
  marketplace.json   # makes this repo installable as the "intuito-studio" marketplace
  plugin.json        # the plugin manifest
agents/
  principles-scout.md
workflows/
  principles-atlas.js
```

Inside the plugin the agent is `principles-research:principles-scout`, and the
workflow calls it by that full name.
