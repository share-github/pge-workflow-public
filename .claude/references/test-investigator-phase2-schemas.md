# Test-Investigator: Phase 2 JSON スキーマ詳細

`test-investigator.md` Phase 2「Static Code Analysis」から参照される、Phase 2 成果物 JSON の完全スキーマ定義。

Phase 2 成果物を `plan/test-investigation/phase2/*.json` に書き出す**直前に必ず Read** すること。

## route_map.json

```json
{
  "routes": [
    {
      "id": "R-1",
      "url": "/<resource>",
      "method": "GET",
      "handler": "<package>.<Controller>#<method>",
      "templatePath": "<list template path>",
      "responseType": "html | json | redirect"
    }
  ]
}
```

## validation_rule_map.json

```json
{
  "validationRules": [
    {
      "scope": "field | form | class",
      "rule": "@NotBlank | @Size | @Pattern | ...",
      "field": "title",
      "constraints": {"min": <minN>, "max": <maxN>},
      "message": "<validation message literal>",
      "errorTrigger": "form submit"
    }
  ]
}
```

`scope` の区別は重要:
- `field`: field 個別の validation → `errorMessages` 配列に含めて test-designer に渡す
- `form`: 相関 validation（複数 field 跨ぎ・複数 field の組み合わせで成立する制約）
- `class`: クラスレベル validation（エンティティ全体に対する不変条件）

`field` のエラーメッセージのみを `errorMessages` 配列に含め、`form` / `class` の相関エラーは `state_transition_hint.json` の errorCase 側に記録する（test-designer がフォームレベルのエラーをフィールド固有エラーとして誤って test 化することを防ぐため）。

## api_contract_map.json

```json
{
  "endpoints": [
    {
      "url": "/api/<resource>",
      "method": "POST",
      "requestSchema": {"<primary text field>": "string", "<date field>": "ISO 8601 date"},
      "responseSchema": {"id": "long", "<primary text field>": "string"},
      "successStatus": 201,
      "errorStatuses": [400, 401, 422]
    }
  ]
}
```

## template_inventory.json

```json
{
  "templates": [
    {
      "path": "<list template path>",
      "type": "thymeleaf | jsx | vue | ...",
      "extends": "templates/layout.html",
      "fragments": ["<row fragment id>"],
      "conditionalBlocks": [
        {"directive": "th:if", "condition": "${errors}", "renderedDom": "<div class=\"alert\">...</div>"}
      ]
    }
  ]
}
```

## event_binding_map.json

```json
{
  "bindings": [
    {
      "elementSelector": "button[name='submit']",
      "templatePath": "<form template path>",
      "event": "click",
      "handler": "form.submit",
      "businessMeaning": "<entity> を保存する"
    }
  ]
}
```

## controller_action_map.json

```json
{
  "actions": [
    {
      "controller": "<Controller>",
      "method": "<action method>",
      "calls": ["<Service>.<method>", "<Repository>.<method>"],
      "transactionBoundary": "<Service>.<method>",
      "sideEffects": ["INSERT INTO <table>", "domain event <EventName>"]
    }
  ]
}
```

## available_capabilities.json (Phase Z2・旧 observation_means_by_kind.json を置換)

evaluator per-ac Step 0 が **capability composition** で test design を確定するための一次資料。SUT が支援する **trigger capability** (test 発動側) と **observation capability** (test 検証側) を [`evaluator-test-capabilities.md`](evaluator-test-capabilities.md) の catalog primitive 別に機械的に列挙する。

### スキーマ

