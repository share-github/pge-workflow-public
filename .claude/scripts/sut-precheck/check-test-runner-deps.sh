#!/bin/bash
# SUT Test Runner Precheck — PGE flow (/pge-planning + /pge-sprint-cycle) 実行**前**の health check.
#
# 役割: SUT 環境が PGE flow (workflows/pge-sprint-cycle.js Step 5-B-4 で
#       per-AC が Bash で self-execute する Test Runner) を回せる状態か機械的に確認する.
#       不足を検出した場合は対処方法を表示するのみで、自動 install / fix はしない
#       (= 人間が devcontainer rebuild / 手動 install で対処する責任分界).
#
# 起動: bash .claude/scripts/sut-precheck/check-test-runner-deps.sh [SUT_ROOT]
#       (SUT_ROOT 省略時は Test Runner config の所在から動的検出)
#
# 終了 code: 全 PASS で 0・1 件でも FAIL で 1.

set -uo pipefail

SUT_ROOT="${1:-}"

# --- SUT root 動的検出 -----------------------------------------------------
# (workflows/pge-sprint-cycle.js Step 4.25-A2 の SUT root 動的検出と同じ手法・複数 Test Runner 対応)
if [ -z "$SUT_ROOT" ]; then
  SUT_ROOT=$(
    find "${CLAUDE_PROJECT_DIR:-.}" -maxdepth 4 \
      \( -name "playwright.config.ts" -o -name "playwright.config.js" \
         -o -name "pytest.ini" -o -name "pom.xml" \
         -o -name "build.gradle.kts" -o -name "build.gradle" \
         -o -name "package.json" \) \
      -not -path "*/node_modules/*" 2>/dev/null \
    | head -1 | xargs -r dirname
  )
fi
SUT_ROOT=$(realpath "$SUT_ROOT" 2>/dev/null || true)

cat <<EOF
=== SUT Test Runner Precheck ===
SUT_ROOT: ${SUT_ROOT:-<NOT DETECTED>}

EOF

fail=0
pass() { printf '[PASS] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
err()  { printf '[FAIL] %s\n  → %s\n' "$1" "$2"; fail=$((fail+1)); }

# --- 1. Node.js / npm -------------------------------------------------------
if command -v node >/dev/null && command -v npm >/dev/null; then
  pass "Node.js $(node --version) / npm $(npm --version)"
else
  err "Node.js / npm not installed" \
      "Devcontainer rebuild (Dockerfile に nodesource setup あり)"
fi

# --- 2. SUT package.json + @playwright/test declared -----------------------
HAS_PW_DECLARED=0
if [ -n "$SUT_ROOT" ] && [ -f "$SUT_ROOT/package.json" ]; then
  if jq -e '.devDependencies["@playwright/test"] // .dependencies["@playwright/test"]' \
        "$SUT_ROOT/package.json" >/dev/null 2>&1; then
    pass "$SUT_ROOT/package.json declares @playwright/test"
    HAS_PW_DECLARED=1
  else
    err "$SUT_ROOT/package.json does NOT declare @playwright/test" \
        "cd $SUT_ROOT && npm install --save-dev @playwright/test"
  fi
else
  warn "$SUT_ROOT/package.json not found (Playwright を使わない SUT の可能性: 以下 3-4 を skip)"
fi

# --- 3. node_modules with @playwright/test installed -----------------------
if [ "$HAS_PW_DECLARED" -eq 1 ]; then
  if [ -f "$SUT_ROOT/node_modules/@playwright/test/cli.js" ]; then
    pass "$SUT_ROOT/node_modules/@playwright/test installed"
  else
    err "@playwright/test not installed under $SUT_ROOT/node_modules" \
        "cd $SUT_ROOT && npm ci  (or: devcontainer rebuild で postCreateCommand に乗せる)"
  fi
fi

# --- 4. Chromium browser binary --------------------------------------------
# Playwright の `install --dry-run` は install plan のみ表示する (already/missing 文言なし)。
# 出力中の "Install location: <path>" を抽出し、実際に存在するかで判定する。
if [ "$HAS_PW_DECLARED" -eq 1 ] && [ -f "$SUT_ROOT/node_modules/@playwright/test/cli.js" ]; then
  dry=$(cd "$SUT_ROOT" && npx playwright install --dry-run chromium 2>&1 || true)
  chromium_location=$(printf '%s\n' "$dry" | grep -m1 'Install location:' | awk '{print $NF}')
  if [ -n "$chromium_location" ] && [ -d "$chromium_location" ]; then
    pass "Chromium browser binary installed ($chromium_location)"
  elif [ -n "$chromium_location" ]; then
    err "Chromium browser binary NOT installed (would be at $chromium_location)" \
        "cd $SUT_ROOT && npx playwright install chromium"
  else
    warn "Chromium status indeterminate (Install location 行を抽出できず)"
  fi
fi

# --- 5. Multibyte UI font (SUT 言語依存・default check は ja) --------------
# Chromium が SUT の UI 言語 (ASCII 範囲外) を描画できることを確認。
# SUT_FONT_LANG 環境変数で言語コードを上書き可能 (default: ja)・他言語 UI の SUT
# (zh-hans / ko / th 等) では本変数で切り替える。
SUT_FONT_LANG="${SUT_FONT_LANG:-ja}"
if command -v fc-list >/dev/null 2>&1 && fc-list ":lang=${SUT_FONT_LANG}" 2>/dev/null | head -1 | grep -q .; then
  pass "UI font for lang=${SUT_FONT_LANG} available (Chromium で当該言語の UI が描画可能)"
else
  err "UI font for lang=${SUT_FONT_LANG} NOT available" \
      "OS の package manager で対応フォントパッケージを追加してください"
fi

# --- 6. Docker CLI / socket -------------------------------------------------
if command -v docker >/dev/null && docker ps >/dev/null 2>&1; then
  pass "Docker CLI usable (socket mount OK)"
else
  err "Docker CLI NOT usable" \
      "/var/run/docker.sock mount を確認 (compose file の volumes 節)"
fi

# --- 7. Step 5-B-2-A 用 host tools (lsof / ss / fuser) ---------------------
host_tool_found=0
for t in lsof ss fuser; do
  if command -v "$t" >/dev/null 2>&1; then
    host_tool_found=1
    break
  fi
done
if [ "$host_tool_found" -eq 1 ]; then
  pass "host port probe tool available (lsof / ss / fuser のいずれか)"
else
  err "lsof / ss / fuser いずれも未 install (Step 5-B-2-A が halt する)" \
      "OS の package manager で lsof / ss / fuser のいずれかを追加 (commands 名は POSIX 系で共通・パッケージ名は distro 依存)"
fi

# --- 結果集計 ---------------------------------------------------------------
echo
if [ "$fail" -eq 0 ]; then
  echo "=== ALL PASS — PGE flow を起動して問題ない状態です ==="
  exit 0
else
  echo "=== $fail issue(s) detected — PGE flow 起動前に上記対処を実施してください ==="
  exit 1
fi
