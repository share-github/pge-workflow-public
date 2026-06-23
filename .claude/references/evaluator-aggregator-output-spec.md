# Evaluator-Aggregator: 出力スキーマと結合規約

`evaluator-aggregator.md` が参照する **集約 JSON テンプレ・集約計算規約・`e2e/sprint-final.spec.ts` 結合規約** の一次資料 (D-4: MD 廃止以降 JSON only)。

aggregator が `plan/feedback/sprint-N.json` または `plan/feedback/final.json` を書き出す**直前に必ず Read** すること。Partial read 禁止。

**Phase X3 以降の path 規約**: Test Runner (Playwright / pytest / JUnit / Go chromedp 等) が自動収集する **`<SUT root>/evidence/<test>/`** ディレクトリ群を**最終 evidence** として扱う。`<SUT root>` の定義は SKILL.md「SUT root と PGE workspace root の関係」節。旧 `test-results/` パスは Phase X3 で `evidence/` に統合 (Test Runner config の `outputDir` 再設定で実現・mv 操作なし・Phase X2 の drift 排除原則維持)。`evidence/by-ac/` および `e2e/artifacts/` ディレクトリは Phase X2 で廃止 (per-AC が予想ベースで evidence パスを書く問題と mv 経路不整合の構造的排除)。intermediate モードと final モードで evidence 規約に差をつけない。

## 出力ファイル一覧（モード別）

| モード | 構造化 JSON | e2e spec.ts | evidence 整列 | 人間可読 MD |
|---|---|---|---|---|
| intermediate | `plan/feedback/sprint-N.json` | **生成しない** | **しない** (Phase X2 で廃止) | **しない** (D-4 で廃止) |
| final + pass | `plan/feedback/final.json` | `e2e/sprint-final.spec.ts` を結合生成 | **しない** (Phase X2 で廃止) | **しない** (D-4 で廃止) |
| final + fail/blocked | `plan/feedback/final.json` | **生成しない** | **しない** (Phase X2 で廃止) | **しない** (D-4 で廃止) |

## 入力一覧

aggregator が読む必須入力:

1. `plan/spec.md` — 全 AC 一覧・全カテゴリタグ・最大スプリント番号
2. `plan/progress.md` — Generator の引き渡し事項・実装ファイル一覧・起動コマンド
3. `plan/test-design/contracts/` — Step 4.5 deterministic contracts (isolation_contract.json / multiplicity_hint.json) — 整合チェックの根拠 (旧 `plan/test-design.md` は Phase Z1+Z2 で廃止済)
4. `plan/feedback/sprint-N/AC-K.json` — per-AC scope の中間 artifact 群（`scope == "per-ac"`）
5. `plan/feedback/sprint-N/_smoke.json` — pre-smoke 結果（後述）
6. `plan/feedback/sprint-N/AC-K.json` の `self_execution_result` — **Phase Z5: per-AC self-execution 結果 (一次集約源)** — Test Runner JSON 実行結果・exit_code・stderr・tests_run_local[] を含む (旧 `evidence/results.json` の代替)
7. `<SUT root>/evidence/AC-K/test-results/` — per-AC Playwright Test Runner artifacts (screenshot/trace/video・Phase Z5 per-AC 分離出力)
8. `plan/research/latest.md` の §4-1 Modified Files Plan — `modified_files_plan_drift_*` 判定材料
9. `git diff --name-only HEAD~1 HEAD` — `loop_metrics` / `impact_surface` 観測

**Phase Z5 変更点**: `<SUT root>/evidence/results.json` (旧 Test Runner JSON reporter の直接読み取り) は廃止。orchestrator が 5-B-5 で batch 実行していた時代の artifact。Phase Z5 以降は per-AC が `self_execution_result` に同等情報を格納し、aggregator はそれを読む。`evidence/results.json` が残存しても aggregator は参照しない。

## 集約 JSON スキーマ（既存 evaluator-feedback-json-schema.md と完全互換）

集約 JSON は **既存 `evaluator-feedback-json-schema.md` のスキーマをそのまま満たす**。orchestrator (Step 6) が読む入力ファイル名・スキーマは不変。差分は「生成主体が evaluator-aggregator になった」点のみ。

