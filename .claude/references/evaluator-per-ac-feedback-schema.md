# Evaluator (per-AC scope): feedback JSON スキーマ

`evaluator-per-ac.md` (Phase Z4 で `evaluator.md` mode=per-ac から独立) から参照される、**AC 単位の中間 artifact** スキーマ。aggregator が消費する一次資料であり、人間レビューを直接受けない。

per-AC JSON を `plan/feedback/sprint-N/AC-K.json` に書き出す**直前に必ず Read** すること。Partial read 禁止。

## 必須フィールド (verdict が "blocked" 以外のとき) — 出力前 self-check 対象

以下が**1 つでも欠落していたら per-AC JSON を出力してはならない** (evaluator-per-ac.md ワークフロー Step 7「出力前 self-check」で確認):

| フィールド | 必須性 | 注意 |
|---|---|---|
| `scope` / `ac_id` / `sprint` / `mode` / `verdict` / `evaluated_at` | 必須 | スキーマ識別 |
| `scores_local` (4 項目: feature_completeness / operational_stability / ui_ux / error_handling) | 必須 | `no_regression` は aggregator 専管なので含めない |
| `tests_run_local` | 必須 (空配列禁止) | per-ac が生成した spec.ts の entry を最低 1 件 |
| `evidence_local` (expected_attachments_count + ac_coverage) | 必須 | Phase X2 で簡素化済み |
| `impact_surface_local` | 必須 | 7 フィールド全て |
| `risk_flags_local` | 必須 | hard_rule_hit / soft_signals |
| `findings[]` | 必須 (空配列可) | fix_target 一軸統合 (Phase X1) |
| `regressions_local[]` | 必須 (空配列可) | 他 AC への副作用観測 |
| **`ac_operations[]`** | **必須 (空配列禁止・各 entry に `step` / `summary` (日本語) / `action` / `expected` 揃え・Playwright 系のみ `locator` も必須)** | **pge-report の screenshot ポップアップ modal で日本語 summary を最上位表示する人間レビュー用データ・Phase Z2: bash 系 artifact では locator は空文字列 OK** |
| `spec_ref` | 必須 | `design_self_authored: true` 固定・`test_design_anchor: null`・`test_design_observation_points[]` は per-AC が確定した `design.observation_capabilities[]` を転記 (Phase Z2) |
| **`design`** (Phase Z2: capability composition) | **必須 (verdict が "blocked" 以外のとき)** | **evaluator が Step 0 で capability composition で確定した内容** — trigger_capabilities / observation_capabilities / artifact_framework / routes_touched / fixture_strategy / locator_specificity / data_prep / mutation_hypotheses / expected_failures / scenarios / tautology_defense_local を含む。詳細は本ファイル「per-AC design fields (Phase Z2: capability-based)」節 |
| **`test_artifact`** (Phase Z2: 必須) | **必須 (verdict が "blocked" 以外のとき)** | **evaluator が Step 6 で生成した artifact の path + runner_command + framework**。evaluator-per-ac Step 9 self-execution が dispatch に使う (Phase Z5)。詳細は本ファイル「test_artifact field (Phase Z2)」節 |
| **`self_execution_result`** (Phase Z5: 必須) | **必須 (verdict が "blocked" 以外のとき・ただし retry-exhausted-n3 の blocked 時は null)** | **evaluator-per-ac Step 9 self-execution の結果**。`exit_code` / `stdout_excerpt` / `stderr_excerpt` / `failure_mode_signal` / `classification_evidence` を含む。詳細は本ファイル「self_execution_result field (Phase Z5)」節 |
| `retry_local_metadata` (Phase Z5: 任意) | 任意 (retry が発生した場合のみ) | per-AC 内 retry loop (Step 10) の全 iteration 記録。`iteration` / `history[]` を含む |
| `escalation_context` (Phase Z5: 任意) | 任意 (retry-exhausted-n3 blocked 時のみ必須) | Step 11 escalation 準備の内容。schema の詳細は `evaluator-per-ac-retry-protocol.md` §(c) を参照 |

verdict が `"blocked"` のときのみ、`ac_operations` / `scores_local` / `tests_run_local` 等を空または null にできる (halt スキーマ例参照)。

**aggregator 側の guard**: `ac_operations[]` が空または `summary` 欠落の per-AC JSON を見つけたら cross-cutting checklist で `findings[].fix_target: "test_spec"` + `issue_type: "missing-ac-operations"` / `"missing-ac-operations-summary"` を起票し、Step 6-C で per-ac 再生成経路に乗せる (`evaluator-aggregator.md` 本文参照)。

## 用途と位置付け

```
per-AC subagent (このスキーマ) ──┐
                                 ├─→ aggregator ──→ plan/feedback/sprint-N.json
pre-smoke subagent (_smoke.json) ─┤   (既存 evaluator-feedback-json-schema.md
                                 │    に完全互換のフォーマットで出力)
Playwright Test Runner            │
  (evidence/results.json) ────────┘  (Phase X3: SUT root 相対)
```

- **per-AC は中間 artifact**。スキーマに無いフィールドがあっても aggregator が無視するだけで PGE フローには影響しない (ただし禁止事項のフィールドは追加しない)
- **集約後フィールド (smoke_tests・全体 risk_score・全体回帰スコア・全体 thresholds_met・aggregator が生成する e2e/sprint-final.spec.ts) は per-AC では出さない**。出した場合は aggregator が破棄する

## 完全スキーマ例（pass / fail 時）

