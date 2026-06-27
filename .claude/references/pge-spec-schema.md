# PGE Spec Schema (Phase Z11.0 — collapsed)

PGE の Discovery 出力と Planning 出力の **single source of truth schema**。Phase Z9〜Z10.2 で 5 plan file + 3 reference に膨張した構造を **2 plan file + 1 reference** に collapse した版。

| file | 役割 | 生成者 | 消費者 |
|------|------|--------|--------|
| **`plan/domain.json`** | SUT facts (実在 entity / endpoint / named state / 本 sprint の planned change) | discoverer (Discovery phase) | Planner (grounding) / Generator (実装 spec) / Evaluator (state setup) |
| **`plan/sprint.json`** | 本 sprint の test plan (`prose` 概要〜制約 + requirement 粒度の分岐 + test_case) | Planner (pge-planning Phase 3.5) | Generator (実装 spec) / Evaluator (test 生成) / aggregator (集約) / spec-visual tool |
| **`plan/spec-visual.html`** | `domain.json + sprint.json` を tool が deterministic 生成した **唯一の人間レビュー artifact** | `.claude/tools/pge-spec-visual.py` (Phase 3.5 完了時に呼出) | 人間 review |
| `plan/spec.md` (Z11.1+ 降格) | thin pointer (「詳細は sprint.json / spec-visual.html」)・人間は読まない・legacy `ls spec.md` check 互換のためだけに存在 | Planner | (legacy check のみ) |

**Z11.1**: 人間が読む prose (概要 / 出発点 / コア機能 / 前提条件 / 制約) は `sprint.json#prose` に構造化 authored され、tool が `spec-visual.html` に render する。spec.md は markdown parse の脆さを避けるため authored prose を持たない (= 人間は HTML 1 枚だけ読めばよい)。

本 reference は framework 定義 (**placeholder shape のみ・SUT 固有名詞禁止**)。実 instance は `plan/` 配下 (PJ artifact・agnostic-auditor の対象外)。

## Z11.0 collapse の設計判断 (なぜ統合したか)

Phase Z9〜Z10.2 は user 要望に都度対応する過程で layer を積み増し、以下の重複・drift を抱えた:

| 問題 (Z10.2 時点) | Z11.0 での解消 |
|--------------------|----------------|
| state-map.json + scenario-catalog.json が「state」を 2 file に分散 | `domain.json#named_states[]` に統合 (state 定義 + setup を 1 entry に) |
| data-model.json が別 file で entities/endpoints を持つ | `domain.json#entities[] / endpoints[]` に統合 (同じ「SUT facts」概念) |
| spec-branches.json の branches[] と input_variations[] が 2 階層 authored | `sprint.json#requirements[]` (grouping のみ) + `test_cases[]` (1 namespace) に flatten |
| branch.then.rule と variation.expected_overrides が同 field を 2 表現で持つ (drift) | **rule 表現を廃止**・test_case.expected は **literal only**・behavior rule は `domain.json#planned_changes[].behavior` の 1 箇所のみ |
| reference 3 file の規約重複 | 本 reference 1 file に集約 |

**核心原則 (Z11.0)**: 1 つの概念は 1 箇所にのみ authored される。SUT facts は domain.json・test plan は sprint.json・behavior rule は planned_changes・test の input/expected は test_case の literal。同じ値を 2 形式で持たない。

**前提制約**: 1 sprint の test_case 数は実用上 ~30 件以内 (それを超える機能は sprint 分割すべき)。よって test_case を literal で列挙する repetition cost は許容範囲・rule + derive の abstraction は不要。

---

## domain.json 完全 schema