スキーマ完全例は [`evaluator-feedback-json-schema.md`](evaluator-feedback-json-schema.md) を参照。本ファイルでは aggregator が**どう値を計算するか**のみ記述する。

### フィールド別の集約計算規約

| フィールド | 計算方法 |
|---|---|
| `sprint` | orchestrator から伝達された値を転記 |
| `mode` | orchestrator から伝達された値を転記 |
| `verdict` | per-AC の最悪値: `blocked` > `fail` > `pass`。pre-smoke が失敗していたら無条件 `blocked` |
| `blocker` | `verdict == "blocked"` のとき必須。per-AC の `blocker` を全列挙して **`reason` フィールドに「N 件の per-AC blocker」と要約し `attempted_recovery` に各 AC の reason を箇条書きで列挙**。`human_decision_needed` は全 AC の選択肢を統合。`would_violate_if_proceeded` も union。pre-smoke 起因の blocked なら `_smoke.json` の blocker をそのまま転記 |
| `evaluated_at` | aggregator 実行完了時刻（ISO8601） |
| `scores.feature_completeness` | per-AC `scores_local.feature_completeness` の **min** (最も厳しい AC) |
| `scores.operational_stability` | 同上 (min) |
| `scores.ui_ux` | 同上 (min) |
| `scores.error_handling` | 同上 (min) |
| `scores.no_regression` | aggregator が確定（後述「回帰スコア確定アルゴリズム」） |
| `thresholds_met` | 集約 `scores` の各値が SKILL.md「完了条件」表の閾値以上かを真偽値で記録 |
| `smoke_tests[]` | `_smoke.json` の `smoke_tests[]` を **そのまま転記**（再実行禁止） |
| `tests_run[]` | per-AC の `self_execution_result.tests_run_local[]` を **連結** — Phase Z5 では `evidence/results.json` から読まず per-AC JSON を一次源とする (`{type: "playwright", file: "e2e/sprint-N/AC-K.spec.ts", passed, failed, duration_ms, exit_code}` 形式で per-AC が格納済み) |
| `evidence.dir` | **使用しない** (Phase X2 で廃止)。`evidence` schema は `html_report` / `attachments_root` / `ac_coverage[]` のみ |
| `evidence.count` | per-AC `evidence_local.count` の合計 + aggregator が移管したファイル数 |
| `evidence.ac_coverage[]` | per-AC の `evidence_local.ac_coverage[]` (各 per-AC が単一エントリ) を **連結** |
| `impact_surface.files_changed` | per-AC `impact_surface_local.files_changed` の **union** + `git diff --name-only` で観測した差分の **union** |
| `impact_surface.layers_touched` | per-AC `impact_surface_local.layers_touched` の **union** |
| `impact_surface.public_api_changed` 他 boolean | per-AC のいずれかが `true` なら `true`（OR 集約） |
| `loop_metrics.iteration` | spec.md / progress.md の現スプリント反復回数 |
| `loop_metrics.files_edited_3_or_more_times` | `git log --name-only HEAD~10..HEAD` で同一ファイル 3 回以上編集を検出 |
| `risk_flags.hard_rule_hit[]` | per-AC `risk_flags_local.hard_rule_hit` の **set union** + aggregator 観測（schema_change / auth_change 等のクロス AC 判定）|
| `risk_flags.soft_signals[]` | per-AC `risk_flags_local.soft_signals` の **set union** + aggregator 観測。**ラベルは「閾値名 + 実数」形式** (M4 規約): `"files_changed_<N>"` / `"layers_touched_<N>"` / `"new_diagnostics_<N>"` / `"same_file_edited_<N>_times"` (実 N 必須・閾値名のみ禁止)。boolean signal は `"tests_not_run"` / `"impact_surface_missing"` / `"modified_files_plan_drift"` / `"generator_scope_creep"` 等そのまま |
| `risk_score` | SKILL.md「Soft escalation rules」加点表に従い算出（0〜10 整数）|
| `findings[]` (Phase X1) | per-AC `findings[]` を **連結**し、`id` を 1 から全体再番号する。`fix_target` 別の追加フィールド (`repro` / `spec_file` / `issue_type` / `current_code` / `suggested_fix` / `fix_param` / `category` / `evidence`) は per-AC のまま保持。aggregator は **再分類しない** (per-AC が分類した結果を信頼)。aggregator 自身が cross-cutting grep で検出した review-only も追加する (security/performance checklist) |
| `regressions[]` | per-AC `regressions_local[]` を **連結** + smoke regression observations を加える |