```json
{
  "scope": "per-ac",
  "ac_id": "AC-K",
  "sprint": "Sprint N",
  "mode": "intermediate",
  "verdict": "pass | fail | blocked",
  "blocker": null,
  "evaluated_at": "2026-06-02T15:30:00+09:00",
  "scores_local": {
    "feature_completeness": 4,
    "operational_stability": 4,
    "ui_ux": 3,
    "error_handling": 3
  },
  "thresholds_met_local": {
    "feature_completeness": true,
    "operational_stability": true,
    "ui_ux": true,
    "error_handling": true
  },
  "tests_run_local": [
    {"type": "playwright_test_spec", "file": "e2e/sprint-N/AC-K.spec.ts", "ac_id": "AC-K", "generated": true},
    {"type": "unit", "file": "<SUT root>/<test source path>", "passed": 5, "failed": 0}
  ],
  "evidence_local": {
    "expected_attachments_count": 3,
    "ac_coverage": [
      {"ac_id": "AC-K", "category": ["UI"], "verification_method": "playwright_test"}
    ]
  },
  "impact_surface_local": {
    "files_changed": ["<SUT root>/<entity source>", "<list view template>"],
    "layers_touched": ["<source layer>", "<view layer>"],
    "public_api_changed": false,
    "schema_changed": false,
    "auth_changed": false,
    "transaction_boundary_changed": false
  },
  "risk_flags_local": {
    "hard_rule_hit": [],
    "soft_signals": ["new_diagnostics"]
  },
  "findings": [
    {
      "id": 1,
      "fix_target": "implementation",
      "severity": "minor",
      "summary": "AC-K で空文字 <field> が「-」表示されない (実装の null チェックが空文字を考慮していない)",
      "repro": "POST <create route> に <field>=\"\" → 一覧の <field> セルに空文字が出る (期待: -)",
      "ac_id": "AC-K"
    },
    {
      "id": 2,
      "fix_target": "test_spec",
      "spec_file": "e2e/sprint-N/AC-K.spec.ts",
      "issue_type": "test-isolation",
      "summary": "PREFIX 重複で複数行が match して strict mode violation",
      "current_code": "page.locator('tr').filter({hasText: PREFIX})",
      "suggested_fix": "PREFIX に Date.now() を含めユニーク化",
      "ac_id": "AC-K",
      "detected_via": "playwright_test_runner_failure"
    },
    {
      "id": 3,
      "fix_target": "infrastructure",
      "fix_param": "playwright_config",
      "summary": "Playwright workers=auto で in-memory shared state 共有による cross-test contamination",
      "suggested_fix": "playwright.config.ts で workers=1 に降格 / または app 側で per-test DB schema 分離",
      "detected_via": "self_review"
    },
    {
      "id": 4,
      "fix_target": "review-only",
      "category": "security",
      "severity": "minor",
      "summary": "<list view template> 内の <field> 表示で unescaped HTML 出力が使われていた場合 XSS 脆弱性が生じる (現状は escape 済 attribute なので OK)",
      "evidence": "<list view template>:<line>: <escaped output literal>",
      "detected_via": "self_review"
    }
  ],
  "regressions_local": [],
  "ac_operations": [
    {"step": 1, "summary": "<create form>を開く", "locator": "[data-testid=<form-id>]", "action": "navigate", "expected": "フォームが表示される"},
    {"step": 2, "summary": "<field A> に上限超過文字数を入力", "locator": "[data-testid=<input-id>]", "action": "fill", "value": "<oversize string>", "expected": "入力値が保持される"},
    {"step": 3, "summary": "<submit label> 押下", "locator": "[data-testid=<submit-id>]", "action": "click", "expected": "一覧に行が追加される (or validation エラー表示)"}
  ],
  "spec_ref": {
    "test_design_anchor": "## AC-K",
    "test_design_observation_points": ["a11y-tree: list item with text", "DB row in <table>"]
  }
}
```

## per-AC design fields (Phase Z2: capability-based composition)

**Phase Z2** で test design を **capability primitives の composition** として表現する (category dispatch ではない)。per-AC JSON に `design` field を**必須**で含める (verdict が "blocked" 以外のとき)。capability catalog は [`evaluator-test-capabilities.md`](evaluator-test-capabilities.md) (literal 引用元・絶対ルール 11)。

