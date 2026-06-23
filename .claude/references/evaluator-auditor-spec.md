# Evaluator-Auditor: 検査軸と _audit.json schema (Phase Z1+Z2 軽量化版)

`evaluator-auditor.md` (Phase Z4 で `evaluator.md` mode=auditor から独立) が参照する **検査軸 A4 の機械的判定アルゴリズム・_audit.json 出力 schema・drift_detected 時の routing 規約** の一次資料。

auditor モードを起動した時点で**必ず Read** すること。Partial read 禁止。

## 設計意図 (Phase Z1+Z2)

Phase Z1 で test-designer family を廃止し、evaluator per-ac mode が Step 0 で contracts + TI を一次資料として **design.* field** を確定する flow に変わった。Phase Z2 で capability-based composition 化し、Universal Invariants I1-I4 を per-ac self-check に内包した。これにより:

- **A1-A3 (TC-id 1:1 / shot 数 / expected_failures literal)** は per-ac self-check の Universal Invariants I2 / shot-count / I3 で literal 突合済 (重複検査不要)
- **A5 (validation_layer)** は per-ac self-check の Playwright-specific check で literal 突合済
- **A6 (fixture strategy) / A7 (locator uniqueness)** は per-ac Step 0 で `contract_echo: true` / `multiplicity_hint_consumed: true` 必須・contracts / multiplicity_hint と異なる値は出力できない構造

→ auditor の責務は **cross-AC consistency check のみ**に縮小。残るのは **A4 (isolation prefix が AC 間で衝突しない)** だけ。

## 入力

| パス | 用途 |
|---|---|
| `plan/feedback/sprint-N/AC-*.json` | per-AC artifact 群 (PREFIX 命名規則突合用・`test_artifact.artifact_framework` で artifact 形式を判定) |
| `e2e/sprint-N/AC-*.<ext>` | per-AC が生成した test artifact (`.spec.ts` / `.test.sh` 等・PREFIX literal 抽出元) |

**Phase Z1 で読まない**: `plan/test-design.md` / `plan/test-design/assessment-sprint-N.json` / `plan/test-design/fragments/` (廃止済・orphan)

## 検査軸 A4: isolation prefix 重複 (cross-AC)

**目的**: 全 AC の test artifact 内 `PREFIX` 命名規則が `e2e-ac-${AC_ID}-<timestamp>-<random>` 形式かつ AC 間で衝突しないかを検証 (xUnit Test Patterns Fresh Fixture pattern / F.I.R.S.T Independent 原則)。Phase Z2 で artifact_framework が複数になったため、抽出 pattern は framework 別:

- **F-playwright-ts** (`.spec.ts`): `const PREFIX = \`e2e-ac-K-${Date.now()}-${...}\`;`
- **F-bash-script** / **F-sql-with-bash-wrapper** (`.test.sh`): `PREFIX="e2e-ac-K-$(date +%s)-..."`

**手順**:

1. 各 AC-K の per-AC JSON から `test_artifact.file` + `test_artifact.artifact_framework` を取得
2. artifact_framework に応じて PREFIX literal を抽出:
   - F-playwright-ts: `grep -E "const PREFIX\s*=\s*\`?e2e-ac-" <file>`
   - F-bash-script / F-sql-with-bash-wrapper: `grep -E "PREFIX=\"e2e-ac-" <file>`
3. **形式チェック**: 抽出した PREFIX 式が `e2e-ac-${AC_ID}-` で始まり timestamp + random を含むかを正規表現で検証
4. **AC_ID 整合チェック**: PREFIX 式の AC_ID 部分が per-AC JSON の `ac_id` と一致するかを検証
5. **衝突チェック**: 全 AC の PREFIX literal を集合化し重複を検出 (同一固定 prefix を 2 つ以上の AC が使用していると runtime で contamination の温床)

**判定**:

| 状態 | 起票 |
|---|---|
| 全 AC で PREFIX が形式準拠 + AC_ID 一致 + cross-AC で重複なし | PASS |
| PREFIX が形式違反 (`Date.now()` 含まない・固定値・別 AC ID を使用) | `findings[].issue_type: "isolation-prefix-collision"`・違反 AC を `suggested_fix.violations[]` に列挙 |
| 同一 AC で PREFIX が複数 test() に分散していて命名不一致 | 同上 (test 内で per-test PREFIX を持つのは OK・グローバル const と test 内 const の混在は要確認) |
| 複数 AC が同一固定 prefix を使用 | 同上 (cross-AC pollution の温床) |

## _audit.json schema (Phase Z1: 厳守)

```json
{
  "sprint": "Sprint N",
  "mode": "auditor",
  "verdict": "pass | drift_detected | blocked",
  "blocker": null,
  "audited_at": "2026-06-08T12:00:00+09:00",
  "summary": {
    "ac_count": 7,
    "axis_results": {
      "A4_isolation_prefix": {"passed": true, "violations": 0}
    }
  },
  "findings": []
}
```

### drift_detected の例