### `scores.feature_completeness` 系を min で集約する根拠

「全 AC 充足」が必要なため、最も低い AC のスコアが全体を律速する。average を取ると一部 AC が低くても他が高いと見せかけの平均が高くなり、本来 fail とすべきスプリントを pass に上げてしまう。**min は厳格化のための保守的な選択**。

## 回帰スコア確定アルゴリズム（`scores.no_regression`）

`scores.no_regression` は per-AC では確定できない (どの AC も「他 AC を壊しているか」を単独判定できないため)。aggregator が以下のルールで算出する:

1. **pre-smoke が失敗 (= `_smoke.json` の `smoke_tests[].success: false`)**: 既存機能が壊れているのでスコア **1**
2. **per-AC の `regressions_local[]` がいずれも空 + pre-smoke 成功**: スコア **5**
3. **per-AC の `regressions_local[]` に minor 系 (UX 軽微・cosmetic) のみ列挙されている**: スコア **4**
4. **per-AC の `regressions_local[]` に major 系 (機能破壊) が 1 件以上**: スコア **2**
5. **その他の中間ケース (3-4 にまたがる場合)**: スコア **3**

SKILL.md「完了条件」表で `no_regression` は閾値 5 (完全) を要求するため、4 以下なら不合格となる。

## halt 伝搬規則

per-AC の `verdict == "blocked"` が 1 件でも検出されたら、aggregator は**全体を blocked 伝搬する**。理由:

- 個別 AC の検証手段不能・観測点ミスマッチは Generator retry では解消できない
- 1 AC blocked のまま全体 pass を出すと、後段で AC 数の整合性が崩れる
- 早期に人間判断に上げる方が安全

例外: `blocker.reason` が `"test-design-mismatch"` を含む per-AC blocker は **Test-Designer 戻し** ルートに乗せる。aggregator は集約 JSON の `blocker.reason` に `"test-design-mismatch"` キーワードを保持し、orchestrator (Step 6-A-0) がそれを検出して Test-Designer に戻す。

## 人間可読 MD のテンプレ (D-4 規約で廃止・参考のみ残置)

⚠️ **D-4 規約以降、aggregator は MD を生成しない**。理由:

- 人間は HTML reporter (pge-report.py 経由) を読む。MD を直接読まない (実態調査で確認)
- pge-report.py の `parse_feedback_narrative` / `parse_bug_table` は JSON 直読に置き換え済み
- LLM consumer (Generator retry / Expert-Reviewer) は JSON 構造化 fields を直接参照する方が確実
- MD 生成は aggregator LLM 推論で 3-4 分を消費するホットスポット → 廃止で aggregator 6 分 → 2-3 分

下の MD テンプレは**過去の参考**として残置するが**実行時は使われない**。新規 retry 経路や Expert-Reviewer feedback の追加検討時は JSON schema 側 (`evaluator-feedback-json-schema.md`) を拡張する。

---

(以下は historical template・aggregator は生成しない・人間が MD 形式で見たい場合の保険として外部 script で再生成可能):

aggregator が出力する `sprint-N.md` または `final.md` のフォーマット:

```markdown
# Sprint [N] 評価結果 (集約)

**判定:** 合格 / 不合格 / blocked
**評価日:** [aggregator 実行時刻]
**評価対象:** Sprint [N] - [テーマ]
**モード:** intermediate / final

## 集約サマリ

| 項目 | 値 |
|---|---|
| per-AC subagent 起動数 | N 件 |
| per-AC verdict 内訳 | pass: X / fail: Y / blocked: Z |
| Playwright Test 実行 | 全 M テスト・passed L・failed K |
| pre-smoke | success / failed |
| risk_score | X / 10 |
| hard_rule_hit | [...] |

## スコア (per-AC min 集約 + no_regression は aggregator 確定)

閾値・完了条件の正典は `.claude/workflows/pge-sprint-cycle.js` Step 6 routing (verdict + next_action 機械判定) および `.claude/agents/expert-reviewer.md` 「起動条件」節 (Hard/Soft escalation rules) を参照 (旧 pge-dev/SKILL.md「完了条件」表は廃止)。

| 基準 | 集約スコア | 判定 | 律速 AC |
|---|---|---|---|
| 機能完全性 | X/5 | PASS/FAIL | AC-K |
| 動作安定性 | X/5 | PASS/FAIL | AC-K |
| UI/UX品質 | X/5 | PASS/FAIL | AC-K |
| エラーハンドリング | X/5 | PASS/FAIL | AC-K |
| 回帰なし | X/5 | PASS/FAIL | (aggregator 確定) |

## AC 別 verdict 一覧

| AC ID | カテゴリ | verdict | 律速項目 | per-AC artifact |
|---|---|---|---|---|
| AC-1 | [UI] | pass | - | `feedback/sprint-N/AC-1.json` |
| AC-2 | [UI, DB] | fail | feature_completeness=2 | `feedback/sprint-N/AC-2.json` |
| ... | | | | |

## Playwright Test 実行結果

| Test | Status | Duration | Artifacts |
|---|---|---|---|
| TC-AC-1 | passed | 1.2s | `evidence/<test attachment dir>/...` (SUT root 相対) |
| TC-AC-2 | failed | 3.4s | `evidence/AC-<K>/...` (screenshot/trace) |

## Findings 一覧 (全 AC 横断・fix_target 別に分類表示)

aggregator は **`findings[]` を fix_target 別にグルーピング**して MD に書く。混在禁止 (Phase X1):

### Generator への指示 (`fix_target: "implementation"`)

| # | 起源 AC | severity | 内容 | 再現手順 |
|---|---|---|---|---|
| 1 | AC-2 | major | AC-2 で空文字 `<field>` が null 変換されない | POST `<create route>` に `<field>=""` → ... |

### Per-AC Evaluator への再生成指示 (`fix_target: "test_spec"`)

orchestrator が Step 6-C で対象 AC の per-AC Evaluator を再生成モードで再起動する一次データ。

| # | 起源 AC | issue_type | 内容 | 改訂案 |
|---|---|---|---|---|
| 1 | AC-2 | test-isolation | PREFIX が他 AC と衝突して strict mode violation | PREFIX に Date.now() を含めユニーク化 |

### Orchestrator 対応事項 (`fix_target: "infrastructure"`)

| # | fix_param | 内容 | 改訂案 |
|---|---|---|---|
| 1 | playwright_config | workers=auto で <in-memory store primitive> contamination | workers=1 に降格 or app 側 per-test schema |

### Review 観点 (`fix_target: "review-only"`・cross-cutting concern・Phase W 統合)

severity ≥ major のものは Expert-Reviewer 起動 trigger。

| # | category | severity | 内容 | evidence |
|---|---|---|---|---|
| 1 | security | minor | <list view template>:<line> は <escaped html directive> で XSS 防御済み (review-only) | <list view template>:<line> |
| 2 | performance | major | `<Repository>.<entity-list method>` がループ内呼び出し (N+1 候補) | `<SUT root>/<controller source>:<line>` |

## 回帰 (regressions)

| # | 観測元 (AC or smoke) | 重要度 | 内容 |
|---|---|---|---|
| 1 | smoke | critical | <entry point screen>が 500 を返す |

## blocker 詳細 (blocked 時)

[blocked per-AC の blocker 4 項目を集約して列挙]
```

intermediate / final はテンプレを共通化。`mode` 値で differentiate するのは title と evidence dir パスのみ。

### findings[] 一軸統合の意義

aggregator は per-AC findings をそのまま連結 + ID 再番号のみ。`fix_target` で再分類しない。orchestrator も `findings[i].fix_target` で switch するだけ。cross-cutting concern (security/performance) も `fix_target: "review-only"` として同じ schema に統合され、独立 schema 追加が不要。

## `e2e/sprint-final.spec.ts` 結合規約 (final + pass 限定)

### 生成条件（必須・順に判定）

