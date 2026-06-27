---
description: PGE Step 4.5 で workflow が呼ぶ contracts 算出 procedure (bash + jq one-liner で isolation_contract.json / multiplicity_hint.json を deterministic 算出)。workflow から直接参照されるため preload 不要。
user-invocable: false
disable-model-invocation: true
---

# Skill: Test Design Contracts (Step 4.5 catalog・Phase Z1)

このファイルは Step 4.5 で orchestrator (= `pge-sprint-cycle` workflow) が生成する **test design contracts** の schema 定義と bash one-liner template のカタログ。catalog 専用 (絶対ルール 11)。behavioral rule は `pge-sprint-cycle.js` の contracts step prompt および各 agent.md 本文を一次資料とし、本ファイルは literal 引用元としてのみ使用する。

## 1. 目的

**evaluator per-ac Step 0 (Phase Z1)** の attention 負荷を下げ、**情報配置の歪みに起因する halt** (Shared Fixture violation・Strict Mode violation 等) を構造的に排除する。具体的には:

- **isolation_contract.json** — cross-AC pollution graph を controller_action_map.json から deterministic に算出し、各 AC に **fixture strategy 契約**を発行
- **multiplicity_hint.json** — DOM 上の element 多重度 を aria_snapshot.yaml から deterministic に算出し、各 AC に **chain_scope 必須箇所のヒント**を発行

これにより evaluator per-ac は cross-AC reasoning + DOM 多重度推測を**しなくて済む** (契約・hint を Step 0 で echo するだけ)。

**関連: Phase 3 が生成する `locator_catalog.json` (schema_version 2)** も同じ contract enforcement pattern で運用される (`by_element_id[IE-N].selected.selector_literal` を Step 0-g で literal echo・`locator_catalog_consumed: true` 必須)。生成元は本 skill (Step 4.5) ではなく investigator phase 3 だが、消費側の規約は等価 (詳細は [`.claude/references/test-investigator-phase3-schemas.md`](../../references/test-investigator-phase3-schemas.md))。

## 2. 出力先パス (固定)

| 出力 | パス | 書き込み権限 |
|---|---|---|
| isolation contract | `plan/test-design/contracts/isolation_contract.json` | orchestrator のみ |
| multiplicity hint | `plan/test-design/contracts/multiplicity_hint.json` | orchestrator のみ |

## 3. isolation_contract.json schema

```json
{
  "generated_at": "ISO 8601 timestamp (UTC)",
  "source_inputs": {
    "controller_action_map": "plan/test-investigation/phase2/controller_action_map.json",
    "route_map": "plan/test-investigation/phase2/route_map.json",
    "spec": "plan/sprint.json (Phase Z11.0+ AC 一覧 = test_cases[].id・不在時 plan/spec.md fallback)",
    "fragments_routes_touched": ["plan/test-design/fragments/AC-K.json#routes_touched"]
  },
  "contracts": {
    "AC-K": {
      "strategy": "fresh-fixture-prefix | fresh-fixture-uuid | read-only-from-bootstrap | shared-fixture-acceptable | none",
      "prefix_or_uuid": "e2e-ac-K-${Date.now()}-${Math.random().toString(36).slice(2)}",
      "write_set": ["<Entity>.<field-A>", "<Entity>.<field-B>", ...],
      "read_set": ["<Entity>.*"] | [],
      "polluted_by": ["AC-J", ...],
      "polluter_to": ["AC-L", ...],
      "bootstrap_dependency": true | false,
      "reason": "literal な決定理由 (例: 'AC-K writes <Entity> via POST <route> (on_success branch); fresh-fixture-prefix to avoid polluting AC-L which reads <Entity>.*'. controller_action_map[<action>].on_success.<entity_field_mapping> から抽出。)"
    }
  },
  "edges": [
    {"polluter": "AC-J", "victim": "AC-K", "shared_entity": "<Entity>", "shared_fields": ["<Entity>.<field>"]}
  ],
  "bootstrap": {
    "entity": "<Entity>",
    "row_count": "<N>",
    "writable_by_acs": ["AC-<K1>", "AC-<K2>", "..."],
    "readable_by_acs": ["AC-<K3>", "AC-<K4>", "..."],
    "source": "TI Phase 1 _summary.json bootstrap state または手動指定"
  },
  "failure_mode_notes": []
}
```

### 3-a. strategy 決定ルール (deterministic)

各 AC の `write_set` / `read_set` を以下のルールで判定:

```
if write_set[AC] is non-empty:
  strategy = "fresh-fixture-prefix"
  reason = "AC writes <field list>; fresh-fixture-prefix to avoid polluting <polluter_to>"
elif read_set[AC] contains "<Entity>.*" or any "<entity>.*" and bootstrap_dependency=true:
  strategy = "read-only-from-bootstrap"
  reason = "AC reads <entity> without writing; bootstrap provides <row_count> rows"
else:
  strategy = "none"
  reason = "AC has no <entity> write/read interaction"
```

`fresh-fixture-uuid` / `shared-fixture-acceptable` は **deterministic 決定不可** (UI label 等の write 不可能性は機械判定困難) なので contract では発行せず、fragment 側で従来通り自己決定 (この場合 contract.strategy = "none" + fragment が補完)。

### 3-b. write_set 抽出ルール

各 AC の `routes_touched[]` (fragment 出力) を読み、以下を集約:

```
for each route in fragment.routes_touched:
  action = controller_action_map.actions[?action_id == route.action_id]
  if route.method in ["POST", "PUT", "PATCH"]:
    if route.branch == "on_success":
      write_set ∪= action.on_success.<entity_field_mapping>.keys()  # 例: <Entity>.<field-A>, <Entity>.<field-B>, ...
    elif route.branch == "on_validation_error":
      # validation 失敗 → write 発生せず・write_set 空のまま
      pass
```

### 3-c. read_set 抽出ルール

```
for each route in fragment.routes_touched:
  if route.method == "GET":
    action = controller_action_map.actions[?action_id == route.action_id]
    mp = action.model_population
    for key, value in mp.items():
      if value contains "Repository" or "<entity>Repository" hit:
        read_set ∪= "<entity>.*"  # 例: <Entity>.*
```

### 3-d. pollution graph 構築ルール

```
edges = ∅
for AC_i in all_acs:
  for AC_j in all_acs:
    if i == j: continue
    if write_set[AC_i] ≠ ∅ and "<entity>.*" ∈ read_set[AC_j]:
      shared_fields = write_set[AC_i] (全件)
      edges.append({polluter: AC_i, victim: AC_j, shared_entity: <entity>, shared_fields})
```

過剰隔離 (false positive over-isolation) は許容: 全 write AC が `fresh-fixture-prefix` + prefix scope filter で実害なし。

### 3-e. bootstrap pseudo-node

bootstrap data は「最初から存在する write」として扱い、pollution graph の pseudo-node にする。`read_set` に `<Entity>.*` を含む AC は bootstrap の影響を受けるため `bootstrap_dependency: true` を contract に記録。

## 4. multiplicity_hint.json schema

```json
{
  "generated_at": "ISO 8601 timestamp (UTC)",
  "source_inputs": {
    "aria_snapshots": ["plan/test-investigation/phase1/<screen>/aria_snapshot.yaml"]
  },
  "hints": {
    "AC-K": [
      {
        "token": "件",
        "route": "/<resource>",
        "count_in_aria_snapshot": 3,
        "recommended_chain_scope": ".<container-class-or-id>",
        "rationale": "/<resource> の aria_snapshot.yaml に '件' が 3 回出現。fuzzy locator は container scope での chain 必須 (Playwright Strict Mode 違反回避)。"
      }
    ]
  },
  "failure_mode_notes": []
}
```

### 4-a. token 抽出ルール

AC 一覧は `plan/sprint.json#test_cases[].id` から取得する (Phase Z11.0+・`jq -r '.test_cases[].id'`・sprint.json 不在時のみ spec.md の `### AC-K` 節 fallback)。各 AC の token は sprint.json では `test_cases[].label` + `expected.http.html_contains[]`、spec.md fallback 時は該当節から、以下を抽出:

- 日本語の単位 / 助数詞: `件`, `個`, `回`, `名`, etc.
- 動詞 + 副詞の組: `表示する`, `非表示にする`, etc.
- locator 候補となる文字列リテラル (quote で囲まれた部分)

抽出は jq + grep + sed の純 bash 処理で行い、LLM は介在しない。

### 4-b. multiplicity 算出ルール

```
for each token in AC.tokens:
  for each route in fragment.routes_touched:
    screen_dir = phase1_screen_for(route)  # 例: /<resource> → phase1/<list-screen>/
    aria_path = screen_dir + "/aria_snapshot.yaml"
    count = grep -c "${token}" ${aria_path}
    if count > 1:
      emit hint with recommended_chain_scope = nearest_container_class_or_id(token, aria_path)
```

`recommended_chain_scope` は aria_snapshot.yaml 内で token を含む node の最近接 container (class / id / role) を抽出。複数候補がある場合は最も specific (id > class > role) を選択。

