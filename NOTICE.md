# Notice

This repository packages PGE framework files for use with Claude Code projects.

The PGE files are independently authored. This package may describe
interoperability with third-party tools, but it does not include, relicense, or
redistribute third-party documentation or software except where explicitly
present in this repository.

## Third-Party Names

Claude, Anthropic, Cursor, Playwright, Docker, Node.js, and other referenced names may be trademarks of their respective owners. This project is independent and is not endorsed by, sponsored by, or affiliated with those owners.

## Runtime Package Fetching

The included `.mcp.json` references `@playwright/mcp@latest` through `npx`. Users who require reproducible builds or restricted supply-chain policy should pin that dependency or replace the MCP configuration before use.

## Policy-Sensitive Files

The public package intentionally does not include `.claude/settings.json`, `.claude/settings.local.json`, or `.claude/statusline.sh`. Target repositories should configure permissions, sandboxing, hooks, and UI customizations explicitly.
