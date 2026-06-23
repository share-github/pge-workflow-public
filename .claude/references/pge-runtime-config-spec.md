# PGE Runtime Config Spec (PJ-side declaration format・schema v2)

PGE FW (`/pge-sprint-cycle` workflow) が parallel DB mode で SUT を駆動するために必要な **PJ 固有値** の declare 形式を定義する。**本 file には PJ 固有値 (image tag / port / URL / 起動コマンド等の literal) を一切含めない**。format 規約・field 意味・default だけを示す。

## 配置場所

PJ 固有 runtime config の正規配置場所は:

**`<PJroot>/plan/pge-runtime-config.json`**

(`<PJroot>` = PGE 起動 PJ root = workspace root)

生成手順: `/pge-runtime-survey` Skill を起動 (= PJ probe + AskUserQuestion + JSON 書出し)。`/pge-sprint-cycle` workflow が deterministic に `jq` で消費する。

## v1 → v2 設計変更

v1 は `1 app : N DataSource` 方式 (SUT 側 multi-datasource routing 実装に依存) だった。v2 は **`(1 app : 1 DB) × pool_size` の pair pool 方式**に変更:

| 軸 | v1 | v2 |
|---|---|---|
| 同時起動 app 数 | 1 (固定) | pool_size (config 値・default 5) |
| 同時起動 DB 数 | N (= AC 数) | pool_size |
| SUT 側 routing 実装 | 必須 (SUT 側 multi-datasource routing 機構) | 不要 |
| SUT に渡す env | isolation profile + DataSource map JSON | 標準の単一 DataSource URL のみ |
| AC 数 > pool_size の扱い | (該当しない・全 AC 同時) | batch 順次 (workflow JS が制御) |
| failure 隔離 | 共有 app が死ぬと全 AC | AC ごとに独立 container |
| memory profile | 1 app + N DB | pool_size × (1 app + 1 DB) |

v1 config は workflow が **halt + 「v2 に migrate してください」** を返す。互換維持はしない (PoC fast iteration 方針)。

## JSON schema (v2)

```json
{
  "schema_version": "2",
  "sut_root": "<absolute path to SUT root>",
  "app": {
    "framework": "<framework name (任意・記録目的)>",
    "language": "<language>",
    "build_tool": "<build tool>",
    "image": "<必須・docker image:tag (PJ が build 済)>",
    "dockerfile_path": "<任意 (推奨)・SUT root からの relative path・declare すると workflow が Generator 後に image rebuild する>",
    "build_context": "<任意・default '.'・docker build の context 引数>",
    "container_name_template": "<必須・per-AC app container 名 template・placeholder {ac_id_slug}・default pge-{ac_id_slug}-app>",
    "network": "<必須・docker network 名 (app と DB clone が同 network 内で通信する想定)>",
    "internal_port": <整数・必須・container 内 listen port>,
    "health_url_template": "<必須・health check 用 URL template・placeholder {container_name} と {internal_port}・default http://{container_name}:{internal_port}/・workflow が AC ごとに実行時置換 (docker network DNS で接続)>",
    "startup_timeout_seconds": <整数・default 60>,
    "datasource_env_name": "<必須・SUT が DataSource URL を受け取る env name (PJ owner が framework 公式 docs に基づき declare)>",
    "env": ["<KEY=VALUE>", ...]
  },
  "test_runner": {
    "engine": "<playwright|jest|vitest|cypress|pytest|...>",
    "language": "<typescript|javascript|python|...>",
    "install_dir": "<absolute path>",
    "config_path": "<relative to install_dir>",
    "test_dir": "<relative to install_dir>",
    "browsers": ["<browser>", ...]
  },
  "parallel_db": {
    "strategy": "<named-volume-clone|schema-per-ac|none>",
    "pool_size": <整数・default 5・同時起動 (app+DB) pair 数上限>,
    "kill_switch_env": "<env name・default 'PGE_ISOLATION_MODE'>",
    "ac_id_slug_rule": "<rule literal・default \"lowercase + remove '-'\"・top-level に昇格>",
    "db_clone": {
      "image": "<必須・clone container の DB engine image:tag>",
      "container_name_template": "<必須・default pge-{ac_id_slug}-db>",
      "volume_name_template": "<必須・default pge_{ac_id_slug}_data>",
      "datasource_url_template": "<必須・app に渡す DB URL の template・placeholder {ac_id_slug}>",
      "data_dir": "<必須・container 内 DB data directory>",
      "network": "<必須・clone container を接続する docker network>",
      "env": ["<KEY=value>", ...],
      "health_cmd": "<container 内で実行する health check 命令>",
      "health_timeout_seconds": <整数・default 90>,
      "baseline_volume_name": "<docker volume name (clone 元)>",
      "baseline_stop_command": "<任意・baseline_start_command 同時必須>",
      "baseline_start_command": "<任意・baseline_stop_command 同時必須>",
      "seed_file": "<任意・SUT root relative path・null 可能>",
      "seed_restore_command_template": "<任意・seed_file 同時必須・full bash command with {container_name} and {seed_file_host_path} placeholders>"
    }
  }
}
```

