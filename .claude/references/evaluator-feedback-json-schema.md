# Evaluator: feedback JSON 完全スキーマと埋め方

このスキーマは **`plan/feedback/sprint-N.json` および `plan/feedback/final.json`** (= 集約 feedback) の完全定義である。

## Phase D 以降の用途分離 (最重要)

| 用途 | 書く agent | スキーマ |
|---|---|---|
| per-AC 中間 artifact (`plan/feedback/sprint-N/AC-K.json`) | [`evaluator-per-ac.md`](../agents/evaluator-per-ac.md) | [`evaluator-per-ac-feedback-schema.md`](evaluator-per-ac-feedback-schema.md) — 本ファイルの subset (no_regression / smoke_tests / risk_score を含まない) |
| pre-smoke 結果 (`plan/feedback/sprint-N/_smoke.json`) | [`evaluator-pre-smoke.md`](../agents/evaluator-pre-smoke.md) | [`evaluator-pre-smoke.md`](../agents/evaluator-pre-smoke.md) 本文の出力スキーマ節 |
| 集約 feedback (`plan/feedback/sprint-N.json` / `final.json`) | [`evaluator-aggregator.md`](../agents/evaluator-aggregator.md) | **本ファイル**のスキーマに完全準拠 |

本ファイルの 集約スキーマは Phase D 以降 **evaluator-aggregator のみが書く** (Phase D 前は legacy Evaluator が直接書いていた)。orchestrator (Step 6) が読む入力スキーマは Phase D 前後で不変 — 差分は「生成主体」のみ。

aggregator が集約計算 (per-AC min 集約・回帰スコア確定・risk_score 再計算・blocker 伝搬) を行う詳細は [`evaluator-aggregator-output-spec.md`](evaluator-aggregator-output-spec.md) を参照。

集約 JSON を `plan/feedback/sprint-N.json` または `plan/feedback/final.json` に書き出す**直前に必ず本ファイルを Read** すること。Partial read (`head -100` 等) も禁止。

## 完全スキーマ例（pass / fail 時）

```json
{
  "sprint": "Sprint N",
  "mode": "intermediate",
  "verdict": "pass | fail | blocked",
  "blocker": null,
  "evaluated_at": "2026-04-30T12:34:56+09:00",
  "scores": {
    "feature_completeness": 4,
    "operational_stability": 4,
    "ui_ux": 3,
    "error_handling": 3,
    "no_regression": 5
  },
  "thresholds_met": {
    "feature_completeness": true,
    "operational_stability": true,
    "ui_ux": true,
    "error_handling": true,
    "no_regression": true
  },
  "smoke_tests": [
    {"category": "UI", "tool": "mcp__playwright__browser_navigate", "attempted": true, "success": true, "error": null},
    {"category": "API", "tool": "curl", "attempted": true, "success": true, "error": null}
  ],
  "tests_run": [
    {"type": "playwright", "file": "e2e/sprint-final.spec.ts", "passed": 6, "failed": 0},
    {"type": "unit", "file": "<SUT root>/<test source path>", "passed": 12, "failed": 0},
    {"type": "compile", "file": "<SUT root>/<entity source path>", "passed": 1, "failed": 0, "new_diagnostics": 0, "note": "<build command> SUCCESS"}
  ],
  "evidence": {
    "html_report": "evidence/html/index.html",
    "attachments_root": "evidence/",
    "ac_coverage": [
      {"ac_id": "AC-1", "category": ["UI"], "verification_method": "playwright_test", "attachments_dir": "evidence/sprint-N-AC-K-TC-AC-K-S1-...", "file_count": 3},
      {"ac_id": "AC-2", "category": ["UI", "DB"], "verification_method": "playwright_test", "attachments_dir": "evidence/sprint-2-AC-2-TC-AC-2-...", "file_count": 5},
      {"ac_id": "AC-3", "category": ["API"], "verification_method": "playwright_test", "attachments_dir": "evidence/sprint-2-AC-3-TC-AC-3-...", "file_count": 2}
    ]
  },
  "impact_surface": {
    "files_changed": ["<SUT root>/<entity source>", "<list view template>", "<form view template>"],
    "layers_touched": ["<source layer>", "<view layer>"],
    "public_api_changed": false,
    "schema_changed": false,
    "auth_changed": false,
    "transaction_boundary_changed": false
  },
  "loop_metrics": {
    "iteration": 1,
    "files_edited_3_or_more_times": []
  },
  "risk_flags": {
    "hard_rule_hit": [],
    "soft_signals": []
  },
  "risk_score": 0,
  "findings": [
    {"id": 1, "fix_target": "implementation", "severity": "minor", "summary": "...", "repro": "...", "ac_id": "AC-3"},
    {
      "id": 2,
      "fix_target": "test_spec",
      "ac_id": "AC-2",
      "spec_file": "e2e/sprint-N/AC-K.spec.ts",
      "issue_type": "test-isolation",
      "summary": "PREFIX が他 AC と衝突し strict mode violation",
      "current_code": "page.locator('tr').filter({hasText: 'e2e-ac-2'})",
      "suggested_fix": "PREFIX に Date.now() を含めユニーク化"
    },
    {
      "id": 3,
      "fix_target": "review-only",
      "category": "security",
      "severity": "info",
      "summary": "<list view template>:<line> は <escaped html directive> のため XSS は防御済み (review only)",
      "evidence": "<list view template>:<line>"
    }
  ],
  "regressions": []
}
```