## 5. bash one-liner templates

### 5-a. write_set 抽出 (jq)

```bash
# fragments/AC-K.json の routes_touched[] から write_set を算出
jq -r --slurpfile cam phase2/controller_action_map.json '
  .routes_touched
  | map(
      . as $r
      | $cam[0].actions[]
      | select(.action_id == $r.action_id)
      | if $r.method == "POST" and $r.branch == "on_success" then
          (.on_success.<entity_field_mapping_key> // {}) | keys | map("<Entity>." + .)
        else
          []
        end
    )
  | flatten
  | unique
' plan/test-design/fragments/AC-K.json
```

### 5-b. multiplicity 算出 (grep + jq)

```bash
# token 'X' が /<resource> の aria_snapshot.yaml に何回出るか
TOKEN="件"
ROUTE_SCREEN="<list-screen>"  # phase1 dir 名
ARIA="plan/test-investigation/phase1/${ROUTE_SCREEN}/aria_snapshot.yaml"
COUNT=$(grep -c "${TOKEN}" "${ARIA}" 2>/dev/null || echo 0)
echo "{\"token\": \"${TOKEN}\", \"route\": \"/${ROUTE_SCREEN}\", \"count\": ${COUNT}}"
```

### 5-c. contract 生成 wrapper (擬似コード)

```bash
mkdir -p plan/test-design/contracts

# 各 AC の routes_touched を集めて contract を組み立て
# (実装は workflows/pge-sprint-cycle.js の contracts step prompt の inline 規約に従う・本 catalog では擬似コードのみ)

isolation_contract=$(jq -n --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
  generated_at: $ts,
  source_inputs: {...},
  contracts: {...},
  edges: [...],
  bootstrap: {...},
  failure_mode_notes: []
}')

echo "$isolation_contract" > plan/test-design/contracts/isolation_contract.json
jq -e . plan/test-design/contracts/isolation_contract.json > /dev/null  # parse check
```

## 6. fallback policy

orchestrator は以下のいずれかが成立する場合、**空 contract を生成して fragment にフォールバック判定を委ねる** (hard fail しない):

| 状態 | 動作 |
|---|---|
| `controller_action_map.json` 不在 / parse error | `contracts: {}` の空 isolation_contract を発行 + `failure_mode_notes` に "controller_action_map_unavailable" を記録 |
| `route_map.json` 不在 / parse error | 同上 + "route_map_unavailable" |
| fragment.routes_touched 全件で action_id 解決失敗 | 該当 AC のみ `contracts[AC-K] = {strategy: "none", reason: "routes_touched_unresolved"}` |
| aria_snapshot.yaml 不在 / 一部のみ存在 | 該当 screen の multiplicity_hint を空 + `failure_mode_notes` に記録 |

fragment は contract presence を Read 前に確認し:

- **contract 存在 + 該当 AC entry 存在** → contract を echo (自己推論しない)
- **contract 存在 + 該当 AC entry が `strategy: "none"` で reason に "unresolved" 含む** → fragment 自己推論にフォールバック
- **contract 不在** → 全 AC で fragment 自己推論 (Phase Y0 以前と等価動作)

## 7. 禁止事項

- contract に LLM 推論結果を混入させない (本 step は deterministic preprocessor)
- contract 生成 step で `Agent(subagent_type=...)` を起動しない (orchestrator の bash + jq のみで完結)
- evaluator per-ac Step 0 内で contract を **無視して** 自己推論で上書きしない (contract がある場合は echo 必須・`contract_echo: true` / `multiplicity_hint_consumed: true` / `locator_catalog_consumed: true` 必須)
- contract と per-AC JSON `design.fixture_strategy` を **同時に書く** 操作はしない (contract → evaluator Read → per-AC JSON Write の順序保証)

## 8. 関連ファイル

- `.claude/workflows/pge-sprint-cycle.js` Step 4.5 — 本 catalog の inline 規約 (behavioral rule・contracts step prompt)
- `.claude/agents/evaluator-per-ac.md` — per-ac Step 0 で contract を Read する規約 (Phase Z1+Z4)
- `.claude/references/evaluator-per-ac-feedback-schema.md` — per-AC JSON `design.fixture_strategy` / `design.locator_specificity` の contract echo 規約
- `.claude/references/test-investigator-phase3-schemas.md` — `locator_catalog.json` (schema_version 2) schema (investigator phase 3 が生成・同じ contract enforcement pattern)
- `.claude/agents/investigator.md` Phase 3 節 — locator_catalog の AX-first 機械検証 + by_ac 導出規約
