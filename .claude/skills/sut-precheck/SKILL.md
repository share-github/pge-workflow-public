---
description: PGE flow (/pge-planning + /pge-sprint-cycle) を起動する前に SUT 環境 (Test Runner 依存・docker / Node.js / Playwright / Chromium / CJK font / host tools) が PGE 実行に十分か機械的に check する独立 skill。PGE 本体 (planning + sprint cycle) とは責務を分離している。
disable-model-invocation: true
argument-hint: "(任意) SUT root path — 省略時は Test Runner config の所在から動的検出"
---

# SUT Test Runner Precheck

`/sut-precheck` で起動。PGE flow を回す**前**に、SUT 環境が Test Runner 実行 (workflows/pge-sprint-cycle.js Step 5-B-4 で per-AC が self-execute する Bash 実行 経路) を成功裏に通すために必要な依存をすべて持っているか確認する。

**責務**: 「足りないものを通知する」のみ。**自動 install / fix はしない**。人間が devcontainer rebuild / 手動 install で対処する責任分界。

## 検査項目 (7 項目)

| # | 項目 | 不在時の対処 |
|---|---|---|
| 1 | Node.js / npm | Devcontainer rebuild (Dockerfile に nodesource setup あり) |
| 2 | SUT root の `package.json` で `@playwright/test` が declare されている | `npm install --save-dev @playwright/test` |
| 3 | SUT root の `node_modules/@playwright/test/cli.js` が存在 | `cd <SUT root> && npm ci` |
| 4 | Chromium browser binary install 済 | `cd <SUT root> && npx playwright install chromium` |
| 5 | 多バイト文字フォント — SUT の UI 言語が ASCII 範囲外文字を含む場合に必要 (例: 日本語 SUT なら `fc-list :lang=ja` で確認) | Devcontainer rebuild (OS の package manager で対応フォントパッケージを追加) |
| 6 | Docker CLI が `/var/run/docker.sock` 越しに利用可能 (per-AC DB clone に必須) | compose file の volumes 節を確認 |
| 7 | `lsof` / `ss` / `fuser` のいずれか (Step 5-B-2-A port holder kill に必須) | OS の package manager で追加 (commands 名は POSIX 系で共通・パッケージ名は distro によって異なる) |

## 実装

bash script を 1 つ呼び出すだけ:

```bash
bash .claude/scripts/sut-precheck/check-test-runner-deps.sh
```

SUT root を明示したい場合:

```bash
bash .claude/scripts/sut-precheck/check-test-runner-deps.sh <SUT root>
```

SUT root 省略時は Test Runner config (`playwright.config.ts` / `pytest.ini` / `pom.xml` / `build.gradle.kts` / `build.gradle` / `package.json`) の所在から動的検出 (= `workflows/pge-sprint-cycle.js` Step 4.25-A2 の SUT root 動的検出と同じ手法)。

## 出力

各項目を `[PASS]` / `[FAIL]` / `[WARN]` で stdout に表示。FAIL 行には対処方法 (`→ ...`) を併記。

- 全 PASS → exit 0 + `=== ALL PASS — PGE flow を起動して問題ない状態です ===`
- 1 件でも FAIL → exit 1 + `=== <N> issue(s) detected ===`

## 使い分け

| シチュエーション | 推奨 |
|---|---|
| devcontainer 初回 build 直後・rebuild 後 | `/sut-precheck` を一度回して全 PASS を確認 |
| 別の PJ / SUT に切り替えた直後 | 同上 |
| PGE flow 実行中に Test Runner エラー (per-AC self-execute) | `/sut-precheck` を回して infrastructure 不在かを切り分け |
| CI で再現性確認 | `bash .claude/scripts/sut-precheck/check-test-runner-deps.sh` を job step として呼ぶ |

## PGE flow との独立性

本 skill は **PGE flow の責務外**である。PGE flow の Step 群 (researcher / planner (= pge-planning Skill inline) / generator / investigator / evaluator family / expert-reviewer) には**含まれない**:

- PGE flow (/pge-planning + /pge-sprint-cycle) は SUT 環境が整っている前提で実装/検証 loop を回す
- 「環境が整っているか」は本 skill が独立に担う

両者を分離することで:

- PGE 本体の責務範囲を test design + verification loop に集中できる (環境 setup の話を SKILL / agents に混入させない)
- precheck を CI から独立に呼べる (PGE flow 経由でなくても check 可能)
- 環境要件が増えても本 skill だけ更新すれば PGE 本体側は無変更