```json
{
  "generated_at": "2026-06-08T10:00:00+09:00",
  "framework_summary": "<web framework> + <view-template engine> + <validation library> (<runtime version unspecified>)",
  "persistence": "<persistence summary>",
  "trigger": [
    {"name": "T-browser-navigate", "available": true, "evidence": "phase1/<screen>/aria_snapshot.yaml exists + <web framework> HTML UI"},
    {"name": "T-http-request-playwright", "available": true, "evidence": "playwright.config.ts exists + route_map.json has endpoints"},
    {"name": "T-http-request-curl", "available": true, "evidence": "route_map.json has N endpoints + curl universal"},
    {"name": "T-shell-command", "available": true, "evidence": "_framework.json: <framework> mainClass <application main FQCN>"},
    {"name": "T-sql-execution", "available": false, "reason": "persistence: <in-memory store primitive> (no DB)"},
    {"name": "T-file-creation", "available": false, "reason": "no file watcher / inbox pattern detected"},
    {"name": "T-message-publish", "available": false, "reason": "no kafka/rabbitmq/sqs dependency"}
  ],
  "observation": [
    {"name": "O-dom-content", "available": true, "evidence": "phase1 aria_snapshot.yaml + dom_snapshot.html generated"},
    {"name": "O-dom-locator-visible", "available": true, "evidence": "same as O-dom-content"},
    {"name": "O-aria-tree", "available": true, "evidence": "phase1/{<screen-slugs>}/aria_snapshot.yaml exist"},
    {"name": "O-http-status", "available": true, "evidence": "route_map.json + Playwright request mode available"},
    {"name": "O-http-response-shape", "available": false, "reason": "api_contract_map.json: 'No OpenAPI spec or JSON endpoints'"},
    {"name": "O-html-content", "available": true, "evidence": "_framework.json#view_engine_type='server-side-template' + T-http-request-curl available"},
    {"name": "O-exit-code", "available": true, "evidence": "T-shell-command available"},
    {"name": "O-stdout-pattern", "available": true, "evidence": "T-shell-command + grep universal"},
    {"name": "O-stderr-pattern", "available": true, "evidence": "T-shell-command + grep universal"},
    {"name": "O-sql-row-presence", "available": false, "reason": "T-sql-execution unavailable (in-memory persistence)"},
    {"name": "O-sql-column-value", "available": false, "reason": "same as O-sql-row-presence"},
    {"name": "O-log-line-pattern", "available": true, "evidence": "_framework.json logging: <logging library>"},
    {"name": "O-file-existence", "available": true, "evidence": "bash universal"},
    {"name": "O-file-content", "available": true, "evidence": "bash + grep universal"}
  ],
  "view_engine_type": "server-side-template"
}
```

### フィールド規約

- `framework_summary`: `_framework.json` の framework + version 文字列を転記
- `persistence`: framework から導出 (JPA / SQL / <in-memory store primitive> / Redis / DynamoDB 等)
- `trigger[]` / `observation[]`: capability catalog (evaluator-test-capabilities.md) の T-* / O-* primitive ごとの entry
  - `name`: capability ID (`T-browser-navigate` / `O-exit-code` 等・catalog 外の値は禁止)
  - `available`: boolean (機械判定)
  - `evidence`: available の場合の根拠 (phase1/phase2/phase3 の artifact ファイルへのリテラル参照 + framework config)
  - `reason`: unavailable の場合に**必ず**書く (なぜ available でないか・1 行)
- `trigger[]` / `observation[]` のそれぞれで **少なくとも 1 件は available** であること (全て unavailable なら test 不能・halt)

### 機械判定アルゴリズム

investigator phase 2 は以下の順で判定する:

1. `_framework.json` を Read して `persistence` / `logging` / `web_framework` / `mainClass` を確定
2. `api_contract_map.json` を Read して endpoint の有無 + response schema の declared 有無を確認
3. `route_map.json` を Read して endpoint 総数を確認
4. phase1 の `aria_snapshot.yaml` を Glob で確認し DOM observation 系 capability の available を判定
5. dependencies (`pom.xml` / `package.json` / `requirements.txt` 等) を Read して kafka/rabbitmq/sqs/file-watcher の有無を確認
6. 上記情報から各 capability の `available` を機械決定 (LLM 推論禁止・investigator.md「導出ルール」表参照)

### halt 条件

| 条件 | blocker.reason |
|---|---|
| `trigger[]` で `available: true` が 0 件 | `no-trigger-capability-available` |
| `observation[]` で `available: true` が 0 件 | `no-observation-capability-available` |
| available の組み合わせが既存 artifact_framework decision のどれにも該当しない | `no-viable-artifact-framework` |

### 利用先

- evaluator per-ac mode の Step 0-a (capability composition) で必須参照
- evaluator per-ac が AC ごとに `design.trigger_capabilities[]` / `design.observation_capabilities[]` を確定する際、本 file で `available: true` となっている capability のみから選択
- 必要な capability が unavailable な AC は evaluator 側で halt (`reason: "capability-not-available: <name>"`)

## db_isolation_catalog.json (Phase Z3+)

DB isolation catalog の machine-decided dispatch 結果。investigator Phase 2 (phase_id `7-db-isolation-catalog`) で生成される。一次資料は [`db-isolation-catalog.md`](db-isolation-catalog.md)。

### スキーマ

