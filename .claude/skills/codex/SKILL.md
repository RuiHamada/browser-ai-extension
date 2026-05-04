---
name: codex
description: Execute code reviews, analysis, and codebase queries using OpenAI Codex CLI. Use when the user asks for code review, codebase-wide analysis, implementation questions, bug investigation, refactoring suggestions, or complex problem investigation. Triggers include "codex", "code review", "review this", "analyze the code", "investigate the bug", "/codex", or any request to examine or improve existing code across a project.
---

# Codex

Skill for executing code reviews and analysis using Codex CLI.

## Command

```bash
codex exec --full-auto "<request>"
```

This environment is already containerized, so Codex's own sandbox is unnecessary. `--full-auto` alone is sufficient for non-interactive execution.

## Examples

### Code Review
```bash
codex exec --full-auto "Review this project's code and identify improvements"
```

### Bug Investigation
```bash
codex exec --full-auto "Investigate the cause of errors in the authentication process"
```

### Architecture Analysis
```bash
codex exec --full-auto "Analyze the overall architecture and suggest improvements"
```

## Execution Steps

1. Receive request from user
2. Execute Codex with `--full-auto`
3. Report results to user

## Notes

- When inspecting diffs, prefer `git --no-pager diff` (or set `GIT_PAGER=cat`) to avoid interactive pagers like `less`.
- For large codebases, scope the request to specific directories or files for faster results.