```jsonc
{
  "version": 1,
  "generated_at": "<ISO 8601 timestamp 文字列・固定 literal で可>",
  "source": {
    "research_path": "plan/research/latest.md",
    "investigated_paths": ["<SUT 内 path list (CWD 相対)・grep 対象>"]
  },

  "entities": [
    {
      "name": "<table / aggregate identifier・SUT の実 entity 名>",
      "kind": "table | view | aggregate | external_service",
      "source_files": ["<schema 定義の存在 path>"],
      "columns": [
        {
          "name": "<column literal>",
          "type": "<type literal・例: VARCHAR(100) / BIGINT / BOOLEAN>",
          "nullable": true,
          "default": "<literal or null>",
          "fk": "<other_entity.column or null>",
          "constraints": ["<UNIQUE / PRIMARY_KEY / AUTO_INCREMENT 等>"]
        }
      ],
      "evidence": [{ "kind": "schema|migration|code", "path": "<CWD 相対>", "excerpt": "<literal 80 char 以内>" }]
    }
  ],

  "endpoints": [
    {
      "method": "GET | POST | PUT | DELETE | PATCH",
      "path": "<URL pattern (含む path variable)>",
      "controller": "<controller identifier>",
      "handler": "<handler method name>",
      "source_file": "<CWD 相対>",
      "reads": ["<entity name>"],
      "writes": ["<entity name>"],
      "form_fields": [
        {
          "name": "<form field literal・実 form class の field 名>",
          "type": "<type literal>",
          "validations": ["<rule literal・例: @Size(max=100) / @NotNull>"]
        }
      ],
      "fixed_field_values": {
        "<entity.column>": "<controller が input 非依存で固定設定する value・例: status: ACTIVE>"
      },
      "messages": [
        {
          "trigger_condition": "<message が出る条件の説明>",
          "literal": "<response に出る message の literal・error / validation / flash 等>"
        }
      ],
      "evidence": [{ "kind": "code", "path": "<CWD 相対>", "excerpt": "<literal>" }]
    }
  ],

  "named_states": [
    {
      "id": "<lower_snake_case・business state を表す名詞主体の名前 (例: <entity>_<state-adjective>)>",
      "description": "<日本語 1 行・state の business 意味のみ・test action を含めない>",
      "predicate": ["<state を成立させる条件の literal 列挙・1 行 1 条件>"],
      "setup": {
        "kind": "seed | fixture | api | service | sql | combination | unavailable",
        "available": true,
        "steps": [
          "<state を成立 / 確認する手順の literal・state setup のみ・POST/GET/assert 等の test action 禁止 (Z9.1 規約継承)>"
        ],
        "executable_command": "<state setup を実行可能な bash literal・null 可・LLM 改変禁止>",
        "existing_fixture": { "available": true, "path": "<CWD 相対 or null>", "reuse_notes": "<1 行>" },
        "missing_components": [
          { "kind": "fixture|factory|seed|endpoint|helper", "target_path": "<CWD 相対>", "rationale": "<1 行>" }
        ]
      },
      "health_check": { "kind": "sql_query|http_request|cli|none", "command_literal": "<literal or null>", "expected_excerpt": "<literal or null>" },
      "evidence": [{ "kind": "code|test|schema|spec|research", "path": "<CWD 相対>", "excerpt": "<literal>" }],
      "confidence": "high | medium | low | unknown",
      "scope": "required | optional-regression | out-of-scope | unknown"
    }
  ],

  "planned_changes": [
    {
      "kind": "add_column | new_table | new_endpoint | modify_endpoint | new_validation | modify_behavior",
      "target": "<entity name or endpoint (method+path)>",
      "summary": "<日本語 1 行・追加する変更>",
      "fields_added": [{ "name": "<column>", "type": "<type>", "nullable": true, "default": "<literal or null>" }],
      "endpoints_added": [{ "method": "POST", "path": "<URL>" }],
      "behavior": {
        "rule": "<追加 / 変更する logic を 1 文で・例: form.<field> が空文字なら null に正規化して <entity>.<column> に保存>",
        "fields_to_persist": ["<entity.column>"]
      },
      "source": "research | scenario | planner_decision",
      "source_excerpt": "<source 内の literal 抜粋>"
    }
  ],

  "unknowns": ["<grep 不能 / 人間判断必要な不明点の literal>"]
}
```

### domain.json field 解説

- **entities[]**: SUT に物理的に存在する全 data structure。`columns[]` は schema 定義に書かれた全 column を省略せず列挙。Planner の grounding gate と Generator の実装が参照する権威 source。
- **endpoints[]**: SUT が公開する全 HTTP endpoint。
  - `form_fields[]`: form binding する field 名一覧 (Z11.0 新規・test_case.input の field 名 grounding に使う)。
  - `fixed_field_values`: controller が input 非依存で固定設定する値 (推測禁止・実 code grep literal)。
  - `messages[]`: response に出る error / validation / flash message の literal (test_case.expected.html_contains の grounding source + aggregator の business_rule_conflict 検出 source)。
- **named_states[]**: business state の catalog (旧 state-map + scenario-catalog を統合)。
  - `predicate[]`: state を定義する条件。
  - `setup`: state を成立させる方法 (**state setup のみ**・test action 禁止・Z9.1 規約継承)。`missing_components[]` 非空なら Generator が factory 実装を deliverable に積む。
- **planned_changes[]**: 本 sprint で追加・変更する schema / endpoint / behavior の declaration。
  - `behavior.rule`: 新規 logic を **1 箇所のみ** に記述 (= test_case に rule を重複させない・drift 不能の核心)。
  - `source: planner_decision` は research / scenario に literal 根拠がない独自判断 (reviewer 確認 trigger)。