`parallel_db.strategy == "none"` の場合は `db_clone` を省略可能 (workflow は sequential 強制・pair pool mode 不発火)。

### Field 別の補足

#### `app.image`

PJ が SUT root の Dockerfile から build 済 image:tag。`/pge-runtime-survey` の段階では PJ owner が `docker build` 済前提 (= 未 build なら survey で halt)。**workflow 実行時は `app.dockerfile_path` が declare されていれば Generator 後に自動 rebuild** する (= sprint で src を変更しても container が旧 image を参照し続ける問題への構造的対応)。

#### `app.dockerfile_path` / `app.build_context`

任意 field。declare すると `/pge-sprint-cycle` workflow が **Generator phase 直後に Build-Image phase を挟んで** `docker build -t <app.image> -f <dockerfile_path> <build_context>` を実行する。build context は SUT root を base にした relative path (default `"."`)。未 declare の PJ では Build-Image phase は skip-with-warning され、log に「src 変更が container に伝播しない可能性」を出して進む (= volume mount + hot reload で src 変更が container に直接反映される PJ 向け)。

#### `app.container_name_template` / `db_clone.container_name_template`

placeholder `{ac_id_slug}` を `ac_id_slug_rule` で展開した値で置換。例: `AC-1` + default rule `"lowercase + remove '-'"` → `ac1` → container 名 `pge-ac1-app` (default `container_name_template`)。

#### `app.internal_port`

container 内で app が listen するポート。**Dockerfile の EXPOSE 行を一次資料とする** (= framework 別 default を本 spec で hardcode しない)。EXPOSE 不在の場合は PJ owner が framework 公式 docs に基づく値を declare する。

#### app への接続 (docker network DNS access)

workflow は app container を **`-p` flag 無しで** `docker run --network <app.network>` で起動する。host port mapping を使わず、PGE runner (= workflow が動いている container / 環境) と SUT app container を同一 docker network 上に置き、container DNS で接続する。

`app.health_url_template` は `{container_name}` と `{internal_port}` placeholder を持ち、AC ごとに workflow が実行時に置換する (`{container_name}` は `app.container_name_template` を `ac_id_slug_rule` で展開した値、`{internal_port}` は `app.internal_port` の値で置換)。host port 関連の field は廃止 (= host port mapping を使わないため、host 上の port 占有状況・他 batch との衝突・kernel port allocation の信頼性等が無関係になる)。

**前提**: PGE runner が SUT app container と同 docker network 上にいること。具体的には:

| runner 形態 | 想定動作 |
|---|---|
| devcontainer + docker socket mount | devcontainer 自身を `app.network` に join させる (docker-compose / devcontainer.json で declare) |
| CI runner container | runner container を `app.network` に join するか、network を runner 起動時に attach |
| bare host runner | docker bridge network 上の container DNS は host から直接解決できないので別途 access mode が必要 (本 spec ではサポートしない・将来的に access_mode field を opt-in 拡張で追加検討) |

testcontainers / docker-compose 内 service-to-service 接続と同じ pattern。

#### `app.health_url_template`

`{container_name}` placeholder は `app.container_name_template` を `ac_id_slug_rule` で展開した値 (= per-AC の container 名)、`{internal_port}` placeholder は `app.internal_port` の値で、workflow が AC ごとに実行時置換する。PJ owner は path 部分の宣言のみ行う (例: `http://{container_name}:{internal_port}/` / `http://{container_name}:{internal_port}/health` 等)。

#### `app.datasource_env_name`

SUT が **baseline で DB URL を受け取っている env name**。PJ owner は framework 公式 docs を一次資料に declare する。workflow はこの env name に clone container 用の URL (= `datasource_url_template` 展開値) を上書き渡しするだけで、SUT 側に特殊な実装は不要。

#### `parallel_db.pool_size`

同時起動可能な (app + DB) pair 数。memory bound 判断のための核心 field。

