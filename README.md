# PGE Bundle

PGE (Planner-Generator-Evaluator) framework files for Claude Code projects.

This repository contains only the distributable PGE files:

- `.claude/` framework files
- `.mcp.json` for Playwright MCP

## Install

Copy this repository's `.claude/` directory and `.mcp.json` to the target repository root.

If you received a transfer tarball separately, extract it at the target repository root:

```bash
DST=/path/to/target/repo
tar -xzf pge-bundle.tar.gz -C "$DST/"
```

`pge-bundle.tar.gz` is a transfer artifact and is intentionally not committed to this public repository.

## Security Notes

The public bundle intentionally excludes local or policy-sensitive files:

- `.claude/settings.json`
- `.claude/settings.local.json`
- `.claude/statusline.sh`
- `.claude/cache/`
- `.claude/pge-dev-reports/`
- `.claude/scheduled_tasks.lock`
- `.claude/docs-viewer/`

Permission, sandbox, and hook settings should be configured explicitly in each target project according to that project's policy.

## Runtime Dependencies

The included `.mcp.json` starts Playwright MCP through `npx @playwright/mcp@latest`. This means the target environment may fetch and execute that package at runtime. Pin the package version in `.mcp.json` if your project requires reproducible dependency resolution.

## Verify Files

```bash
ls .claude/skills .claude/agents .claude/workflows
```

## License

Licensed under the MIT License. See `LICENSE`.

This is an independent distribution and is not an official Anthropic, Claude, Cursor, Playwright, or Docker project.