1. **必須スキップ**: `mode == "intermediate"` → 生成しない
2. **必須スキップ**: `verdict == "fail" | "blocked"` → 生成しない
3. **生成する**: `mode == "final"` かつ `verdict == "pass"` → 結合生成

### 単一ファイル制約 + test 名命名統一（L1 規約・既存 `evaluator-e2e-spec-generation.md` を継承）

- ファイル名は `e2e/sprint-final.spec.ts` **単一**
- `e2e/sprint-final-ac2.spec.ts` 等の派生ファイル化禁止
- test 名は test-design.md の TC-id と **1:1 で literal 一致** させる: `test('TC-AC-K-Sn: <test-design.md の見出し>', ...)`
  - **禁止**: suffix 省略 (`TC-AC-1` のような S 番号なし) — test-design.md に `TC-AC-K-S1` が定義されているなら spec.ts もそれを使う
  - **禁止**: 複数 scenario の merge (`TC-AC-K-S1+S2` のような統合命名) — H1 auditor mode の検査対象
  - **禁止**: 命名の混在 (同じ sprint-final.spec.ts 内で `TC-AC-1` と `TC-AC-3-S1` を混ぜる) — どちらかに統一
- リトライは同一ファイル内に `test('TC-AC-K-Sn-retry: ...')` を追記 (S 番号を保持)

### 結合アルゴリズム

1. spec.md から全 AC ID を抽出（番号順）
2. test-design.md から各 AC の TC-id 集合 (`TC-AC-K-S1`, `TC-AC-K-S2`, ...) を抽出
3. 各 AC について `e2e/sprint-N/AC-K.spec.ts` を Read
4. per-AC spec.ts の **各 `test('TC-AC-K-Sn: ...', async ({page}, testInfo) => { ... })` ブロックを 1 個ずつ**切り出す (test-design.md の TC-id 集合と 1:1 一致を確認・merge / 欠落があれば結合せず blocker 起票)
5. 切り出した test() ブロックを **単一 describe** にまとめて `e2e/sprint-final.spec.ts` に書く
6. 共通の import 文・negative observation fixture・helper は結合時に冒頭に 1 度だけ書く (Phase X2: 固定パス定数の `ARTIFACTS_DIR` は使わない・testInfo.outputPath() 経由)
7. リトライ系 (`-retry`, `-bypass-*`) があれば該当する AC の本体 test() 直後に並べる
8. **L1 整合性チェック**: 結合後に `grep -c "^  test(" e2e/sprint-final.spec.ts` の値が test-design.md の TC-id 総数と一致することを確認。一致しない場合は結合失敗として halt

### 保存先の規約 (Phase X3)

- **Test Runner が自動収集する `<SUT root>/evidence/<test>/` を最終 evidence とする** (per-AC spec.ts と sprint-final.spec.ts で完全に同じ規約)
- spec.ts 内では screenshot を `testInfo.outputPath(...)` 経由で書く (Playwright の標準 API・実行時に Test Runner の `outputDir` (Phase X3: `<SUT root>/evidence/`) 配下に自動配置される)
- **`evidence/by-ac/` / `e2e/artifacts/` を spec.ts 内で参照しない** (両ディレクトリは Phase X2 で廃止済み・再活性化禁止)

### スクリプト構造テンプレ (Phase X2 規約)

```typescript
import { test as base, expect } from '@playwright/test';

// Phase Y: negative observation fixture (per-AC と同じ規約で auto 注入)
const test = base.extend<{ negativeObservation: void }>({
  negativeObservation: [async ({ page }, use) => {
    // (fixture 本体・詳細は evaluator-spec-ts-template.md 参照)
    await use();
  }, { auto: true }],
});

test.describe('Final: 全 AC 網羅', () => {
  test('TC-AC-1-S1: [AC-1 の説明]', async ({ page }, testInfo) => {
    let stepNo = 0;
    const shot = async (label: string) => {
      stepNo++;
      const num = String(stepNo).padStart(3, '0');
      await page.screenshot({
        path: testInfo.outputPath(`${num}_${label}.png`),
        fullPage: false,
      });
    };
    // per-AC subagent が e2e/sprint-N/AC-1.spec.ts に書いた本体をここに移植
  });
  test('TC-AC-2-S1: [AC-2 の説明]', async ({ page }, testInfo) => {
    // 同上 (testInfo を引数で受け取る・testInfo.outputPath() を使う)
  });
});
```