---

## sprint.json 完全 schema

```jsonc
{
  "version": 1,
  "generated_at": "<ISO 8601>",
  "sprint": "Sprint N",
  "feature": "<feature_id (lower_snake_case)>",
  "source": { "domain_path": "plan/domain.json" },

  "prose": {
    "title": "<sprint の人間向けタイトル 1 行>",
    "overview": "<概要・1-3 文>",
    "starting_point": ["<出発点・既存 SUT の現状を 1 行 1 項目で>"],
    "core_features": [
      { "id": "<#N or 機能 id>", "name": "<機能名>", "description": "<1 文・何を作るか>" }
    ],
    "prerequisites": ["<前提条件・1 行 1 項目>"],
    "constraints": ["<制約事項 (スコープ外)・1 行 1 項目>"],
    "planner_decisions": [
      { "topic": "<Discovery unknowns 等の決定論点>", "decision": "<Planner 決定>" }
    ]
  },

  "requirements": [
    {
      "id": "R<N>",
      "description": "<日本語 1 行・要件粒度の機能の意味 (実装 detail を含めない)>",
      "scope": "required | optional-regression | out-of-scope"
    }
  ],

  "test_cases": [
    {
      "id": "AC-<N>",
      "requirement_id": "R<N>",
      "label": "<日本語 1 行・本 test_case が verify する観点>",
      "state": "<domain.json#named_states[].id or null>",
      "trigger": {
        "kind": "http_request | migration | cli | event",
        "method": "GET | POST | PUT | DELETE | PATCH | null",
        "path": "<URL・domain.json#endpoints[].path に grounded or planned_changes[] に declare>"
      },
      "input": {
        "<field>": "<literal value・rule 表現禁止・具体的な値のみ>"
      },
      "expected": {
        "http": { "status": <integer or null>, "redirect_to": "<path or null>", "html_contains": ["<literal or pattern>"] },
        "db_after": {
          "table": "<entity name or null>",
          "op": "insert | update | delete | no_change | schema_change",
          "match": { "<col>": "<literal>" },
          "row": { "<col>": "<literal value・rule 禁止・空文字 → NULL のような正規化結果も literal で書く (例: null)>" }
        },
        "side_effects": ["<literal>"]
      },
      "extra_steps": ["<本 test_case 固有の追加 action・例: POST 後に GET <path> を実行して一覧を確認>"]
    }
  ],

  "coverage": {
    "required_requirements": <integer>,
    "requirements_with_test_case": <integer>,
    "gap": <integer>,
    "optional_regression": <integer>,
    "out_of_scope": <integer>,
    "total_test_cases": <integer>
  },

  "grounding": {
    "trigger_path":  { "grounded": <int>, "planned": <int>, "ungrounded": <int> },
    "db_table":      { "grounded": <int>, "planned": <int>, "ungrounded": <int> },
    "db_column":     { "grounded": <int>, "planned": <int>, "ungrounded": <int> },
    "input_field":   { "grounded": <int>, "planned": <int>, "ungrounded": <int> },
    "html_message":  { "grounded": <int>, "planned": <int>, "ungrounded": <int> }
  }
}
```

### sprint.json field 解説

- **prose** (Z11.1+): 人間向けの散文。`spec-visual.html` の概要〜制約 section の source。markdown ではなく構造化 field で持つ (tool が deterministic に render・markdown parse の脆さを排除)。
  - `title`: sprint タイトル / `overview`: 概要 1-3 文 / `starting_point[]`: 既存 SUT の現状 / `core_features[]`: コア機能一覧 ({id, name, description}) / `prerequisites[]`: 前提条件 / `constraints[]`: 制約事項 (スコープ外) / `planner_decisions[]`: Discovery unknowns 等への決定 ({topic, decision})
  - prose は「何を作るか」の高レベル記述のみ・実装 detail (column 名 / status code 等) は test_cases / planned_changes が持つ
- **requirements[]**: 要件粒度の機能分岐の grouping。`id` + `description` + `scope` のみの thin layer。test_case を group する単位 (= 人間が「機能の意味として何分岐あるか」を読む粒度)。
- **test_cases[]**: 単一 namespace (`AC-<N>` 連番)。1 test_case = 1 検証単位 (= evaluator-per-ac の parallelism 単位)。
  - `id` の prefix は **framework 共通の `AC-`** を使う。execution 層 (evaluator-per-ac / auditor / aggregator の `AC-*.json` glob・contracts key・evidence dir・PREFIX literal・pge-report) が同一 id token を per-AC 評価単位として消費するため、planning 層と execution 層で id を 1 つに統一する (Z11.0 で一時的に `TC-N` を使ったが execution 層に伝播せず glob 不一致を生んだため `AC-N` に確定)。
  - `requirement_id`: 親 requirement への参照 (= grouping)。
  - `state`: `domain.json#named_states[].id` を参照 (= setup template)。
  - `input` / `expected`: **全て literal**。rule 表現を禁止 (例: 「空文字を NULL 正規化」と書かず、input.field="" / expected.db_after.row.col=null と literal で書く)。
  - behavior rule は `domain.json#planned_changes[].behavior.rule` の 1 箇所のみ・test_case はその rule を exercise する concrete example。
  - `extra_steps[]`: E2E chain 等の追加 action。