```json
{
  "generated_at": "ISO 8601",
  "db_engine": "postgresql | mysql | sqlite | mariadb | mssql | none",
  "db_engine_evidence": "<検出根拠 literal・build manifest 内の dependency 行を引用>",
  "host_environment": {
    "docker_socket_available": true,
    "docker_socket_evidence": "<検出根拠・/var/run/docker.sock の存在確認 等>",
    "host_fs_type": "btrfs | zfs | lvm-thin | overlay2 | ext4 | unknown",
    "host_fs_evidence": "<検出根拠 literal・df / mount 出力を引用>",
    "snapshot_plugin": "buttervolume | zfs-volume | none",
    "snapshot_plugin_evidence": "<docker plugin ls の literal 出力 or 不在理由>"
  },
  "baseline_volume": {
    "available": true,
    "volume_name": "<baseline volume の literal 名・PJ docker-compose.yml 等から検出>",
    "evidence": "<検出根拠・docker-compose.yml / docker volume ls の引用>"
  },
  "entries": [
    {
      "name": "postgres-template-database",
      "available": false,
      "reason": "db_engine: mysql (postgres ではない)"
    },
    {
      "name": "named-volume-fs-plugin",
      "available": false,
      "reason": "host_fs_type: overlay2 + snapshot_plugin: none"
    },
    {
      "name": "named-volume-clone",
      "available": true,
      "evidence": "docker_socket_available: true + baseline_volume.available: true"
    }
  ],
  "selected_entry": "postgres-template-database | named-volume-fs-plugin | named-volume-clone | none",
  "selected_entry_rationale": "<entries[] の available 順序から機械決定した根拠 literal>"
}
```

### フィールド規約

- `db_engine`: build manifest (`pom.xml` / `build.gradle` / `package.json` / `requirements.txt` / `go.mod` 等) から検出した DB engine。複数候補時は test setup で優先される engine (test runtime config) を採用
- `db_engine_evidence`: 検出 dependency 行の literal (engine 識別可能な座標を引用・version は PJ で検出された literal をそのまま転記)・LLM 推論で補わない
- `host_environment.host_fs_type`: `df -T <volume mount path>` / `mount | grep <volume>` から取得。コンテナ内環境等で取得不能な場合は `unknown` で記録 (Entry 2 を unavailable にすれば catalog 機能としては保てる)
- `host_environment.snapshot_plugin`: `docker plugin ls` の literal 出力から取得 (active state のもののみ)・empty なら `none`
- `baseline_volume.volume_name`: PJ の `docker-compose.yml` の `volumes:` セクションから DB service が mount している named volume 名を機械抽出 (DB engine 検出と同じ build manifest scan で得られなければ、`docker volume ls` を補助的に使う)
- `entries[]`: 必ず 3 entry (Entry 1-3) 全てを列挙 (unavailable も含む・catalog の全体像を保つ)
- `selected_entry`: 機械決定 (LLM 推論禁止)。優先順位は db-isolation-catalog.md Dispatch Logic に厳密従う:
  1. `entries[name=postgres-template-database].available == true` なら `"postgres-template-database"`
  2. else `entries[name=named-volume-fs-plugin].available == true` なら `"named-volume-fs-plugin"`
  3. else `entries[name=named-volume-clone].available == true` なら `"named-volume-clone"`
  4. else `"none"` (DB を使わない PJ / docker socket 不在等・catalog 機能 disable)

### 機械判定アルゴリズム

investigator Phase 2 phase_id `7-db-isolation-catalog` は以下の順で判定する:

1. build manifest を Read して `db_engine` を確定 (jdbc driver / ORM driver の dependency literal を grep)
2. `docker-compose.yml` / `docker-compose.*.yml` / Helm chart 等を Glob で検索 → DB service の `volumes:` section を Read して `baseline_volume.volume_name` を抽出
3. `test -S /var/run/docker.sock` / `which docker` で `docker_socket_available` 判定
4. `df -T` / `mount` で host FS type を取得 (取得不能なら `unknown`)
5. `docker plugin ls --filter enabled=true` で snapshot plugin の install 状況を取得 (失敗時は `none`)
6. 上記情報から `entries[].available` を機械決定 → `selected_entry` 確定 → `db_isolation_catalog.json` を Write

### halt 条件

| 条件 | blocker.reason |
|---|---|
| build manifest を読めない (Read 全失敗) | `build-manifest-unreadable` |
| `db_engine` 検出後に `docker-compose.yml` 等 manifest が全て不在で `baseline_volume.volume_name` 抽出不能 (= DB が container 化されていない PJ) | catalog 結果は `selected_entry: "none"` で OK・halt しない (catalog 機能を諦めるだけ・他の Phase 2 artifact は通常生成) |

### 利用先

- orchestrator (= `/pge-sprint-cycle` workflow) Step 5-B-2 周辺で 2 wire (本 catalog の `selected_entry` + `<PJroot>/plan/pge-runtime-config.json#parallel_db.strategy`) 揃時に `selected_entry` を発火 (詳細は `.claude/workflows/pge-sprint-cycle.js` Step 5-B-2-DB の prompt と activation guard 実装を参照・`PGE_ISOLATION_MODE=sequential` kill switch で強制 OFF 可・Phase Z7+ で workspace root CLAUDE.md inline YAML 規約は廃止し JSON file 一元化)
- evaluator-per-ac (Step 0) で hint として参照可 (test code shape の parallel/sequential 分岐は orchestrator が task description で `parallel_db_mode: true|false` を伝搬することで解決済)
