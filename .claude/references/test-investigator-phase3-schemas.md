# Test Investigator Phase 3 JSON Schemas (catalog 専用)

このファイルは investigator (`phase: 3`) が出力する Phase 3 artifact の **schema 定義 catalog** (絶対ルール 11)。behavioral rule は `.claude/agents/investigator.md` Phase 3 節を一次資料とし、本ファイルは literal 引用元としてのみ使用する。

Phase 3 output の中で **`locator_catalog.json` は schema_version 2 から AC 横断 contract** に格上げされ、evaluator-per-ac の Step 0-g で contract echo が必須となる (multiplicity_hint と同じ contract enforcement pattern)。

---

## 1. ui_semantic_map.json

phase1 の `aria_snapshot.yaml` と phase2 の `template_inventory.json` を統合し、画面要素の意味的マップを作る。schema は loose (semantic 統合用)・evaluator は直接参照しない (補助資料)。

## 2. interactive_element_catalog.json

AC 横断で interactive 要素を flat list 化する。`IE-1..IE-N` の **AC 横断 ID 体系** を確立する Phase 3 の core artifact。`locator_catalog.json` の `by_element_id` キー集合の権威源。

### スキーマ

```json
{
  "generated_at": "<ISO 8601 timestamp>",
  "elements": [
    {
      "id": "IE-1",
      "screen": "<screen-slug from phase1/<slug>/>",
      "label": "<human-visible label literal from aria_snapshot.yaml>",
      "aria_name": "<accessible name literal>",
      "aria_role": "<role literal>",
      "html_id": "<id attribute or null>",
      "html_name": "<name attribute or null>",
      "type": "<text|textarea|date|select|checkbox|radio|submit|link|button|...>",
      "required": true,
      "maxlength": 100,
      "placeholder": "<placeholder literal or null>",
      "options": ["<option1>", "<option2>"],
      "default": "<default value or null>",
      "form": "<form id/name or null>",
      "href": "<link href or null>",
      "param": "<query param name or null>"
    }
  ]
}
```

### フィールド規約

| field | 規約 |
|---|---|
| `id` | `IE-<N>` 形式 (N は 1 始まり連番)・AC 横断で unique・以後 sprint 跨ぎでも安定 ID として使う |
| `screen` | `plan/test-investigation/phase1/<screen-slug>/` の slug literal |
| `aria_role` | Playwright `getByRole` の role 引数として利用可能な値 (textbox / button / link / combobox / checkbox / radio 等) |
| `aria_name` | Playwright `getByRole(.., { name })` の name 引数として利用可能な literal・`label` と同値のこともある |
| 他 | HTML attributes (html_id / html_name / required / maxlength 等) は template_inventory.json から literal 引用 |

LLM 推論で IE-N を発明しない (phase1 aria_snapshot.yaml + phase2 template_inventory.json に literal grounded のみ)。

## 3. locator_catalog.json (schema_version 2)

**AC 横断 contract**。`interactive_element_catalog.json` の各 IE-N に対し、**AX-first 優先順 (`getByRole > getByLabel > getByText > getByTestId > CSS`) + uniqueness 機械検証** で確定した `selected` selector を持つ。

evaluator-per-ac Step 0-g は本 contract を **literal echo 必須** (`locator_catalog_consumed: true` + 自己推論で上書き禁止)。

### スキーマ

```json
{
  "schema_version": "2",
  "generated_at": "<ISO 8601 timestamp>",
  "source_files": {
    "interactive_element_catalog": "plan/test-investigation/phase3/interactive_element_catalog.json",
    "aria_snapshots": ["plan/test-investigation/phase1/<slug>/aria_snapshot.yaml", "..."]
  },
  "by_element_id": {
    "IE-1": {
      "screen": "<screen-slug>",
      "label": "<label literal from interactive_element_catalog>",
      "candidates_in_priority": [
        {
          "rank": 1,
          "strategy": "getByRole",
          "args": {"role": "<role>", "name": "<accessible name>"},
          "selector_literal": "page.getByRole('<role>', { name: '<accessible name>' })",
          "uniqueness": {"count_in_aria_snapshot": 1, "verified_pattern": "<grep pattern literal>"},
          "available": true
        },
        {
          "rank": 2,
          "strategy": "getByLabel",
          "args": {"text": "<label literal>"},
          "selector_literal": "page.getByLabel('<label literal>')",
          "uniqueness": {"count_in_aria_snapshot": 1, "verified_pattern": "<grep pattern literal>"},
          "available": true
        },
        {
          "rank": 3,
          "strategy": "getByText",
          "args": {"text": "<text literal>", "exact": true},
          "selector_literal": "page.getByText('<text literal>', { exact: true })",
          "uniqueness": {"count_in_aria_snapshot": 2, "verified_pattern": "<grep pattern literal>"},
          "available": false,
          "unavailable_reason": "count_in_aria_snapshot > 1 (not unique)"
        },
        {
          "rank": 4,
          "strategy": "getByTestId",
          "args": {"testid": "<data-testid value>"},
          "selector_literal": "page.getByTestId('<data-testid value>')",
          "uniqueness": {"count_in_aria_snapshot": 1, "verified_pattern": "<grep pattern literal>"},
          "available": true
        }
      ],
      "selected": {
        "rank": 1,
        "strategy": "getByRole",
        "selector_literal": "page.getByRole('<role>', { name: '<accessible name>' })",
        "selection_reason": "ax-first-rank-1 + count_in_aria_snapshot==1"
      }
    }
  },
  "by_ac": {
    "AC-1": ["IE-1", "IE-2", "IE-6"],
    "AC-2": ["IE-4", "IE-6"]
  }
}
```