## halt（`verdict: "blocked"`）時のスキーマ例

検証手段が実行不能・本ファイルの禁止事項を破らないと完遂できない異常事態に遭遇したら、`verdict: "blocked"` を返す。`scores` / `evidence` / `tests_run` は**実施できた範囲のみ**記録（嘘や空欄補完を書かない。実施できていない項目は省略してよい）。

```json
{
  "sprint": "Sprint N (final)",
  "mode": "final",
  "verdict": "blocked",
  "blocker": {
    "reason": "MCP の Playwright ブラウザ（chrome-for-testing）が未インストールで browser_navigate が失敗",
    "attempted_recovery": [
      "ls <Playwright browser cache dir> で chromium バイナリの存在を確認したが MCP が要求するのは chrome-for-testing",
      "MCP --browser chrome を試行 → <system browser binary path> が無く失敗"
    ],
    "human_decision_needed": "次のいずれかを選択: (a) postCreate で chrome-for-testing をインストール / (b) .mcp.json の executable-path を <chromium installation tag> に固定 / (c) 別環境で再実行",
    "would_violate_if_proceeded": [
      "evaluator-per-ac.md「禁止事項」: UI 検証を curl の HTML パースで代替してはならない (検証手段の格下げ禁止)",
      "CLAUDE.md「halt プロトコル」一般則: 必須ツールが起動できないなら halt する"
    ]
  },
  "evaluated_at": "2026-04-30T12:34:56+09:00",
  "tests_run": [
    {"type": "compile", "file": "...", "passed": 1, "failed": 0, "new_diagnostics": 0}
  ],
  "evidence": {"dir": "", "count": 0, "ac_coverage": []},
  "impact_surface": {"files_changed": [], "layers_touched": [], "public_api_changed": false, "schema_changed": false, "auth_changed": false, "transaction_boundary_changed": false},
  "loop_metrics": {"iteration": 1, "files_edited_3_or_more_times": []},
  "risk_flags": {"hard_rule_hit": [], "soft_signals": []},
  "risk_score": 0,
  "findings": [],
  "regressions": []
}
```

## フィールドの埋め方

- `sprint`: intermediate では `"Sprint N"`、final では `"Sprint N (final)"` または `"Final"`。
- `mode`: `"intermediate"` または `"final"`。**必須**。動作モード表に従い起動時に決定。
- `verdict`: `"pass" | "fail" | "blocked"`。
  - `"pass"`: 全 thresholds met かつ AC 充足
  - `"fail"`: AC 未充足・閾値未達（Generator retry で解消可能）
  - `"blocked"`: 検証手段不能・禁止事項違反でしか進めない・必須入力欠落（halt）