**重要**: `const ARTIFACTS_DIR = 'e2e/artifacts/sprint-final'` のような固定パス定数を使う旧スクリプトは Phase X2 で deprecated。test_name 命名は `TC-AC-K-S1` / `TC-AC-K-S2` のように per-AC spec.ts と 1:1 対応させる (suffix 省略・統合は禁止)。

## evidence 集計規約 (Phase X3: `<SUT root>/evidence/` を最終 evidence とする・mv 廃止継続)

Phase X3 以降、Test Runner config の `outputDir` を **`<SUT root>/evidence/`** に再設定し、Test Runner が自動収集する **`<SUT root>/evidence/<test-name>/` を最終 evidence** として扱う。aggregator は実 enumerate して `evidence.ac_coverage[]` を確定するだけで、`mv` 操作は行わない。`evidence/by-ac/` ディレクトリは Phase X2 で廃止。

### evidence 集計アルゴリズム (Phase X3 必須)

aggregator は集約 JSON を書く前に **必ず以下の機械検証**を実施:

```bash
# Phase Z5: per-AC --output dir (evidence/acK/test-results) を enumerate
# ac_id_slug = AC-K を lowercase + hyphen 除去 → "acK" 形式
cd <SUT root>
for ac in $(spec.md から AC ID を抽出); do
  # Phase Z5: per-AC が --output evidence/<ac_id_slug>/test-results を使用
  ac_slug=$(echo "$ac" | tr '[:upper:]' '[:lower:]' | tr -d '-')
  attachments="evidence/${ac_slug}/test-results"
  count=$(find "$attachments" -type f 2>/dev/null | wc -l)
  # evidence.ac_coverage[].attachments_dir に per-AC 分離パスを列挙
done
```

### evidence schema (intermediate / final 共通・Phase X3)

intermediate / final で**完全に同じ schema** を使う (path drift 排除のため):

```json
"evidence": {
  "html_report": "evidence/html-report/index.html",  // Test Runner HTML reporter (SUT root 相対・Phase Z5: html-report/ に変更)
  "attachments_root": "evidence/",                   // Test Runner の outputDir 上位 (SUT root 相対)
  "ac_coverage": [
    {
      "ac_id": "AC-K",
      "category": ["UI"],
      "verification_method": "playwright_test",
      "attachments_dir": "evidence/acK/test-results",  // Phase Z5: per-AC --output dir (SUT root 相対・AC-K → acK に slug 変換)
      "file_count": 5                                   // find <dir> -type f | wc -l で実 enumerate
    }
  ]
}
```

複数 scenario (S1 / S2) を持つ AC は **`ac_coverage[]` に scenario ごとに 1 エントリ**を出す (各 scenario の evidence dir を個別に attachments_dir に書く)。S1/S2 を集約しない:

```json
"ac_coverage": [
  {"ac_id": "AC-1", "scenario": "TC-AC-1-S1", "attachments_dir": "evidence/.../TC-AC-1-S1-...", "file_count": 6},
  {"ac_id": "AC-1", "scenario": "TC-AC-1-S2", "attachments_dir": "evidence/.../TC-AC-1-S2-...", "file_count": 3}
]
```

`files[]` の冗長列挙は廃止 (`attachments_dir` で `ls` すれば直接見つかる)。

### evidence enumerate 手順 (intermediate / final 共通・Phase Z5)

verdict pass 確定前に aggregator は以下を順に実行:

1. spec.md から全 AC を抽出
2. 各 AC について `ac_id_slug` を算出 (`AC-K` → lowercase + hyphen 除去 → `acK`)
3. per-AC の `self_execution_result.tests_run_local[]` を参照して `attachments_dir: evidence/<ac_id_slug>/test-results` の存在を確認 (SUT root 相対)
4. 取得した dir 内の attachment 数を `find <dir> -type f | wc -l` で機械 enumerate
5. `evidence.ac_coverage[]` に `{ac_id, verification_method, attachments_dir, file_count}` を 1 エントリずつ追加
6. **`mv` / `cp` / `mkdir evidence/by-ac/...` は一切実行しない** (`<SUT root>/evidence/` をそのまま指す)
7. `self_execution_result` が null (verdict=blocked の blocked per-AC 等) の場合、そのエントリは `file_count: 0` で記録し `attachments_dir` は期待パスを記録 (実在しなくてもよい)

