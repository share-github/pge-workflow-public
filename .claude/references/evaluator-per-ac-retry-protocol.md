# Evaluator Per-AC Retry Protocol (Phase Z5)

`evaluator-per-ac.md` Step 10 (retry loop) / Step 11 (escalation 準備) の**詳細実行規約**。per-ac agent file 本体の行数増加を抑制するため、retry 詳細をここに分離している。

## (a) retry loop の終了条件と最大 N=3

| 条件 | 動作 |
|---|---|
| self-execution exit_code == 0 | retry loop を抜けて Step 11 へ (escalation 不要) |
| retry 回数 (iteration) が N=3 未満 かつ exit_code != 0 | artifact を修正して Step 9 (self-execution) へ戻る |
| retry 回数が N=3 に達しても exit_code != 0 | Step 11 (escalation 準備) に移行 |

**N=3 は per-AC 内 retry の上限**。orchestrator 管理の `test_spec_retry_count` (Step 6-C-spec 経路の regen カウント) とは**独立カウント**。合算は 6 回となるが許容範囲 (spec §非機能要件)。

## (b) hunk-level minimal patch の指示形式

retry loop で artifact を修正する際、**問題の最小範囲のみ修正する**制約を厳守する。regen 焦点ずれ (O-9 の主因) を防ぐため。

### 指示形式の規約

```
hunk-level minimal patch 規則:
1. 失敗 stderr_excerpt から特定できる行 (またはブロック) のみ修正する
2. 影響する range を明示する (例: "TC-AC-K-S2 の locator 修正・他 scenario は変更しない")
3. 修正理由を 1 行で要約する (例: "strict mode violation: multiple elements matched selector")
4. 他 scenario / 他 test block を書き換えない制約を自己確認する
5. 修正後は Step 7 の self-check (I1-I4 + framework 別 mechanical check) を再実行する
```

### 禁止事項 (hunk-level minimal patch)

- ❌ テスト全体を書き直す (失敗箇所以外の変更を持ち込む)
- ❌ 修正理由を書かないまま diff を適用する
- ❌ 他 scenario の assertion を弱体化させて pass を稼ぐ
- ❌ client-side 制約 (HTML 属性 maxlength/pattern/required 等) を削除して test を通す (退化的修正禁止)
- ❌ server-side validation annotation (@Size/@NotBlank/@Valid 等) を削除して test を通す (退化的修正禁止)

## (c) escalation_context の完全 JSON スキーマ

```json
{
  "escalation_context": {
    "failed_artifact_path": "e2e/sprint-N/AC-K.<ext>",
    "failed_artifact_content": "<test artifact の全文 (Step 6 生成後の最終版)>",
    "final_stderr": "<最後の self-execution の stderr 全文>",
    "final_exit_code": 1,
    "tried_hunks": [
      {
        "iteration": 1,
        "hunk_description": "<修正内容の 1 行サマリ>",
        "hunk_range": "<影響した range の説明>",
        "before": "<修正前の該当箇所>",
        "after": "<修正後の該当箇所>",
        "result_stderr": "<この iteration の self-execution stderr>",
        "result_exit_code": 1
      },
      {
        "iteration": 2,
        "hunk_description": "<修正内容の 1 行サマリ>",
        "hunk_range": "<影響した range の説明>",
        "before": "<修正前の該当箇所>",
        "after": "<修正後の該当箇所>",
        "result_stderr": "<この iteration の self-execution stderr>",
        "result_exit_code": 1
      },
      {
        "iteration": 3,
        "hunk_description": "<修正内容の 1 行サマリ>",
        "hunk_range": "<影響した range の説明>",
        "before": "<修正前の該当箇所>",
        "after": "<修正後の該当箇所>",
        "result_stderr": "<この iteration の self-execution stderr>",
        "result_exit_code": 1
      }
    ],
    "still_unresolved": [
      "<未解決の問題 1: stderr 抜粋または root cause 推定>",
      "<未解決の問題 2>"
    ]
  }
}
```

### orchestrator が escalation_context を使う prompt 規約 (Phase γ)

orchestrator は `verdict: "blocked"` + `escalation_context` を検出したら、**context fresh な新 evaluator-per-ac teammate** を起動する。task description には以下を含める:

```
sprint: Sprint N
ac_id: AC-K
mode: <intermediate|final>
monitor_dir: plan/monitor/eval-ac-K-sprint-N-escalation/
escalation_mode: true
escalation_context: <escalation_context オブジェクト全体を JSON literal で転記>

指示:
- failed_artifact_content を起点に、tried_hunks で試みた修正箇所と still_unresolved を確認する
- hunk-level minimal patch で still_unresolved の根本原因を解消する
- Step 9 (self-execution) + Step 10 (retry loop N=3) を必ず実行する
- 退化的修正 (HTML 属性削除・validation annotation 削除・security 制約 bypass) は禁止
```

escalation 後の新 teammate も **自身の Step 9/10 の self-execution + retry** を実行する (再帰的 self-execution)。escalation が発生した場合、orchestrator の `loop_metrics.test_spec_retry_count` を 1 増加させる。

## (d) failure_mode_signal の deterministic regex catalog (project 非依存)

**single source of truth**: 本ファイルの定義を `evaluator-per-ac.md` (Step 9) と `evaluator-aggregator.md` (Step 6.5) の両者が参照する。二重定義禁止。

Phase Z9 で `business_rule_conflict` / `scenario_unavailable` / `fixture_bug` の 3 値を新規追加 (Discovery 連携)。

| 検出 pattern (regex) | failure_mode_signal | 同時付与する fix_target | severity |
|---|---|---|---|
| `strict mode violation` (Playwright) | `test_script_bug` | `test_spec` | major |
| `Test timeout of \d+ms exceeded` (Playwright) | `test_script_bug` | `test_spec` | major |
| `locator\.\w+: .*expected to be visible` で direct DOM mismatch (selector の design 不備が明らか) | `test_script_bug` | `test_spec` | major |
| `expect\(received\)\.toBe\(expected\)` 値不一致 | `spec_violation` | `implementation` | major |
| `expect\(.*\)\.toHave(Text\|Value)` 値不一致 | `spec_violation` | `implementation` | major |
| HTTP status mismatch (`expect.*\.status\(\)` で `\d{3}` 不一致) | `spec_violation` | `implementation` | major |
| `.design.expected_failures[]` の literal が実行出力に出現しない (bash AC は stderr / Playwright AC は network error log で確認) | `spec_violation` | `implementation` | major |
| **(Phase Z9+ / Z11.0 source 更新)** test が happy path (test_case.expected.http.status が成功系で `expected_failures[]` に該当しない) として書かれた + stderr / response body に **`domain.json#endpoints[].messages[].literal` の reject/validation message を ID 正規化 (`\d+` 等で abstract 化) して構築した regex** が match | `business_rule_conflict` | `spec` (sprint.json の test_case.state 選択見直し) | major |
| **(Phase Z9+)** scenario factory health check が fail (`scenario-factory-health-check-failed` keyword in stderr / per-AC blocker.reason) | `scenario_unavailable` | `implementation` (Generator が factory を修正) | critical |
| **(Phase Z9+)** test setup phase (test body 開始前) で fixture / seed loader / migration error (`fixture` / `seed` / `migration` keyword + non-zero exit before first assertion) | `fixture_bug` | `test_spec` (test 側の fixture 設定修正) | major |
| `EADDRINUSE` / `Browser launch failed` / `Page closed` (test 開始前) / `Connection refused` | `environment_failure` | `infrastructure` | critical |
| bash `exit_code == 127` (command not found) / `: command not found` in stderr | `environment_failure` | `infrastructure` | critical |
| **(Phase Z3+) noise pattern**: `favicon\.ico` / `\[HMR\]` / `\[vite\]` / `__vite_hmr` / `sourcemap` / `google-analytics` / `hotjar` / `__webpack_hmr` 系の universal dev 環境ノイズ | `noise` | (verdict 影響なし・記録のみ) | minor |
| per-AC が halt した `blocker.reason: "route-not-in-route-map"` / `"capability-not-available: ..."` / `"required-input-missing: ..."` | `data_unavailable` | (前段 Step 戻し) | critical |
| 上記いずれの regex にも合致しない | `unclassified` (= 省略) | (既存 `fix_target` で fallback) | per-AC 申告通り |