```json
{
  "design": {
    "schema_version": "2.0",
    "trigger_capabilities": ["T-browser-navigate"],
    "observation_capabilities": ["O-dom-content", "O-aria-tree"],
    "capability_composition_rationale": "AC 動詞「ユーザーが UI form で登録 → 一覧に表示」→ browser-navigate で trigger・dom-content + aria-tree で observe",
    "artifact_framework": "F-playwright-ts",
    "artifact_framework_rationale": "使用 capability に T-browser-navigate / O-dom-content が含まれる (Playwright 系) → catalog decision table から F-playwright-ts 機械導出",
    "routes_touched": [
      {"method": "POST", "path": "/<resource>/new", "action_id": "create", "branch": "on_success"},
      {"method": "GET", "path": "/", "action_id": "list", "branch": "on_normal_response"}
    ],
    "validation_layer": "browser",
    "fixture_strategy": {
      "strategy": "fresh-fixture-prefix",
      "prefix_or_uuid": "e2e-ac-K-${Date.now()}-${Math.random().toString(36).slice(2)}",
      "polluted_by": [],
      "polluter_of": ["AC-J"],
      "rationale": "isolation_contract.json#contracts[AC-K].reason から literal echo",
      "contract_echo": true
    },
    "locator_specificity": [
      {
        "scenario_id": "TC-AC-K-S1",
        "locator": "page.locator('<scope CSS selector from locator_catalog.json>').getByText(/<expected count pattern>/)",
        "uniqueness_evidence": "<list screen aria_snapshot.yaml で同 token が N 件出現・<scope CSS selector> は unique container>",
        "chain_scope": "<scope CSS selector from multiplicity_hint.json>",
        "multiplicity_hint_consumed": true
      }
    ],
    "data_prep": {
      "strategy": "UI walk via T-browser-navigate",
      "rationale": "api_contract_map.json に admin seed API なし・UI form 経由で entity 生成",
      "literal_steps": [
        "const PREFIX = `e2e-ac-K-${Date.now()}-${Math.random().toString(36).slice(2)}`;",
        "await page.goto(`${APP_BASE_URL}/<create route from route_map.json>`);",
        "await page.getByRole('textbox', {name: '<field label A from aria_snapshot.yaml>'}).fill('<sample value A>');",
        "await page.getByRole('textbox', {name: '<field label B from aria_snapshot.yaml>'}).fill(`${PREFIX}-<entity>`);",
        "await page.getByRole('button', {name: '<submit label from aria_snapshot.yaml>'}).click();"
      ],
      "preconditions": "アプリ起動済み・bootstrap state (TI Phase 1 で観測した bootstrap_state を引用)",
      "investigation_referenced": ["api_contract_map.json", "locator_catalog.json", "validation_rule_map.json"]
    },
    "mutation_hypotheses": [
      {"id": "M1", "description": "<Controller>.<action>() で <field> setter が呼ばれない", "detection_path": "TC-AC-K-S1 当該セルの O-dom-content 一致 assertion"},
      {"id": "M2", "description": "POST が 4xx/5xx で失敗", "detection_path": "negative observation fixture (page.on('response')) で 4xx/5xx を空 assert"}
    ],
    "expected_failures": [
      {"urlPattern": "/favicon\\.ico$/", "status": 404, "business_rationale": "ブラウザが自動取得・route_map.json に favicon エントリなし"}
    ],
    "scenarios": [
      {
        "tc_id": "TC-AC-K-S1",
        "type": "happy_path",
        "title": "<entity> 新規登録 + 一覧反映 (happy path)",
        "given": "<authenticated state>・<create form>を開いている",
        "when": "<field A> に <sample value A> を入力して <submit>",
        "then": [
          "URL: expect(page).toHaveURL(`${APP_BASE_URL}/<list route>`)",
          "O-aria-tree: getByRole('row', {name: /PREFIX/}) が存在",
          "O-dom-content: row 内の当該セルが '<sample value A>'"
        ]
      },
      {
        "tc_id": "TC-AC-K-S2",
        "type": "negative_boundary",
        "title": "<field A> 上限超過で登録失敗",
        "given": "<create form>を開いている",
        "when": "<field A> に 上限超過文字列を入力して <submit>",
        "then": [
          "フォーム再表示 (URL 不変)",
          "validation エラーメッセージ表示"
        ]
      }
    ],
    "tautology_defense_local": {
      "layer1_external_observation": {"passed": true, "notes": "available_capabilities.json で T-browser-navigate / O-dom-content / O-aria-tree 全て available 確認"},
      "layer2_mutation_hypothesis": {"passed": true, "mutation_count": 2, "all_detectable": true},
      "layer4_coverage_local": {"passed": true, "has_happy": true, "has_negative": true},
      "layer4_5_data_prep_executability": {"passed": true, "uses_literal": true, "investigation_referenced": ["api_contract_map.json", "locator_catalog.json"]},
      "layer4_7_negative_observation": {"passed": true, "expected_failures_count": 1, "all_grounded": true}
    },
    "design_self_authored": true,
    "design_log_local": [
      "AC-K: capability composition T-browser-navigate + O-dom-content + O-aria-tree で UI flow を表現",
      "AC-K: artifact_framework は Playwright 系 capability を含むため F-playwright-ts を機械導出",
      "AC-K: contract から strategy=fresh-fixture-prefix を echo・multiplicity_hint で件数チェックは <scope CSS selector> 採用"
    ]
  },
  "test_artifact": {
    "file": "e2e/sprint-N/AC-K.spec.ts",
    "runner_command": "cd <SUT root> && npx playwright test e2e/sprint-N/AC-K.spec.ts --reporter=json --output evidence/acK/test-results",
    "artifact_framework": "F-playwright-ts"
  }
}
```

### CLI 例 (capability-based・category dispatch なし)

