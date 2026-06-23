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

| 検出 pattern (regex) | failure_mode_signal | 同時付与する fix_target | severity |
|---|---|---|---|
| `strict mode violation` (Playwright) | `test_script_bug` | `test_spec` | major |
| `Test timeout of \d+ms exceeded` (Playwright) | `test_script_bug` | `test_spec` | major |
| `locator\.\w+: .*expected to be visible` で direct DOM mismatch (selector の design 不備が明らか) | `test_script_bug` | `test_spec` | major |
| `expect\(received\)\.toBe\(expected\)` 値不一致 | `spec_violation` | `implementation` | major |
| `expect\(.*\)\.toHave(Text\|Value)` 値不一致 | `spec_violation` | `implementation` | major |
| HTTP status mismatch (`expect.*\.status\(\)` で `\d{3}` 不一致) | `spec_violation` | `implementation` | major |
| `.design.expected_failures[]` の literal が実行出力に出現しない (bash AC は stderr / Playwright AC は network error log で確認) | `spec_violation` | `implementation` | major |
| `EADDRINUSE` / `Browser launch failed` / `Page closed` (test 開始前) / `Connection refused` | `environment_failure` | `infrastructure` | critical |
| bash `exit_code == 127` (command not found) / `: command not found` in stderr | `environment_failure` | `infrastructure` | critical |
| per-AC が halt した `blocker.reason: "route-not-in-route-map"` / `"capability-not-available: ..."` / `"required-input-missing: ..."` | `data_unavailable` | (前段 Step 戻し) | critical |
| 上記いずれの regex にも合致しない | `unclassified` (= 省略) | (既存 `fix_target` で fallback) | per-AC 申告通り |

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
