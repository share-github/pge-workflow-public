#!/usr/bin/env bash
# .claude/hooks/workflow-syntax-check.sh
#
# PostToolUse hook for Edit/Write/MultiEdit on .claude/workflows/*.js
# Wraps the script in an async function (top-level return/await is legal in
# the workflow runtime but not in raw Node) and runs `node --check`.
# Catches syntax errors before they reach the workflow tool — where they
# manifest as "the slash command silently fails to register".
#
# Exit codes:
#   0 = pass (no syntax error, or out of scope, or node unavailable)
#   2 = syntax error -> Claude Code surfaces the failure to orchestrator

set -e
set -o pipefail

# Read Claude Code hook input (JSON via stdin).
hook_input="$(cat || true)"
tool_name=$(printf '%s' "$hook_input" | jq -r '.tool_name // empty' 2>/dev/null || true)
file_path=$(printf '%s' "$hook_input" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null || true)

# Out-of-scope tool -> skip.
case "$tool_name" in
  Edit|Write|MultiEdit) : ;;
  *) exit 0 ;;
esac

# Empty file_path -> nothing to validate.
[ -n "$file_path" ] || exit 0

# Scope filter: only workflow scripts under .claude/workflows/.
case "$file_path" in
  */.claude/workflows/*.js|.claude/workflows/*.js)
    : # in scope
    ;;
  *)
    exit 0 # out of scope
    ;;
esac

# File must exist (it was just written, so this is a safety guard).
[ -f "$file_path" ] || exit 0

# node must be available; if not, skip silently to avoid blocking edits
# in environments where node isn't installed.
command -v node >/dev/null 2>&1 || exit 0

# Wrap the script in an async function so top-level return/await parses.
# The workflow runtime does this implicitly; we replicate the wrapping for
# syntax validation only (no execution).
tmpfile=$(mktemp --suffix=.js)
trap 'rm -f "$tmpfile"' EXIT

{
  printf '%s\n' '(async function(args, phase, log, agent, parallel, pipeline, workflow, budget) {'
  # Strip `export const meta = ` so the wrapper compiles standalone.
  sed 's/^export const meta = /const _meta = /' "$file_path"
  printf '%s\n' '})'
} > "$tmpfile"

# Run node --check and capture output.
if check_output=$(node --check "$tmpfile" 2>&1); then
  exit 0
fi

# Syntax error -> emit a focused report and block.
filename=$(basename "$file_path")
printf 'FAIL .claude/workflows/%s syntax error:\n\n' "$filename" >&2
printf '%s\n\n' "$check_output" >&2
cat >&2 <<EOF
Workflow file failed Node syntax check (script wrapped in async function for top-level return/await support).

The workflow tool silently skips registration when a workflow script has a syntax error -- the slash command will not appear in the suggest list. Fix the syntax error and retry.

Debug tip: reproduce locally with:
  node --check <(echo '(async function(args, phase, log, agent, parallel, pipeline, workflow, budget) {' && sed 's/^export const meta = /const _meta = /' "$file_path" && echo '})')
EOF

exit 2