- `blocker`: `verdict == "blocked"` で**必須 4 項目**（`reason` / `attempted_recovery` / `human_decision_needed` / `would_violate_if_proceeded`）を全て記述。それ以外は `null`。
- `scores`: 1〜5 整数。**閾値は `.claude/references/evaluator-aggregator-output-spec.md` の「スコア」節および workflow `pge-sprint-cycle.js` の Step 6 routing を一次資料とする** (旧 pge-dev/SKILL.md「完了条件」表は廃止・workflow JS の verdict + next_action routing が現用)。
- `thresholds_met`: 各 score が閾値以上かを真偽値で記録。
- `tests_run`: 実行したテストの記録。**空配列は不可**（テスト未実行は不合格扱い）。intermediate は unit/integration/curl 主体、final は Playwright `e2e/sprint-final.spec.ts` 必須。
- `tests_run[*].new_diagnostics`: `type == "compile"` でのみ任意。新規発生 warning / error 件数。Generator の `plan/progress.md`「IDE diagnostic 確認」と突合、不一致は feedback `.md` に明記。**Evaluator は記録のみ・修正禁止**。
- `evidence.html_report` (Phase X3): Test Runner HTML reporter のパス (`evidence/html/index.html`・SUT root 相対)。人間レビューの主成果物。
- `evidence.attachments_root` (Phase X3): Test Runner の outputDir (`evidence/`・SUT root 相対)。aggregator は移管せず、ここを直接「最終 evidence」とする。
- `evidence.ac_coverage` (Phase X2 改修): AC ごとの実 enumerate 結果。intermediate は当該スプリント AC のみ、final は spec.md **全 AC 網羅必須**。`ac_id` は spec.md の **`AC-N` ハイフン付き表記をそのまま転記**。
- `evidence.ac_coverage[*].attachments_dir` (Phase X3): 実在する `evidence/<test-name>/` ディレクトリのパス (SUT root 相対・`cd <SUT root> && find evidence -type d` で取得)。
- `evidence.ac_coverage[*].file_count` (Phase X2): `find {attachments_dir} -type f | wc -l` の結果。final mode で全 AC が 1 以上であることが必須。
- `evidence.ac_coverage[*].category`: spec.md カテゴリタグ配列。
- `evidence.ac_coverage[*].verification_method`: 該当 AC の検証手段名 (`"playwright_test"` / `"curl"` / `"bash"` / `"playwright_test+bash"` 等)。**category と整合しなければ「手段格下げ」でやり直し**。
- `smoke_tests`: Step 2.5-B 結果。`category` / `tool` / `attempted` / `success` / `error`。spec.md に `[UI]` AC があれば `category: "UI"` エントリ必須。
- `impact_surface`: 変更ファイル・レイヤ・公開 API / schema / auth / transaction 境界変更有無。Generator progress.md + `git diff` から客観的判定。`plan/research/latest.md` §4-1 Modified Files Plan と突合し乖離を `risk_flags.soft_signals` に記録。
- `loop_metrics`: ループ反復回数。同一ファイル 3 回以上編集なら `files_edited_3_or_more_times` 列挙。
- `risk_flags.hard_rule_hit`: SKILL.md Hard escalation rules 該当項目列挙（`"schema_change"` / `"auth_change"` / `"public_api_change"` 等）。
- `risk_flags.soft_signals`: Soft escalation rules 該当項目列挙。**ラベルは「閾値名 + 実数」形式** (M4・Phase Z-1 規約):
  - 件数系: `"files_changed_<N>"` (実 N) / `"layers_touched_<N>"` (実 N) / `"new_diagnostics_<N>"` (実 N) / `"same_file_edited_<N>_times"` (実 N) — 閾値名のみ (`"3_files_changed"` 等) は**禁止**。実数を末尾に書き、reviewer が件数を一目で読めるようにする
  - boolean 系: `"tests_not_run"` / `"impact_surface_missing"` / `"modified_files_plan_drift"` / `"generator_scope_creep"` 等 — 真偽値の signal は実数不要
  - 閾値超過の signal は実数ラベルだけでなく、`risk_score` 加点条件 (SKILL.md Soft escalation rules) の閾値判定にもそのまま使う (3 ファイル以上で +1・2 レイヤ以上で +2 等)。実数 N が閾値未満なら soft_signals に**含めない** (件数ゼロを含めて余計に列挙しない)
  - `new_diagnostics > 0` のとき `"new_diagnostics_<N>"` 必須