```json
{
  "design": {
    "schema_version": "2.0",
    "trigger_capabilities": ["T-shell-command"],
    "observation_capabilities": ["O-exit-code", "O-stdout-pattern"],
    "capability_composition_rationale": "AC: '<unit test command> が exit 0 で 全件 pass' → T-shell-command で発動・O-exit-code + O-stdout-pattern で観測",
    "artifact_framework": "F-bash-script",
    "artifact_framework_rationale": "使用 capability に Playwright 系なし・bash 系のみ → catalog decision table から F-bash-script 機械導出",
    "routes_touched": [],
    "validation_layer": null,
    "fixture_strategy": {"strategy": "none", "rationale": "CLI test は stateless・PREFIX は output 比較用のみ"},
    "locator_specificity": [],
    "data_prep": {
      "strategy": "shell direct",
      "rationale": "<unit test command> を SUT root で直接起動",
      "literal_steps": [
        "PREFIX=\"e2e-ac-K-$(date +%s)\"",
        "output=$(timeout 600 <unit test command> 2>&1)",
        "exit_code=$?"
      ],
      "investigation_referenced": ["_framework.json"]
    },
    "mutation_hypotheses": [
      {"id": "M1", "description": "<unit test command> が失敗 test を含む", "detection_path": "O-exit-code が non-zero"},
      {"id": "M2", "description": "test が silent skip される", "detection_path": "O-stdout-pattern: 'Tests run: <N>' の N >= 1"}
    ],
    "expected_failures": [
      {"expected_exit_code": 0, "literal_value": "<test success marker>", "business_rationale": "<unit test command> が成功時に必ず出力する固定文字列"}
    ],
    "scenarios": [
      {"tc_id": "TC-AC-K-S1", "type": "happy_path", "title": "全 test pass", "given": "SUT に test code が存在", "when": "<unit test command> を実行", "then": ["O-exit-code = 0", "O-stdout-pattern: '<test success marker>' を含む"]}
    ],
    "tautology_defense_local": {
      "layer1_external_observation": {"passed": true, "notes": "T-shell-command / O-exit-code / O-stdout-pattern は available_capabilities.json で確認済"},
      "layer2_mutation_hypothesis": {"passed": true, "mutation_count": 2, "all_detectable": true},
      "layer4_coverage_local": {"passed": true, "has_happy": true, "has_negative": false, "notes": "CLI test の negative は exit_code != 0 で自動 catch・別 scenario 不要"},
      "layer4_5_data_prep_executability": {"passed": true, "uses_literal": true, "investigation_referenced": ["_framework.json"]},
      "layer4_7_negative_observation": {"passed": true, "expected_failures_count": 1, "all_grounded": true}
    },
    "design_self_authored": true,
    "design_log_local": ["AC-K: CLI test なので Playwright 不要・T-shell-command + O-exit-code で完結"]
  },
  "test_artifact": {
    "file": "e2e/sprint-N/AC-K.test.sh",
    "runner_command": "cd <SUT root> && bash e2e/sprint-N/AC-K.test.sh",
    "artifact_framework": "F-bash-script"
  }
}
```

### design fields の埋め方ルール (Phase Z2)

| field | 規約 |
|---|---|
| `schema_version` | `"2.0"` 固定 (Phase Z2 capability-based) |
| `trigger_capabilities[]` | `.claude/references/evaluator-test-capabilities.md#1-trigger-capabilities` の declared primitive (T-*) から 1 件以上選択・`available_capabilities.json` で available 必須 |
| `observation_capabilities[]` | `.claude/references/evaluator-test-capabilities.md#2-observation-capabilities` の declared primitive (O-*) から 1 件以上選択・`available_capabilities.json` で available 必須 |
| `artifact_framework` | `F-playwright-ts` / `F-bash-script` / `F-sql-with-bash-wrapper` のいずれか・capability catalog decision table から機械導出 (LLM 推論ではない) |
| `routes_touched[]` | HTTP 系 capability を使う場合のみ非空・`{method, path, action_id, branch}` を 1-3 件・**`path` は route_map.json#routes に存在必須**・POST/PUT/PATCH は `branch: "on_success"` or `"on_validation_error"` 必須 |
| `validation_layer` | form / API 系 capability を使う場合のみ `"browser"` / `"server"` / `"both"` / `null` から選択・他 capability では `null` OK |
| `fixture_strategy` | `isolation_contract.json` 存在時は `contract_echo: true` 必須・contract.strategy / prefix_or_uuid / polluted_by を literal echo |
| `locator_specificity[]` | Playwright 系 capability を使う場合のみ非空・`multiplicity_hint.json` で `count > 1` の token なら `chain_scope` に hint.recommended_chain_scope 採用 + `multiplicity_hint_consumed: true` 必須 |
| `data_prep.literal_steps[]` | 使用 capability に応じた literal command (Playwright operation / bash command / SQL statement)・TI Phase 2/3 artifacts を literal reference・推測禁止 |
| `mutation_hypotheses[]` | 各 entry に `id` / `description` / `detection_path`・detection_path は observation_capabilities[] のいずれかが catch する path |
| `expected_failures[]` | 使用 capability に応じた literal failure (HTTP: `{urlPattern, status, business_rationale}` / shell: `{expected_exit_code | stderr_pattern, business_rationale}` / SQL: `{sql_error_pattern, business_rationale}`)・route_map / api_contract_map 等で grounded 必須 |
| `scenarios[]` | S1 (happy) + S2 (negative) 各 1 件以上必須 (層 4 Coverage・CLI の negative は exit_code != 0 で自動 catch なので別 scenario 不要 OK)・TC-id は `TC-AC-K-Sn` 形式 |
| `tautology_defense_local` | 5 軸 (layer1/2/4/4_5/4_7) で **layer3 (mock 全体) / layer4_6 (cross-AC isolation) / layer5 (adversarial cross-AC) は aggregator が担当**・per-AC では出さない |
| `design_self_authored` | Phase Z1+Z2 で `true` 固定 |
| `design_log_local[]` | 設計判断ログ (1-3 件)・capability composition の根拠・contract echo の根拠・hint 採用理由など |

### test_artifact field (Phase Z2)