- **coverage**: `gap` = scope=required で test_case を持たない requirement 数 (**planning 完了 gate = 0**)。
- **grounding** (Z11.0 で 5 軸に拡張): 各軸の `ungrounded == 0` を planning 完了 gate とする。
  - `trigger_path`: test_case.trigger.path が domain.endpoints に grounded
  - `db_table`: expected.db_after.table が domain.entities に grounded
  - `db_column`: expected.db_after.row の各 col が domain.entities[].columns に grounded
  - `input_field` (Z11.0 新規・旧 M1 解消): test_case.input の各 field 名が domain.endpoints[].form_fields に grounded
  - `html_message` (Z11.0 新規・旧 C2 解消): expected.http.html_contains の各 message が domain.endpoints[].messages[].literal または planned_changes[].behavior に grounded

各軸とも、domain.entities/endpoints に literal match → `grounded` / planned_changes[] に declare → `planned` / どちらでもない → `ungrounded` (= planner が想像で書いた疑い・halt)。

---

## Discovery → Planning → Generator/Evaluator の flow

```
[discoverer (Discovery phase)]
  plan/domain.json を生成 (entities + endpoints + named_states + planned_changes)
     │
     ▼  Planner が domain を grounding source として消費
[Planner (pge-planning Phase 3.5)]
  plan/sprint.json を author (requirements + test_cases)
  coverage.gap == 0 + grounding.*.ungrounded == 0 を完了 gate
  plan/spec.md は薄い概要のみ
     │
     ├──▶ [generator]
     │      planned_changes.behavior.rule で logic 実装
     │      named_states.missing_components で factory 実装
     │      test_cases.expected.db_after.row で永続化 field 確定
     │
     └──▶ [evaluator-per-ac]
            担当 test_case (AC-N) を 1 つ受け取り:
            - state を domain.named_states から setup template echo (state setup のみ)
            - input を test_case.input から literal echo (POST body / GET query)
            - expected を test_case.expected から literal echo (assertion)
            → prose 推論ゼロで test artifact 生成
```

## 後方互換性 (Z10.x からの移行)

Z11.0 は Z9〜Z10.2 の schema を **置換** する (dual path を残さない = 複雑性の累積を断つ)。

- 旧 `state-map.json` / `scenario-catalog.json` / `data-model.json` / `spec-branches.json` は生成されなくなる
- 旧 reference (`discovery-schemas.md` / `spec-branches-schema.md` / `data-model-schema.md`) は削除
- 既存 sprint の retrofit は不要 (PoC 検証用・実 sprint は新規 Discovery から)

## 禁止事項 (本 schema を実装する agent 共通)

- 本 schema に **SUT 固有名詞** (entity 名 / FQCN / 固有 URL / 固有 column 名) を書く (placeholder shape のみ・instance は `plan/` 配下)
- `test_cases[].input` / `expected` に **rule 表現**を書く (literal only・正規化結果も literal で記す)
- 同じ behavior rule を `planned_changes[].behavior.rule` と test_case の両方に書く (rule は planned_changes に 1 箇所・test_case は literal example のみ)
- `named_states[].setup.steps[]` に test action (POST/GET/assert) を書く (state setup のみ・Z9.1 規約継承)
- `coverage.gap > 0` または `grounding.*.ungrounded > 0` の状態で Phase 5 (人間承認) に進む
- discoverer が entities / endpoints / messages を **Grep 確認なしに prose 推論で書く** (grounding 偽装)
- evidence 空のまま `confidence: high` を付ける

## 関連 file

- `.claude/agents/discoverer.md` (domain.json 生成)
- `.claude/skills/pge-planning/SKILL.md` Phase 3.5 (sprint.json author + gate)
- `.claude/agents/evaluator-per-ac.md` (test_case 消費)
- `.claude/agents/generator.md` (domain + sprint 消費)
- `.claude/agents/evaluator-aggregator.md` + `.claude/references/evaluator-per-ac-retry-protocol.md` §(d) (business_rule_conflict の domain.endpoints[].messages 参照)