- `risk_score`: SKILL.md Soft escalation rules 加点表に従い算出した整数 (0〜10)。

### Phase X1: findings[] 一軸統合 (fix_target 軸)

aggregator は per-AC artifact 群を集約する際、すべての failure / observation を **`findings[]` 一配列** に統合する。orchestrator は Step 6-C で `fix_target` で switch するだけ:

| `fix_target` | 意味 | routing 先 |
|---|---|---|
| `"implementation"` | 実装 (application code) の bug | Generator retry |
| `"test_spec"` | `.spec.ts` 側の bug | per-AC Evaluator 再生成モード (`ac_id` で対象指定) |
| `"infrastructure"` | 環境 / config / data isolation 問題 | orchestrator 対応 or 人間 escalate (`fix_param` で対象明示) |
| `"review-only"` | cross-cutting concern (security / performance / maintainability) で fix 不要だが要 review | severity ≥ major → Expert-Reviewer 起動 |

aggregator は以下を強制する:

- ❌ `.spec.ts` の問題に `fix_target: "implementation"` を付けない (Generator に丸投げ → 永久放置)
- ❌ 実装 bug に `fix_target: "test_spec"` を付けない
- ❌ 旧 schema (`bugs[]` / `test_spec_issues[]` / `infrastructure_issues[]`) を出力しない (Phase X1 で統合済み)
- ❌ 分類不明だから implementation にまとめる、は不可

詳細は [`evaluator-aggregator-output-spec.md`](evaluator-aggregator-output-spec.md) と [`evaluator-per-ac-feedback-schema.md`](evaluator-per-ac-feedback-schema.md) を参照。

### Phase Z4-S2: findings[] entry の `failure_mode_signal` field (Test Runner error からの runtime-based 分類)

aggregator は **Test Runner (`results.json` / bash exit-code+log) の error を deterministic regex で 5 値分類**し、findings[] entry に `failure_mode_signal` を付与する (optional field・unclassified 時は省略可)。**既存 `fix_target` (code review-based 分類) と補完関係**で、orchestrator は dispatch routing 時に両軸を参照する。

#### `failure_mode_signal` 5 値 enum (project 非依存)

| value | 検出 pattern (Test Runner error regex) | 並走する `fix_target` |
|---|---|---|
| `"test_script_bug"` | Playwright `strict mode violation` / `Test timeout of \d+ms exceeded` / `locator.* expected to be visible` で DOM 構造 mismatch (selector design 不備) / bash `grep -c PREFIX` 衝突 | `"test_spec"` |
| `"spec_violation"` | `expect(received).toBe(expected)` 値不一致 / 期待 HTTP status mismatch / `.design.expected_failures[]` literal が実行出力に存在しない / bash `assert-grep` の expected literal mismatch | `"implementation"` |
| `"environment_failure"` | `EADDRINUSE` / `Browser launch failed` / `Page closed` (test 開始前) / `Connection refused` / shell `exit 127` (command not found) | (blocked 伝搬・retry 不能) |
| `"data_unavailable"` | per-AC が halt した `blocker.reason: "route-not-in-route-map"` / `capability-not-available: ...` / `required-input-missing: ...` を継承 | (blocked 伝搬・retry 不能・前段 Step 戻し) |
| `"unclassified"` (or 省略) | 上記いずれの regex にも合致しない | 既存 `fix_target` で routing (fallback) |

#### 分類 regex の generic 遵守

regex は **Playwright / Node.js / bash の standard error message のみ**を pattern とする。project 固有値 (URL / entity 名 / FQCN 等) を pattern に書かない (agnostic-auditor が検出する)。

#### findings[] entry schema (failure_mode_signal 追加版)