### フィールド規約

| field | 規約 |
|---|---|
| `schema_version` | `"2"` 固定 (本 schema version)・Phase 3 自身の output 互換性管理用 |
| `by_element_id.<IE-N>` | `interactive_element_catalog.json#elements[]` の `id` と 1:1 対応・全 IE が出現する必要はない (UI capability 対象外要素は省略可)・列挙された IE-N は必ず `interactive_element_catalog.json` に存在必須 |
| `candidates_in_priority[]` | AX-first 優先順で **必ず rank 1 から順に列挙**・`getByRole > getByLabel > getByText > getByTestId > CSS` の順序固定・各 candidate の available 判定は uniqueness 機械検証に基づく |
| `candidates_in_priority[].rank` | `1..5` の integer (5 = CSS fallback)・priority 順を literal echo |
| `candidates_in_priority[].strategy` | `getByRole` / `getByLabel` / `getByText` / `getByTestId` / `cssLocator` のいずれか |
| `candidates_in_priority[].args` | 各 strategy が要求する引数を literal で記録 (strategy 別 schema) |
| `candidates_in_priority[].selector_literal` | Playwright TypeScript で展開済の selector 文字列 literal (artifact 生成時にこれをそのまま展開) |
| `candidates_in_priority[].uniqueness.count_in_aria_snapshot` | `aria_snapshot.yaml` を grep した実 count (整数)・LLM 推論禁止 |
| `candidates_in_priority[].uniqueness.verified_pattern` | grep に使った pattern literal (再現性のため記録) |
| `candidates_in_priority[].available` | `count_in_aria_snapshot == 1` のとき `true`・それ以外 `false` |
| `candidates_in_priority[].unavailable_reason` | `available: false` のときの理由 literal |
| `selected` | `candidates_in_priority[]` のうち `available: true` の **最小 rank** entry を機械選択 (LLM 推論禁止)・全 candidate が `available: false` なら `selected: null` |
| `selected.selection_reason` | 機械選択の根拠 literal (例: `"ax-first-rank-N + count_in_aria_snapshot==1"`) |
| `by_ac.<AC-K>` | spec.md の AC-K 節で言及される interactive element の `IE-N` 列・spec.md AC text を Read し、`interactive_element_catalog.json#elements[].label` と部分一致するものを列挙・必ず `by_element_id` に存在する IE-N のみ参照可・空配列も許容 (UI capability 不使用 AC) |

### 機械判定アルゴリズム (Phase 3 が deterministic に実行)

```
for each element in interactive_element_catalog.json#elements:
    candidates = []

    # rank 1: getByRole
    if element.aria_role and element.aria_name:
        pattern = '^- ' + element.aria_role + ' "' + element.aria_name + '"'
        count = grep_count(aria_snapshot.yaml for element.screen, pattern)
        candidates.append({rank: 1, strategy: "getByRole", ..., uniqueness: count, available: (count == 1)})

    # rank 2: getByLabel
    if element.label:
        pattern = '<label-grep-pattern for element.label>'
        count = grep_count(...)
        candidates.append({rank: 2, strategy: "getByLabel", ..., available: (count == 1)})

    # rank 3: getByText
    if element.label:
        pattern = '"' + element.label + '"'
        count = grep_count(...)
        candidates.append({rank: 3, strategy: "getByText", ..., available: (count == 1)})

    # rank 4: getByTestId
    if element.html_id or template_inventory has data-testid for element:
        candidates.append({rank: 4, strategy: "getByTestId", ..., available: true})

    # rank 5: CSS fallback (html_id / html_name で)
    if element.html_id or element.html_name:
        candidates.append({rank: 5, strategy: "cssLocator", ..., available: true})

    selected = first candidate with available == true (or null if none)
    by_element_id[element.id] = { candidates_in_priority: candidates, selected: selected }
```

LLM 推論で selected を上書きしない (全行 deterministic)。

### halt 条件

| 条件 | blocker.reason |
|---|---|
| `interactive_element_catalog.json` が空 (elements[] = []) | halt しない (UI 不在 SUT を許容)・`by_element_id: {}` で記録 |
| 全 IE で `selected: null` (どの strategy も unique にできない) | halt しない・`by_element_id.<IE>.selected = null` を記録し、evaluator-per-ac が `chain_scope` 経由で多重度 hint を併用する |
| `aria_snapshot.yaml` を Read できない | halt: `aria-snapshot-unreadable` |

### 利用先

- **evaluator-per-ac Step 0-g**: `by_element_id[IE-N].selected.selector_literal` を **literal echo** (contract enforcement・自己推論で上書き禁止)
- **evaluator-per-ac Step 0-h (data_prep)**: `by_ac[AC-K]` の IE-N 列を navigation hint として利用
- **evaluator-per-ac Step 6 (artifact 生成)**: `selector_literal` を artifact (spec.ts) にそのまま展開・LLM が selector を発明する余地を消す

## 4. screen_structure_outline.md

人間可読サマリ。schema 規定なし (Markdown 自由 format)。

## 5. state_transition_hint.json

画面間遷移 hint。schema は loose (補助資料)・evaluator は補助参照のみ。

---

## 関連ファイル

- `.claude/agents/investigator.md` Phase 3 節 (本 schema の生成元 agent)
- `.claude/references/test-investigator-phase2-schemas.md` Phase 2 schemas
- `.claude/agents/evaluator-per-ac.md` Step 0-g (本 schema の consumer・contract echo 規約)
- `.claude/references/evaluator-per-ac-feedback-schema.md` `locator_specificity[]` schema
- `.claude/skills/test-design-contracts/SKILL.md` `multiplicity_hint` と並ぶ contract family の位置づけ
