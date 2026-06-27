# PGE 導入手順 (他 PJ に copy)

## 推奨: tarball + ワンライナー展開

source repo 側で 1 回作る:

```bash
.claude/scripts/pack-pge.sh         # → ./pge-bundle.tar.gz (約 200KB)
```

target PJ 側で 1 行で展開 (既存ファイルは上書き):

```bash
tar -xzf pge-bundle.tar.gz -C "$DST/"
```

これで `.claude/` + `.mcp.json` が target repo root に展開され、PGE framework が起動可能になる (= `/sut-precheck` → `/pge-runtime-survey` → `/pge-planning` → `/pge-sprint-cycle` が動く)。

**`CLAUDE.md` は bundle 対象外**。本 repo の `CLAUDE.md` は **PGE framework を開発・改修する人** のための instruction (絶対ルール / halt protocol / subagent 呼び出しルール 等の orchestrator 自動遵守規約) であり、**PGE を使うだけの他 PJ には不要**。skill / agent / hook は CLAUDE.md がなくても discover される。

## 代替: rsync (source repo を target machine に clone してある場合)

```bash
SRC=<this repo の root>; DST=<target PJ の root>
rsync -av --exclude={cache,pge-dev-reports,scheduled_tasks.lock,settings.json,settings.local.json,docs-viewer,.DS_Store,statusline.sh} "$SRC/.claude/" "$DST/.claude/"
cp "$SRC/.mcp.json" "$DST/"
```

## target に既存ファイルがある場合の merge ガイド

| ファイル | 既存あり時の対応 |
|---|---|
| `.mcp.json` | `mcpServers` 内に `playwright` entry を merge |
| `.claude/agents/<同名>.md` | 公式 docs より project agent が precedence・既存が PGE agent と衝突する場合は退避して PGE 版を採用するか、機能 merge する |
| `.claude/skills/<同名>/` | 同上 |
| `CLAUDE.md` | **merge 不要** (本 repo の CLAUDE.md は framework 改修者向け instruction で、PGE を使うだけの他 PJ には不要)。target 既存 CLAUDE.md にも追記不要 |

`.claude/settings.json` は bundle 対象外。権限設定・hook 設定は target PJ の security policy に依存するため、必要な場合のみ target 側で明示的に opt-in する。

## 除外している runtime artifact (= copy 不要)

- `.claude/cache/` (TI Phase 2 等の per-SUT cache)
- `.claude/pge-dev-reports/` (session 出力)
- `.claude/scheduled_tasks.lock` (runtime lock)
- `.claude/settings.json` (権限・sandbox・hook 設定は project policy 依存)
- `.claude/settings.local.json` (個人 override・gitignore 対象)
- `.claude/docs-viewer/` (PGE framework 本体ではない docs viewer)
- `.claude/.DS_Store` (macOS junk)
- `.claude/statusline.sh` (user UI customization・PGE 必須ではない)

## 導入後の verify

skill / agent / hook が discover されたかを確認:

```bash
ls "$DST/.claude/skills/" "$DST/.claude/agents/" "$DST/.claude/hooks/"        # file 配置 確認
# その後 Claude Code を target PJ で起動 → `/sut` と type して autocomplete に
# /sut-precheck が出れば skill discovery OK・/pge-planning も同様に出るはず
```

## PGE 動作前に target PJ 側で別途準備が必要なもの

詳細は `.claude/workflows/README.md` の「Runtime container 前提」節を参照。

| 要素 | 必須? |
|---|---|
| app の pre-built docker image | ✓ (Build-Image phase で再 build 可能) |
| app の Dockerfile | △ (Build-Image phase を使うなら必須) |
| baseline DB container 起動済 (typically docker-compose) | ✓ |
| PGE runner (devcontainer / CI runner) が SUT app container と同 docker network 上 | ✓ |
| Playwright MCP が起動可能な Node.js 環境 | ✓ |

## PGE framework 内の主要 file 一覧

参考までに今 copy した中身の categorize:

| Path | 件数 | 役割 |
|---|---|---|
| `.claude/agents/*.md` | 11 | researcher / generator / investigator / evaluator-{pre-smoke,per-ac,auditor,aggregator} / expert-reviewer / agnostic-auditor / advisor 2 種 |
| `.claude/references/*.md` | 12 | agent / skill / workflow から参照される schema / protocol / catalog |
| `.claude/skills/<name>/SKILL.md` | 8 | pge-planning / pge-runtime-survey / pge-convention-survey / pge-report / sut-precheck / test-design-contracts / test-investigation-cache / monitor-protocol |
| `.claude/workflows/*.{js,md}` | 2 | pge-sprint-cycle (sprint full cycle) + README |
| `.claude/scripts/**/*.{sh,cjs}` | 5 | DB clone / SUT precheck / Playwright capture |
| `.claude/hooks/*.sh` | 2 | agnostic-purity-check / workflow-syntax-check (PostToolUse) |
| `.claude/tools/pge-report.py` | 1 | /pge-report の本体 (zero dep) |
| `/<pjroot>/.mcp.json` | 1 | Playwright MCP |