```json
{
  "id": 4,
  "fix_target": "implementation",
  "failure_mode_signal": "spec_violation",
  "severity": "major",
  "ac_id": "AC-K",
  "summary": "...",
  "repro": "...",
  "evidence_excerpt": "Test Runner error 抜粋 (regex で分類した literal)",
  "classification_evidence": {
    "matched_pattern": "expect(received).toBe(expected)",
    "source": "evidence/results.json | evidence/AC-K-result.log",
    "deterministic": true
  }
}
```

| field | 必須性 | 説明 |
|---|---|---|
| `failure_mode_signal` | optional | 5 値 enum。Test Runner error 由来の分類のみ付与。code review-based finding (per-ac が事前に出した) には付けない |
| `evidence_excerpt` | `failure_mode_signal` 付与時必須 | Test Runner error の literal 抜粋 (300 char 以内) |
| `classification_evidence.matched_pattern` | `failure_mode_signal` 付与時必須 | 分類に使った regex pattern 自体 |
| `classification_evidence.source` | `failure_mode_signal` 付与時必須 | 抜粋元 file path (relative) |
| `classification_evidence.deterministic` | `failure_mode_signal` 付与時必須 | regex で確定したら `true`・LLM 推論が混入したら `false` (基本 true) |

#### dispatch 補正 rule (orchestrator 側責務)

orchestrator は Step 6 で `findings[]` を読む際:

1. 1 件でも `failure_mode_signal in ["environment_failure", "data_unavailable"]` → 全体 `blocked` 伝搬 (retry 経路に乗せない)
2. `failure_mode_signal == "test_script_bug"` の finding → 該当 AC を per-ac regen (既存 `fix_target: "test_spec"` 経路と同じ)・per-ac task description に `failure_mode_signal` を渡す
3. `failure_mode_signal == "spec_violation"` → Generator retry (既存 `fix_target: "implementation"` 経路と同じ)
4. `failure_mode_signal == "unclassified"` (or 省略) → 既存 `fix_target` で routing (fallback)

詳細 (Step 6 内 routing 実装) は `.claude/workflows/pge-sprint-cycle.js` の Step 6 (Escalation 判定) 節を参照。

## evidence の検証 (Phase X2)

| モード         | 必須要件                                                        |
| -------------- | --------------------------------------------------------------- |
| intermediate   | `evidence.ac_coverage[]` が当該スプリント AC を網羅・各 AC の `file_count >= 1` (Playwright Test が成功して attachments が生成された証拠) |
| final          | `evidence.ac_coverage[]` が spec.md の**全 AC を網羅**・**各 AC の `file_count >= 1`** (厳格適用・例外なし)・`evidence.html_report` が存在 |

## ac_coverage の網羅範囲（モード別）

| モード         | 網羅対象                            |
| -------------- | ----------------------------------- |
| intermediate   | 当該スプリントの AC のみ            |
| final          | spec.md の**全 AC**（網羅必須）     |

## 禁止事項

- `confidence` / `looks_good` / `i_think_its_fine` 等の主観フィールドを追加しない
- スキーマに無いフィールドを勝手に追加しない
- JSON 以外の文字列を `.json` ファイルに含めない（純粋な JSON のみ）
- `mode` フィールド省略は無効としてオーケストレータが差し戻す
- **diagnostic を Evaluator が能動的に修正しない** — 観測・記録のみ（修正は Generator）
- **検証手段が実行不能なとき独断で curl・HTML パース等に格下げしない** — `verdict: "blocked"` で halt
- `verdict: "blocked"` で自己擁護フィールド (`verdict_blocked_but_actually_passed` 等) や嘘の `evidence` / `tests_run` を足さない
- **観測点・データ作成戦略・operation シーケンスを `plan/test-design/contracts/` (Step 4.5 deterministic contracts) と per-AC `design.*` fields の範囲外で発明しない**（基本原則 8 と整合・旧 `plan/test-design.md` は Phase Z1+Z2 で廃止済）
- **`plan/test-investigation/` から独自に観測点や戦略を導出しない** — test-investigation は補助情報、`plan/test-design/contracts/` と per-AC `design.*` fields が正典