- `1` → 逐次実行 (= sequential mode と等価動作だが strategy != "none" なら DB clone は走る)
- `5` (default) → 通常推奨。Docker Desktop 8 GB 環境で memory 余裕
- 大きい値 → memory 必要・`.wslconfig` 拡張要

#### `parallel_db.ac_id_slug_rule`

AC ID (`AC-1`) を docker resource 名で使える形に変換する規則。v2 では top-level に昇格 (app と db_clone の双方が参照)。

#### `parallel_db.db_clone.datasource_url_template`

v2 新 field。app が読む DB URL の template。placeholder `{ac_id_slug}` を AC ごとに展開して app の `datasource_env_name` env に渡す。

PJ owner は SUT の baseline 接続文字列 (env / config / docker-compose) を起点に、host 部分のみ `pge-{ac_id_slug}-db` 等の clone container 名 placeholder に置換した URL を declare する。例: baseline 接続文字列 `<engine_scheme>://<baseline_db_host>:<port>/<schema>?<opts>` → template `<engine_scheme>://pge-{ac_id_slug}-db:<port>/<schema>?<opts>` → AC-1 展開 (default slug rule で `ac1`) `<engine_scheme>://pge-ac1-db:<port>/<schema>?<opts>`。app container は同 docker network 内に居るので DB container 名で名前解決できる。

#### `parallel_db.db_clone.baseline_stop_command` / `baseline_start_command`

v1 と同じ semantics (tar copy 中の baseline write race による clone 破損防止)。両方 declare or 両方 null。

#### `parallel_db.db_clone.seed_file` / `seed_restore_command_template`

v1 と同じ semantics (intra-AC retry 間の clone state restore)。両方 declare or 両方 null。

## Default 集

PJ が任意 field を省略した場合の default:

| field | default |
|---|---|
| `app.startup_timeout_seconds` | 60 |
| `app.env` | `[]` (空配列) |
| `app.dockerfile_path` | `null` (= Build-Image phase は skip-with-warning) |
| `app.build_context` | `"."` (= SUT root・`dockerfile_path` 宣言時のみ意味あり) |
| `parallel_db.pool_size` | 5 |
| `parallel_db.kill_switch_env` | `"PGE_ISOLATION_MODE"` |
| `parallel_db.ac_id_slug_rule` | `"lowercase + remove '-'"` |
| `parallel_db.db_clone.env` | `[]` |
| `parallel_db.db_clone.health_cmd` | null (image default healthcheck を期待) |
| `parallel_db.db_clone.health_timeout_seconds` | 90 |
| `parallel_db.db_clone.baseline_stop_command` | `null` |
| `parallel_db.db_clone.baseline_start_command` | `null` |
| `parallel_db.db_clone.seed_file` | `null` |
| `parallel_db.db_clone.seed_restore_command_template` | `null` |

その他必須 field は parse 時に不在を検出したら `/pge-sprint-cycle` は halt (sequential fall back ではない・config を直す必要があるため)。

## Discovery / Activation flow (`/pge-sprint-cycle` workflow 視点・v2)

```
workflow JS (Discovery phase):
  1. Read <PJroot>/plan/pge-runtime-config.json
     → 不在 → halt
     → schema_version != "2" → halt + "v2 への migration が必要です (/pge-runtime-survey 再起動)"
     → 必須 field 不在 → halt
  2. config.parallel_db.strategy == "none" → parallel DB mode を試行しない (sequential 確定)
     それ以外 → 候補

workflow JS (Generator phase):
  → spec.md の 1 sprint 分を実装 (generator agent が SUT src を変更)

workflow JS (Build-Image phase・Generator 直後):
  → config.app.dockerfile_path が宣言されていれば:
       cd <sut_root> && docker build -t <app.image> -f <dockerfile_path> <build_context>
       failure → halt (stale container での Per-AC 評価は無意味)
  → 宣言されていなければ skip-with-warning (volume mount / hot reload PJ 前提)

workflow JS (DB-Setup phase・iteration 0 のみ):
  3. PGE_ISOLATION_MODE env が "sequential" (kill switch) → sequential 強制
  4. plan/test-investigation/phase2/db_isolation_catalog.json の selected_entry を Read
     → "none" or 不在 → sequential
  5. 上記 3 + 4 + config.parallel_db.strategy != "none" の 3 条件全て揃 → pair pool mode activate
  6. activate 時 (iteration 0 では batch 構造を確定するだけ・実際の起動は Per-AC phase 内で batch 単位):
     a. spec.md から AC 一覧抽出
     b. pool_size 単位で AC を batch 分割 (例: 15 AC / pool=5 → 3 batches)
     c. ac_id_slug_rule で各 AC の slug を確定
     d. 各 AC について container_name / volume_name / datasource_url を template から展開

workflow JS (Per-AC phase・batch loop):
  for batch in batches:
    7. batch 内の N 個 (app + DB) pair を parallel 起動:
       - clone-named-volume.sh で per-AC DB clone を立ち上げ (baseline stop/start を 1 batch につき 1 回)
       - app を docker run で起動 (env に `<app.datasource_env_name>` = `parallel_db.db_clone.datasource_url_template` 展開値)
       - app は `-p` flag 無しで起動 (host port mapping 不要)・access は `app.health_url_template` の `{container_name}` と `{internal_port}` を展開した URL を介して docker network DNS で行う
       - 各 health check 完了まで polling
    8. batch 内の Per-AC × N を parallel 実行 (各 Per-AC は自分用の app URL を task description で受領)
    9. batch 完了後、batch 内の app container + DB container を dispose
    10. 次 batch へ

workflow JS (workflow 終了時・done/halt 共通の cleanup):
  11. 起動中の container があれば全 dispose (残骸を残さない・per-AC で disposal 失敗してた場合の保険)
```