| field | 規約 |
|---|---|
| `file` | artifact のファイルパス (SUT root 相対・`e2e/sprint-N/AC-K.<ext>` 形式)・`<ext>` は artifact_framework から導出 (`.spec.ts` / `.test.sh`) |
| `runner_command` | orchestrator が bash で実行する command literal・**capability catalog `#5-runner-allowlist` の regex pattern に必ず合致**する文字列のみ・allowlist 違反は orchestrator で halt |
| `artifact_framework` | `design.artifact_framework` と同値 (orchestrator が runner 種別を識別するため redundant 出力) |

### Step 0 で design fields を確定する self-check (Phase Z2)

evaluator per-ac mode は出力前に以下を**機械検証**:

```bash
ac_json="plan/feedback/sprint-N/AC-K.json"  # K = 担当 AC の番号 / N = 現スプリント番号

# Step 0 完了時の design field 整合性 (Phase Z2 schema)
jq -e '.design.schema_version == "2.0"
       and (.design.trigger_capabilities | length) >= 1
       and (.design.observation_capabilities | length) >= 1
       and (.design.artifact_framework | IN("F-playwright-ts","F-bash-script","F-sql-with-bash-wrapper"))
       and .design.fixture_strategy
       and .design.data_prep
       and .design.scenarios
       and .design.tautology_defense_local
       and .test_artifact.file
       and .test_artifact.runner_command
       and .test_artifact.artifact_framework' \
  "$ac_json" > /dev/null || {
    echo "design / test_artifact fields incomplete" >&2; exit 1;
}

# capability が available_capabilities.json で declared か
caps_file="plan/test-investigation/phase2/available_capabilities.json"
for cap in $(jq -r '.design.trigger_capabilities[]' "$ac_json"); do
  jq -e --arg c "$cap" '.trigger[] | select(.name == $c and .available == true)' "$caps_file" > /dev/null \
    || { echo "capability not available: $cap" >&2; exit 1; }
done
for cap in $(jq -r '.design.observation_capabilities[]' "$ac_json"); do
  jq -e --arg c "$cap" '.observation[] | select(.name == $c and .available == true)' "$caps_file" > /dev/null \
    || { echo "capability not available: $cap" >&2; exit 1; }
done

# scenarios に happy が 1 件以上 (negative は capability に応じて optional)
happy_count=$(jq '[.design.scenarios[] | select(.type == "happy_path")] | length' "$ac_json")
[ "$happy_count" -ge 1 ] || { echo "scenarios: no happy_path" >&2; exit 1; }

# HTTP 系 capability を使う場合は routes_touched.path が route_map に存在
uses_http=$(jq -r '.design.trigger_capabilities[] | select(test("http"))' "$ac_json" | head -1)
if [ -n "$uses_http" ]; then
  for path in $(jq -r '.design.routes_touched[].path' "$ac_json"); do
    jq -e --arg p "$path" '.routes[] | select(.path == $p)' \
       plan/test-investigation/phase2/route_map.json > /dev/null \
      || { echo "route_map に存在しない path: $path" >&2; exit 1; }
  done
fi

# runner_command が allowlist pattern に合致 (Step 6 で artifact 生成前にも検証)
cmd=$(jq -r '.test_artifact.runner_command' "$ac_json")
echo "$cmd" | grep -qE '^cd [^;&|<>$`]+ && (npx playwright test [^;&|<>$`]+ --reporter=json|bash [^;&|<>$`]+|psql [^;&|<>$`]+ -f [^;&|<>$`]+)$' \
  || { echo "runner_command not in allowlist: $cmd" >&2; exit 1; }