### `business_rule_conflict` 検出の前処理 (Phase Z9・必須)

`business_rule_conflict` の検出は他 signal と異なり 2 段階で動作する (deterministic regex を維持しつつ動的 ID / i18n 文言の variance を吸収する):

1. **literal 正規化** (検出 regex 構築前):
   - `plan/domain.json` を Read し `endpoints[].messages[].literal` の reject / validation message を全件抽出 (Z11.0: 旧 state-map.operations_denied.reason から source 変更)
   - 各 message に対し以下の置換を **deterministic** に実施 (LLM 推論禁止):
     - 数値 token (`\b\d+\b`) → `\d+`
     - 引用符内文字列 (`"[^"]*"` / `'[^']*'`) → `["'][^"']*["']`
     - 連続空白 → `\s+`
   - 結果を `regex_normalized_reason` として保持
2. **検出**: stderr / response body / Playwright trace に `regex_normalized_reason[]` の literal regex が 1 件以上 match
3. **追加条件**: test が happy path として書かれている (per-AC JSON の `design.expected.http_status` が成功系かつ `design.expected_failures[]` に該当 status / message が無い・= sprint.json#test_cases[<id>].expected が success 系)
4. 上記 1-3 全てを満たした test 1 件につき `failure_mode_signal: "business_rule_conflict"` を 1 件付与

i18n / 単一ロケール SUT で `regex_normalized_reason[]` が空配列なら本 signal は付与不可 (= `unclassified` に fallback)。

### 検出不能 signal の取り扱い (Phase Z9・参考情報)

regex で deterministic に検出不能な失敗 mode は `unclassified` に fallback する。LLM 推論による分類は禁止。

| 検出不能な mode | 理由 | 暫定対応 |
|---|---|---|
| **`spec_ambiguous`** (TODO.md の SPEC_AMBIGUOUS 相当) | spec の解釈差は cross-AC な意味推論を要し regex 不能 | `unclassified` に fallback・aggregator が手動 review で発見した場合は `findings[].issue_type: "spec-ambiguity-suspected"` を起票 |
| **`flaky`** (TODO.md の FLAKY 相当) | 単 1 run 結果からは判定不能 (複数 run の variance 必要) | `unclassified` に fallback・将来 retry loop の variance 計測機構が入った時点で再検討 |

これら 2 値は本表に**規約として追加しない** (LLM 推論経路を開かないため・deterministic 規約維持)。

### 適用規則

- **deterministic regex のみ**で分類する。LLM 推論による分類は禁止。
- `classification_evidence.deterministic: true` のときのみ `failure_mode_signal` フィールドを per-AC JSON に付与する。
- 1 件の failed test に対して 2 値以上の signal を割り当てない (1 finding = 1 signal)。
- regex で分類できない場合は `failure_mode_signal` フィールドを**省略** (= unclassified 扱い)。
- pass した execution には `failure_mode_signal` を付けない。

### aggregator との drift 防止

`evaluator-aggregator.md` Step 6.5「Test Runner error 分類」の regex 定義は**本ファイルが single source of truth**。aggregator は本ファイルの分類表を参照し、独自 pattern を追加しない。per-AC が self-execution 内で付与した `failure_mode_signal` と aggregator 後付け付与の signal が衝突する場合は per-AC の値を優先する。

## (e) 監視 phase 名命名規則 (evaluator-per-ac 専用)

`skill-monitor-protocol.md` の phase ID 連鎖を補完する per-AC 固有の phase 命名:

| phase ID | タイミング | `phase_message` 例 |
|---|---|---|
| `"9-self-execution"` | Step 9 self-execution 開始時 | `"self-execution 開始: runner_command を Bash 実行中"` |
| `"10-retry-1"` | retry 1 回目開始時 | `"retry 1/3: hunk-level patch 適用中"` |
| `"10-retry-2"` | retry 2 回目開始時 | `"retry 2/3: hunk-level patch 適用中"` |
| `"10-retry-3"` | retry 3 回目開始時 | `"retry 3/3: hunk-level patch 適用中"` |
| `"11-escalation-prep"` | Step 11 escalation 準備開始時 | `"retry N=3 消費: escalation_context を組み立て中"` |

**`"10-retry-N"` の N は iteration 番号 (1 始まり)**。監視側 (orchestrator) は prefix `"10-retry-"` でマッチする規約。N を含む動的文字列であることを前提に実装する。

### 完全な phase ID 連鎖 (evaluator-per-ac)

```
"boot" → "1-state-check" → "0-test-design" → "5-ac-operations"
       → "6-artifact-gen" → "7-self-check" → "8-per-ac-json-write"
       → "9-self-execution"
       → "10-retry-1" (fail 時のみ) → "10-retry-2" (fail 継続時) → "10-retry-3" (fail 継続時)
       → "11-escalation-prep" (N=3 消費かつ fail 時のみ)
       → "done"
halt 時: "halt"
```

`"9-self-execution"` の後、exit_code == 0 なら `"done"` に直行する (retry loop をスキップ)。

## (f) failure_mode_signal による retry routing (Phase Z3+)

per-AC 内 Step 10 の retry 最大回数と routing 先を **failure_mode_signal で機械決定**する。`fix_target` が示す責任主体に正しく escalation することで、不適切な層 (test artifact 側) で hunk patch を繰り返す無駄を排除する (Anthropic Writer/Reviewer 原則: 「作業した agent が grade しない」)。

| failure_mode_signal | 内部 retry 最大 N | 行動 |
|---|---|---|
| `test_script_bug` | **3** (現行通り) | hunk-level minimal patch を test artifact 側に適用して retry (test artifact 自身が起因のため evaluator-per-ac が正しい修正主体) |
| `spec_violation` | **1** (短縮) | 1 回 retry で hunk patch が test 側で吸収できるか試行。pass しなければ即 escalation で `fix_target: "implementation"` を明示 (Generator が正しい修正主体・test artifact 側で「期待値を緩める」修正は禁止) |
| `business_rule_conflict` (Phase Z9+) | **0** (retry 不可) | retry せず即 halt: `blocker.reason: "scenario-selection-mismatch"`・**spec.md AC.scenario_ref の選択ミス**として上流 (Planner / Discovery) に戻す。test 側で期待値を緩めて pass を稼ぐのは退化的修正・禁止 |
| `scenario_unavailable` (Phase Z9+) | **0** (retry 不可) | retry せず即 halt: `blocker.reason: "scenario-factory-health-check-failed"`・Generator が factory を修正する経路 (`fix_target: "implementation"`) |
| `fixture_bug` (Phase Z9+) | **2** | 2 回まで fixture / seed loader の test 側設定修正で retry。pass しなければ escalation で `fix_target: "test_spec"` を明示・catalog の `creation_method` 不整合が疑われる場合は Discovery に差し戻す候補として `risk_flags_local[]` に `"fixture_bug_persistent"` を追加 |
| `environment_failure` | **1** (短縮) | 1 回 retry で seed restore / port 解放 / 環境再 init を試行 (orchestrator 補助・要 task description の `seed_restore_command`)。pass しなければ即 halt: `blocker.reason: "environment-failure-unrecoverable"` |
| `data_unavailable` | **0** (retry 不可) | retry せず即 halt: `blocker.reason: "data-prep-blocker-detected"`・前段 Step (Step 0-h data_prep / TI Phase 2 capability) 戻し |
| `noise` | **0** | verdict 影響なし・per-AC JSON `self_execution_result.failure_mode_signal: "noise"` を記録するだけ・retry trigger にしない |
| `unclassified` (regex 不一致) | **3** (現行通り) | 既存 `fix_target` で fallback。挙動は `test_script_bug` と同じ (hunk patch retry を 3 回まで) |

### 適用規則

- Step 10 iteration ごとに最新 self_execution_result の `failure_mode_signal` を再評価する (前 iteration と異なる signal なら新規 routing を適用)。
- `spec_violation` で escalation する場合、`escalation_context.fix_target_forced: "implementation"` を per-AC JSON に明示する。aggregator は本フラグを見て Generator routing を強制する。
- `noise` 判定は **verdict が `pass` でも `fail` でも独立に付与可能** (信号として記録するだけで verdict には影響しない)。
- routing 表は本ファイルが single source of truth。evaluator-per-ac.md / evaluator-aggregator.md は本表を参照して動作を決める (二重定義禁止)。