```json
{
  "sprint": "Sprint N",
  "mode": "auditor",
  "verdict": "drift_detected",
  "blocker": null,
  "audited_at": "2026-06-08T12:00:00+09:00",
  "summary": {
    "ac_count": 7,
    "axis_results": {
      "A4_isolation_prefix": {"passed": false, "violations": 2}
    }
  },
  "findings": [
    {
      "ac_id": "AC-3",
      "issue_type": "isolation-prefix-collision",
      "axis": "A4",
      "severity": "major",
      "spec_file": "e2e/sprint-N/AC-K.spec.ts",
      "fix_target": "test_spec",
      "impact": {
        "changes_test_method": false,
        "affects_test_runtime_or_cost": false,
        "changes_spec_interpretation": false,
        "rationale": "PREFIX に Date.now() を含めるだけで AC 間 collision を解消・test method の質的変更なし"
      },
      "suggested_fix": {
        "violations": [
          {"ac_id": "AC-3", "prefix_literal": "const PREFIX = 'e2e-ac-K'", "problem": "固定値で AC-7 と衝突"},
          {"ac_id": "AC-7", "prefix_literal": "const PREFIX = 'e2e-ac-K'", "problem": "固定値で AC-3 と衝突"}
        ],
        "description": "PREFIX を `e2e-ac-${AC_ID}-${Date.now()}-${Math.random().toString(36).slice(2,8)}` 形式に修正"
      }
    }
  ]
}
```

### フィールド規約

- `verdict`:
  - `"pass"`: A4 軸 PASS (`findings[]` が空)
  - `"drift_detected"`: 1 件以上の違反検出 (`findings[]` 非空)・orchestrator が 6-C-spec 経路で per-AC を regen 起動
  - `"blocked"`: auditor halt (`blocker` 必須)
- `findings[].fix_target`: **必ず `"test_spec"` 固定** (PREFIX 修正は spec.ts のみで完結)
- `findings[].impact`: 各 finding の impact 3 軸を auditor が機械判定・通常は全 false (PREFIX 修正は test method の質的変更なし)
- `findings[].suggested_fix`: issue_type `isolation-prefix-collision` は `{violations: {ac_id, prefix_literal, problem}[], description: string}`

### blocked schema

```json
{
  "sprint": "Sprint N",
  "mode": "auditor",
  "verdict": "blocked",
  "blocker": {
    "reason": "per-ac-artifacts-missing",
    "attempted_recovery": [
      "Read plan/feedback/sprint-1/AC-*.json → 全 AC で per-AC artifact が見つからない (per-ac mode が halt した状態)",
      "Read e2e/sprint-1/AC-*.spec.ts → spec.ts ファイル群が無い"
    ],
    "human_decision_needed": "per-ac mode が全 AC で halt している状況を確認。前段 (Step 5-B-4) で blocker.reason を確認し人間判断",
    "would_violate_if_proceeded": ["evaluator-auditor-spec.md「halt 条件」: per-ac artifact が 1 件も無いなら halt"]
  },
  "audited_at": "2026-06-08T12:00:00+09:00",
  "summary": null,
  "findings": []
}
```

## drift_detected 時の routing (orchestrator 側)

auditor の `verdict: "drift_detected"` を orchestrator が読んだら:

1. `findings[]` を `ac_id` でグループ化し、影響を受けた AC 集合 (`drift_acs`) を確定
2. **Playwright Test Runner (Step 5-B-5) を skip** (drift を含む spec.ts を実行しても無意味)
3. 各 `drift_acs` の per-AC を `regen_mode: true` で再起動 (Step 6-C-spec 経路と同じ)
4. per-AC regen 完了後に再度 auditor を起動 (drift 解消確認)
5. drift 解消が確認できたら Step 5-B-5 (Playwright Test Runner) へ進行
6. **同一 AC で auditor → regen → auditor のループが 3 回上限超過したら** `findings[].issue_type: "audit-regen-loop-exceeded"` で blocked 起票 (auditor 自身が 4 回目 auditor として上書き)

## auditor が書き換えないファイル一覧

| ファイル | 理由 |
|---|---|
| `plan/feedback/sprint-N/AC-*.json` | per-AC が書く (auditor は読み取りで A4 drift 検出のみ) |
| `e2e/sprint-N/AC-*.spec.ts` | per-AC が regen mode で書き換える (auditor は提案を `_audit.json` に書くだけ) |
| `plan/feedback/sprint-N.json` / `plan/feedback/final.json` | aggregator が書く (auditor は触らない・D-4: MD 廃止) |
| `e2e/sprint-final.spec.ts` | aggregator が書く |
| `<SUT root>/evidence/` | Test Runner が書く (Phase X3) |

## 禁止事項

- per-AC artifact / .spec.ts を**書き換える** (純粋に検出のみ・修正は per-AC regen に振る)
- 検査軸を A4 以外に拡張する (Phase Z1 で 1 固定・per-ac self-check と重複する軸を復活させない)
- drift detection の判定基準を**緩和する** (literal 一致のみ・「ほぼ一致」「意味的に等価」を pass にしない)
- `findings[].fix_target` を `"test_spec"` 以外に設定する
- spec.md の前提条件 / 業務仕様の妥当性を**判定する** (これは Planner の責務範囲)
- per-AC artifact の `spec_ref.test_design_observation_points[]` / `design.*` を再評価する (per-AC self-check が担保済・auditor は cross-AC 観点のみ)
- 旧 A1-A3 / A5-A7 を復活させる (Phase Z1 で per-ac self-check に内包済・重複検査は wasted compute)