```

self-check 失敗時は **Step 0 へ戻って再設計** (3 retry で halt: `json-self-check-failed`)。

## halt（`verdict: "blocked"`）時のスキーマ例

```json
{
  "scope": "per-ac",
  "ac_id": "AC-K",
  "sprint": "Sprint N",
  "mode": "intermediate",
  "verdict": "blocked",
  "blocker": {
    "reason": "data-prep-not-executable: AC-K で audit_log への書き込み観測を要求するが TI Phase 2 controller_action_map に audit_log 書き込みの action が無く、design.data_prep.literal_steps を grounded に書けない",
    "attempted_recovery": [
      "TI Phase 2 controller_action_map.json を再読 → audit_log 書き込み action なし",
      "実装の <SUT root>/<event publisher source> を確認 → outbox 書き込みを確認"
    ],
    "human_decision_needed": "次のいずれかを選択: (a) Test-Investigator 再走で audit_log action を再探索 / (b) Generator に戻して outbox 経由を audit_log に切替 / (c) AC-K の観測点を outbox に変更 (spec 修正)",
    "would_violate_if_proceeded": [
      "evaluator-per-ac.md 基本原則: 観測点を独自発明しない",
      "CLAUDE.md halt プロトコル: 入力欠落・規約違反では halt が優先"
    ]
  },
  "evaluated_at": "2026-06-02T15:30:00+09:00",
  "scores_local": null,
  "tests_run_local": [],
  "evidence_local": {"dir": "", "count": 0, "ac_coverage": []},
  "impact_surface_local": {"files_changed": [], "layers_touched": [], "public_api_changed": false, "schema_changed": false, "auth_changed": false, "transaction_boundary_changed": false},
  "risk_flags_local": {"hard_rule_hit": [], "soft_signals": []},
  "findings": [],
  "regressions_local": [],
  "ac_operations": [],
  "spec_ref": {"test_design_anchor": "## AC-K", "test_design_observation_points": []}
}
```

## Phase Z5 スキーマ例 — pass case (self_execution_result あり)

Step 9 self-execution が exit_code=0 で完了したときの per-AC JSON の `self_execution_result` および `test_artifact` 例:

```json
{
  "scope": "per-ac",
  "ac_id": "AC-K",
  "sprint": "Sprint N",
  "mode": "intermediate",
  "verdict": "pass",
  "blocker": null,
  "evaluated_at": "2026-06-13T10:30:00Z",
  "scores_local": {
    "feature_completeness": 4,
    "operational_stability": 4,
    "ui_ux": 4,
    "error_handling": 4
  },
  "test_artifact": {
    "file": "e2e/sprint-N/AC-K.spec.ts",
    "runner_command": "cd <SUT root> && npx playwright test e2e/sprint-N/AC-K.spec.ts --reporter=json --output evidence/acK/test-results",
    "artifact_framework": "F-playwright-ts"
  },
  "self_execution_result": {
    "exit_code": 0,
    "stdout_excerpt": "Running 2 tests using 1 worker\n  2 passed (8.3s)",
    "stderr_excerpt": "",
    "failure_mode_signal": null,
    "classification_evidence": null,
    "tests_run_local": [
      {"type": "playwright", "file": "e2e/sprint-N/AC-K.spec.ts", "passed": 2, "failed": 0, "duration_ms": 8300}
    ]
  },
  "retry_local_metadata": null
}
```

## Phase Z5 スキーマ例 — fail + escalation case (retry-exhausted-n3)

N=3 retry を消費しても exit_code != 0 が続いた場合 (Step 11 escalation):

```json
{
  "scope": "per-ac",
  "ac_id": "AC-K",
  "sprint": "Sprint N",
  "mode": "intermediate",
  "verdict": "blocked",
  "blocker": {
    "reason": "retry-exhausted-n3",
    "attempted_recovery": [
      "Iteration 1: locator を data-testid に変更 → strict mode violation 解消せず",
      "Iteration 2: PREFIX に Date.now() を追加 → タイムアウト 30000ms 超過",
      "Iteration 3: タイムアウト 60000ms に拡張 → locator が見つからず"
    ],
    "human_decision_needed": "(a) Generator に実装側を修正させる (b) per-AC を regen_mode で再生成する (c) spec を変更する",
    "would_violate_if_proceeded": [
      "evaluator-per-ac-retry-protocol.md: N=3 を超える local retry は禁止",
      "CLAUDE.md halt プロトコル: retry 消費済みは halt が優先"
    ]
  },
  "evaluated_at": "2026-06-13T10:45:00Z",
  "scores_local": null,
  "test_artifact": {
    "file": "e2e/sprint-N/AC-K.spec.ts",
    "runner_command": "cd <SUT root> && npx playwright test e2e/sprint-N/AC-K.spec.ts --reporter=json --output evidence/acK/test-results",
    "artifact_framework": "F-playwright-ts"
  },
  "self_execution_result": null,
  "retry_local_metadata": {
    "iteration": 3,
    "history": [
      {
        "iteration": 1,
        "exit_code": 1,
        "failure_mode_signal": "test_script_bug",
        "stderr_excerpt": "strict mode violation, 2 elements with locator...",
        "patch_applied": "locator を data-testid に変更"
      },
      {
        "iteration": 2,
        "exit_code": 1,
        "failure_mode_signal": "test_script_bug",
        "stderr_excerpt": "Test timeout of 30000ms exceeded",
        "patch_applied": "PREFIX に Date.now() を追加"
      },
      {
        "iteration": 3,
        "exit_code": 1,
        "failure_mode_signal": "test_script_bug",
        "stderr_excerpt": "Test timeout of 30000ms exceeded",
        "patch_applied": "timeout を 60000ms に拡張"
      }
    ]
  },
  "escalation_context": {
    "failed_artifact": "e2e/sprint-N/AC-K.spec.ts",
    "final_stderr": "Test timeout of 30000ms exceeded while running test hook \"beforeEach\"",
    "tried_hunks": [
      "locator を data-testid に変更",
      "PREFIX に Date.now() を追加",
      "timeout を 60000ms に拡張"
    ],
    "still_unresolved": "タイムアウト超過が続く — アプリ側応答遅延またはセレクタがレンダリング前に評価されている可能性",
    "recommended_next": "Generator に実装修正または orchestrator にインフラ調査を依頼"
  }
}
```

## フィールドの埋め方

### 識別系

- `scope`: 固定値 `"per-ac"`。**必須**。aggregator がこれで per-AC artifact と判別。
- `ac_id`: spec.md の **`AC-N` ハイフン付き表記をそのまま転記**（独自再番号禁止）。`plan/feedback/sprint-N/AC-K.json` のファイル名と整合させる。
- `sprint`: aggregator が転記するため per-AC でも正しく入れる。
- `mode`: aggregator が転記するため per-AC でも正しく入れる。

### 判定系

- `verdict`: 担当 AC のみの判定。`"pass"` / `"fail"` / `"blocked"` のいずれか。
- `blocker`: `verdict == "blocked"` のとき **必須 4 項目**。それ以外は `null`。
- `evaluated_at`: per-AC 評価完了時刻（ISO8601）。

### スコア系（per-AC のみ）

- `scores_local`: **`no_regression` を含まない** (回帰判定は AC 単位では行えないため aggregator が確定)。
- `thresholds_met_local`: `scores_local` の各項目が SKILL.md「完了条件」表の閾値以上かを真偽値で記録。`no_regression` は含まない。
- 主観表現 (`confidence` 等) を **絶対に含めない**。

### 実行・エビデンス系 (Phase X2: evidence_local を最小化)

- `tests_run_local`: この AC のために実行・生成したテストのみ列挙。`type: "playwright_test_spec"` は per-AC subagent が生成した `.spec.ts` の記録。**Phase Z5**: Step 9 self-execution 完了後に `self_execution_result` に実行結果（exit_code / passed / failed 等）が格納される。aggregator は `<SUT root>/evidence/results.json` を使わず per-AC JSON の `self_execution_result.tests_run_local[]` を一次源とする。**空配列禁止**（halt 時のみ例外）。
- **`evidence_local` (Phase X2 で簡素化)**: per-AC subagent は Step 6 で artifact 生成を行い、Step 9 self-execution 後に output dir `evidence/<ac_id_slug>/test-results/` が生成される。**`evidence_local.files[]` は出力しない** (旧設計の「予想ベース」を廃止)。書く必須項目は `expected_attachments_count` (生成した .spec.ts 内の `shot()` 呼び出し回数のみ・参考値) と `ac_coverage` (単一エントリ・該当 AC の category と verification_method のみ)。実 artifacts の enumerate は aggregator が `evidence/<ac_id_slug>/test-results/` から行う (Phase Z5)。

### 影響範囲系

- `impact_surface_local`: **この AC が観測した範囲のみ**。aggregator が全 per-AC を union して全体 `impact_surface` を確定。
- `risk_flags_local.hard_rule_hit`: この AC が観測した hard rule のみ。aggregator が union。
- `risk_flags_local.soft_signals`: この AC が観測した soft signal のみ。aggregator が union + 自分の観測（`3_files_changed`, `modified_files_plan_drift_*` 等）を追加。

### Playwright Test 連動

- **`ac_operations` (必須・verdict が "blocked" 以外のとき空配列禁止)**: per-AC subagent が **spec.ts の設計図として先に書き** (`evaluator-per-ac.md` ワークフロー Step 5)、その後 spec.ts に対応する `shot(label)` を埋める順序契約 (修正 A)。aggregator が final mode で `e2e/sprint-final.spec.ts` を結合する素材になり、**pge-report HTML レポートの screenshot ポップアップで日本語 summary が最上位表示される人間レビュー用データ**でもある。
  - `step`: 1 から始まる連番（AC 内）。**screenshot ファイル名の連番 (`001_...png` の `001`) と一致させる** こと (pge-report が紐付けに使う)。**`max(step) == spec.ts 内の shot() 呼び出し回数`** を `evaluator-per-ac.md` ワークフロー Step 7 (self-check) で必ず確認
  - **`summary` (必須・日本語自由記述・1 行)**: 「<field A> に上限超過文字数を入力」「<submit label> 押下」「フォームを開く」のような **人間が一目で操作内容を理解できる日本語サマリ**。action enum (英語) ではなく、業務操作として書く。pge-report の image ポップアップで最上位に表示される。**欠落は aggregator cross-cutting で `missing-ac-operations-summary` finding として起票され per-ac 再生成される**
  - `locator`: Playwright locator (data-testid 推奨、CSS / role / text も可)
  - `action`: enum: `"navigate" | "click" | "fill" | "select" | "press_key" | "wait_for" | "screenshot" | "expect" | ...` (機械処理用・spec.ts 結合の素材)
  - `expected`: **日本語**で記述する人間可読の期待結果 (1 行)
  - `value`: action が `"fill"` / `"select"` のとき入力値（任意フィールド）
- `spec_ref`: Phase Z1 で test-designer 廃止のため `design_self_authored: true` 固定。aggregator は per-AC JSON の `design.scenarios[].tc_id` を直接 evidence 集計に使う。
  - `design_self_authored`: `true` 固定 (Phase Z1)
  - `test_design_anchor`: `null` (Phase Z1: 旧 test-design.md anchor 概念は廃止)
  - `test_design_observation_points[]`: per-AC が確定した `design.observation_kinds[]` を転記 (回帰時の root cause 分析用)

### findings 系（Phase X1: fix_target 一軸統合）

failure を **`fix_target` 一軸**で分類した `findings[]` に統合する。orchestrator は Step 6-C で `fix_target` で switch するだけ:

- **`findings[]`** — 検出された全 issue を fix_target で分類した配列。`id` は per-AC スコープで 1 から振る (aggregator が全体で再番号)。

#### `fix_target` の取りうる値 (4 種類)

| `fix_target` | 意味 | routing 先 (Step 6-C) |
|---|---|---|
| `"implementation"` | 実装 (application code) の bug | Generator retry |
| `"test_spec"` | `.spec.ts` 側の bug (test isolation 不足・wrong assertion・fragile locator 等) | per-AC Evaluator 再生成モード |
| `"infrastructure"` | 環境 / config / data isolation の問題 | orchestrator 対応 or 人間 escalate |
| `"review-only"` | cross-cutting concern (security / performance) で fix 不要だが review 対象として明示すべきもの | severity に応じて Expert-Reviewer 起動 trigger |

#### 共通フィールド

- `id`: per-AC スコープで 1 から振る (aggregator が全体で再番号)
- `fix_target`: 上記 4 種
- `summary`: 1 行サマリ (必須)
- `severity`: `"critical" | "major" | "minor" | "info"` (review-only は info / minor 中心・implementation は critical 含む)
- `ac_id`: 起源 AC (担当 AC 以外を指す場合あり)
- `detected_via`: `"playwright_test_runner_failure" | "self_review" | "code_review" | "cross_cutting_grep"`

#### fix_target 別の追加フィールド

- `fix_target == "implementation"` のみ: `repro` (再現手順)
- `fix_target == "test_spec"` のみ: `spec_file` / `issue_type` (test-isolation / wrong-assertion / fragile-locator / missing-prerequisite / wrong-test-data) / `current_code` / `suggested_fix`
- `fix_target == "infrastructure"` のみ: `fix_param` (playwright_config / app_data_isolation / env / ci_runner) / `suggested_fix`
- `fix_target == "review-only"` のみ: `category` (security / performance / maintainability) / `evidence` (該当コード片)

#### `failure_mode_signal` (optional・Phase Z4-S2)

per-ac は基本的に **静的レビューに基づく分類** (`fix_target` 軸) のみを出力する。`failure_mode_signal` (Test Runner runtime error からの 5 値分類) は **aggregator が Test Runner 実行後に findings[] に後付け付与**する責任で、per-ac が自発的に書くのは以下 2 ケースのみ:

1. **per-ac 自身が halt する直前** — `verdict: "blocked"` の場合に `failure_mode_signal: "data_unavailable"` を併記可 (TI artifact 不在等で test design 確定不能)
2. **regen_mode で前回 finding を消費するとき** — orchestrator が task description で渡してきた `failure_mode_signal` を per-ac JSON の `regen_mode_metadata.consumed_failure_mode_signal` に転記 (Step 0 のどの sub-step に focus するかの判断材料)

通常 (initial mode・verdict=pass/fail) は per-ac が `failure_mode_signal` を書かない (aggregator が Test Runner 結果から後付け)。

#### `regressions_local[]` (維持)

この AC が他 AC の機能を壊している疑いを観測したケース。aggregator は per-AC を結合 + smoke regression と合わせて全体 `regressions[]` を確定する。

#### 禁止事項 (Phase X1 + Phase Z4-S2 重要)

- ❌ `.spec.ts` 側の問題に `fix_target: "implementation"` を付けない (Generator に丸投げになる)
- ❌ 実装 bug に `fix_target: "test_spec"` を付けない (per-AC Evaluator は実装を変更しない)
- ❌ 「分類が不明だから implementation にまとめる」のは不可。明らかに `.spec.ts` 起因 (test isolation・固定値依存・PREFIX 衝突等) は `fix_target: "test_spec"` に分離する
- ❌ `findings[]` 以外の旧 schema (`bugs[]` / `test_spec_issues[]` / `infrastructure_issues[]`) を出力しない (Phase X1 で統合済み)
- ❌ initial mode (Test Runner 未実行段階) の per-ac が `failure_mode_signal` を勝手に書かない (runtime error が無いのに runtime-based 分類を確定するのは hallucination・Phase Z4-S2)
- ❌ regen_mode で受領した `failure_mode_signal` を **無視して別 sub-step に focus を移す** (orchestrator の routing 意図に従う・Step 0 の該当 sub-step を再走)

## per-AC subagent への入力契約 (タスク文脈で orchestrator から渡す)

per-AC subagent には以下のタスク文脈を渡す:

1. **対象スプリント番号** (e.g. `Sprint N`)
2. **モード** (`"intermediate"` または `"final"`)
3. **担当 AC ID** (e.g. `AC-K`)
4. **monitor_dir** (e.g. `plan/monitor/<agent_id>-<hash>/`)
5. **出力先パス** (e.g. `plan/feedback/sprint-N/AC-K.json`, `e2e/sprint-N/AC-K.spec.ts`)
6. **`plan/spec.md` の AC-K 節 + contracts (`plan/test-design/contracts/*.json`) + TI artifacts (`plan/test-investigation/phase{1,2,3}/`) を Step 0 で literal grounded に消費して design を確定せよ** (Phase Z1)
7. **`.spec.ts` を生成し (Step 6)、さらに runner_command を Bash で self-execution する (Step 9・Phase Z5)** — 旧「orchestrator が一括実行」から変更。N=3 retry (Step 10) + escalation (Step 11) も per-AC の責務
8. **Playwright MCP を使わない**（共有 server による state 混線回避・self-execution は Bash + runner_command を使う）

per-AC subagent は本ファイルの per-AC スキーマと `evaluator-per-ac.md` 本文の規約を一次資料とし、上記タスク文脈以外は受け付けない。

## 禁止事項

- `risk_score`（全体）を per-AC に書かない（aggregator のみが算出）
- `smoke_tests` を per-AC に書かない（pre-smoke subagent の専管）
- `no_regression` スコアを per-AC に書かない
- `confidence` / `looks_good` 等の主観フィールドを追加しない
- 担当 AC 以外の AC を `evidence_local.ac_coverage[]` に含めない
- Playwright MCP で screenshot を直接撮影しない（Test Runner が `<SUT root>/evidence/` に自動収集する・Phase X3。MCP は per-AC subagent では未許可）
- Step 0 で contracts / TI artifacts を読まずに観測点・データ作成戦略を発明しない (Phase Z1: literal grounding 必須)
- **fix_target 軸で findings を分類する (Phase X1)** — `.spec.ts` の不備に `fix_target: "implementation"` を付けない。Generator は実装のみ担当する。test isolation・固定値比較などの spec 起因問題は `fix_target: "test_spec"` に分類し、orchestrator が Step 6-C で per-AC Evaluator 再生成経路にルーティングする
- **旧 schema (bugs[] / test_spec_issues[] / infrastructure_issues[]) を出力しない (Phase X1 で統合済み)** — すべて `findings[]` 1 配列に統合された