### final mode の機械チェック (Phase Z5・必須)

final mode + verdict pass の確定前に、aggregator は以下を強制:

1. spec.md の全 AC について `self_execution_result.exit_code == 0` (or per-AC verdict == pass) を確認
2. 各 AC の per-AC output dir `evidence/<ac_id_slug>/test-results/` に最低 1 ファイル存在 (`file_count >= 1`) — self-execution が実行されたことの傍証
3. いずれかの AC の output dir が空・存在しない場合は `evidence-missing-for-ac-K` として `risk_flags.soft_signals[]` に追記 (blocked にはしない・pass 条件は self_execution_result で判定)
4. intermediate モードも同じ enumerate 手順 (規約一本化)

### 人間レビューの主成果物 (Phase X3)

- **intermediate / final 共通**:
  - `<SUT root>/evidence/html-report/index.html` (Test Runner HTML reporter・trace/video 含む一次資料・Phase Z5: html-report/ sibling パス)
  - 個別 PNG / trace は `<SUT root>/evidence/<ac_id_slug>/test-results/` から直接アクセス可能 (HTML reporter からも参照される)
- `evidence/by-ac/` ディレクトリは存在しない (Phase X2 廃止)
- `pge-report.py` 系の出力は **`<SUT root>/evidence/` を読むよう既に更新済み** (Phase X3 移行)

aggregator は final.md の Evidence 節に「Test Runner HTML レポート: `evidence/html-report/index.html` (SUT root 相対)」を明記する。「整列済みエビデンス」項目は書かない。

## aggregator の禁止事項

- 独自に Playwright Test や curl を実行して **検証をやり直さない**（per-AC の verdict を信頼する。乖離があれば per-AC の test-design-mismatch として halt させる）
- per-AC が出力していない `ac_coverage` エントリを **発明しない**
- per-AC の `scores_local` を **書き換えない**（min 集約は読み取り計算）
- スキーマに無いフィールドを集約 JSON に追加しない
- `confidence` / `looks_good` 等の主観表現を含めない
- `e2e/sprint-final.spec.ts` を fail / blocked 時に生成しない
- **`evidence/by-ac/` ディレクトリを作成しない・mv しない・cp しない** (Phase X2 廃止規約)
- **`e2e/artifacts/` ディレクトリを sprint-final.spec.ts や per-AC spec.ts に埋め込まない** (Phase X2 廃止規約・testInfo.outputPath() を使う)
- final mode と intermediate mode で `evidence` schema に差をつけない (Phase X2 path drift 排除)
- per-AC が 1 件でも blocked のとき全体 pass を出さない（必ず blocked 伝搬）
- pre-smoke 失敗時に全 AC を起動して詳細を取りに行かない（orchestrator が起動前に止める設計。aggregator は `_smoke.json` を最初に検査し失敗なら他入力を無視する）
- **`findings[].fix_target` を再分類しない (Phase X1)** — per-AC が分類した結果を信頼する。混在 (`.spec.ts` 問題に `fix_target: "implementation"` 等) は per-AC schema 違反として halt させる
- **MD テンプレで fix_target 別の節を分離する (Phase X1)** — 「Generator への指示」節には `fix_target: "implementation"` のみ・「Per-AC 再生成指示」節には `fix_target: "test_spec"` のみ・「Orchestrator 対応事項」節には `fix_target: "infrastructure"` のみ・「Review 観点」節には `fix_target: "review-only"` のみ。混合禁止
- **Phase W (cross-cutting) を aggregator 側で grep 検出して `fix_target: "review-only"` で追加する** — security checklist (<unescaped html directive> 追加・SQLi concat・auth bypass・secret-looking string) + performance checklist (<entity-list method> in loop・O(N²) nested loop・synchronous I/O) を Bash + git diff で軽量実行