## Sequential mode への fall back 判断

| 不在 wire / 条件 | 振る舞い |
|---|---|
| `PGE_ISOLATION_MODE == sequential` (kill switch) | sequential 強制 (wire 検査 skip) |
| `selected_entry == "none"` / TI phase2 db_isolation_catalog.json 不在 | sequential + log |
| `<PJroot>/plan/pge-runtime-config.json` 不在 | **halt** (config 整備が前提) |
| `schema_version != "2"` | **halt** (v2 migration 要) |
| `config.parallel_db.strategy == "none"` | sequential + log |
| `config.parallel_db.*` 必須 field 不在 | **halt** (parse error) |
| batch 起動中に 1 pair でも失敗 | 既起動分を dispose + sequential + log (or `PGE_ISOLATION_STRICT=true` 時は halt) |

## evaluator-per-ac への伝搬 (v2)

`/pge-sprint-cycle` workflow は pair pool mode activate 時、per-AC task description に以下を追加する:

```
parallel_db_mode: true
ac_id: "AC-K"
app_url: "<container DNS の URL>"   # この AC 専用の app URL (workflow が health_url_template の {container_name} と {internal_port} を AC ごとに置換)
db_container_name: "<container_name>"   # 当該 AC の DB clone container 名 (seed restore で使う)
seed_file_in_clone: "<seed_file>"        # null 可能
seed_restore_command_template: "<placeholder 置換後の literal command>"
runtime_config: plan/pge-runtime-config.json (必要に応じて Read)
```

v1 にあった `routing_header_name` / `routing_header_value` は v2 で消失 (= header dispatch しない・各 AC は自分専用の app URL に直接アクセスする)。

evaluator-per-ac は test artifact (Playwright/bash) 生成時に **自分の `app_url` をテストの baseURL として使う**。routing header の注入は不要。

## Sample 配置 example

`<PJroot>/plan/pge-runtime-config.json` の構造 (PJ 値は PJ が `/pge-runtime-survey` で埋める):

```json
{
  "schema_version": "2",
  "sut_root": "<absolute path>",
  "app": {
    "image": "<PJ 側 image:tag>",
    "container_name_template": "pge-{ac_id_slug}-app",
    "network": "<PJ 側 docker network>",
    "internal_port": <PJ 側 app port>,
    "health_url_template": "<URL template with {container_name} と {internal_port} (workflow が AC ごとに置換)>",
    "datasource_env_name": "<PJ 側 env name>"
  },
  "test_runner": { "engine": "<PJ 側>" },
  "parallel_db": {
    "strategy": "named-volume-clone",
    "pool_size": 5,
    "ac_id_slug_rule": "lowercase + remove '-'",
    "db_clone": {
      "image": "<PJ 側 DB image>",
      "container_name_template": "pge-{ac_id_slug}-db",
      "volume_name_template": "pge_{ac_id_slug}_data",
      "datasource_url_template": "<PJ 側 DB URL template with {ac_id_slug}>",
      "data_dir": "<PJ 側 data dir>",
      "network": "<PJ 側 docker network>",
      "env": ["<PJ 側 env>"],
      "baseline_volume_name": "<PJ 側 baseline volume>"
    }
  }
}
```
