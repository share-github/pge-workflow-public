---
description: PJ root の build manifest / docker-compose / app config / test runner config を機械的に probe して、PGE workflow が deterministic に消費可能な plan/pge-runtime-config.json (schema v2) を生成する。v2 設計では (runtime*1:db*1)*N の pair pool 方式を取るため、app は container 化されている前提 (image declare 必須・PJ Dockerfile から build 済)。ambiguous 項目は AskUserQuestion で人間に確認。LLM 推論で値を fabricate しない。
disable-model-invocation: true
argument-hint: "(なし。引数取らない。既存 plan/pge-runtime-config.json があれば上書き確認する)"
---

# /pge-runtime-survey — PGE Runtime Config 生成 Skill (v2)

PGE workflow (`/pge-sprint-cycle`) が parallel DB mode を auto-activate するために必要な PJ 固有値を機械的に probe + 人間確認で集めて、**`<PJroot>/plan/pge-runtime-config.json`** (schema_version=2) を生成する。

## v1 → v2 設計変更 (重要)

v1 は `1 app : N DataSource` (SUT 側 multi-datasource routing 実装に依存) だったが、v2 は **`(1 app : 1 DB) × pool_size`** の pair pool 方式に変更:

- 各 AC が独立した app container + DB container の組を持つ
- 同時起動数は `parallel_db.pool_size` で上限 (default 5)
- N > pool_size のときは batch 順次実行 (workflow JS が制御)
- SUT 側に routing 実装は不要 (= framework-agnostic 性が向上)
- 各 app は標準の単一 DataSource を `datasource_env_name` 経由で受け取るだけ

## 入出力

- **入力**: PJ root の build manifest / docker-compose / application config / test runner config / Dockerfile (本 Skill が自動 Read)
- **入力 (必要時)**: 人間への AskUserQuestion (defaults を提示しつつ確認)
- **出力**: `<PJroot>/plan/pge-runtime-config.json` (schema_version=2・workflow が一次資料として参照する単一の真実 source)

## 絶対ルール (Skill 実行時)

1. **LLM 推論で値を fabricate しない**。Read で確証取れない field は AskUserQuestion で人間に聞く
2. **既存 `plan/pge-runtime-config.json` を黙って上書きしない**。存在時は diff を表示して人間確認後に上書き
3. **schema v1 config が既存なら v2 への破壊的移行**を明示告知してから上書き (v1/v2 互換維持はしない・v1 → v2 自動 migration もしない)
4. **PJ root の決定**: `.claude/` ディレクトリの parent を PJ root とする (`pwd` で確定)
5. **schema_version = "2"** を必ず record
6. **必須 field のいずれかが解決できない場合は halt し、人間判断を仰ぐ** (sequential mode への自動 fall back を Skill 側でしない・それは workflow 側 2 wire 判定の責務)
7. **app は container 化されている前提**。PJ に Dockerfile が無い場合は halt + 「app を container 化してから再起動してください」

## Probe 順序

### Step 1: PJ root + SUT root の決定

- PJ root: 本 Skill 起動時の cwd (= `pwd`・`.claude/` の parent と一致する想定)
- SUT root: build manifest (build.gradle / build.gradle.kts / pom.xml / package.json / Cargo.toml / pyproject.toml / go.mod) が存在する直下のディレクトリ
  - 複数候補なら AskUserQuestion で人間に選択させる

### Step 2: app section の決定 (v2 新)

| field | 取得方法 |
|---|---|
| `framework` | build manifest を Read して dependency から検出 (任意・記録目的) |
| `language` | manifest 種別から確定 |
| `build_tool` | manifest 種別から確定 |
| `image` | **必須**。SUT root に Dockerfile が無ければ halt。docker image tag 候補を `docker images --format '{{.Repository}}:{{.Tag}}'` で listing → AskUserQuestion で選択。tag 未 build なら halt + 「`docker build` で image を作成してください」 |
| `dockerfile_path` | 任意 (推奨)。SUT root から Dockerfile への relative path を probe (`find . -maxdepth 3 -name 'Dockerfile*' -type f`) → 候補列挙 → AskUserQuestion で選択。declare すると workflow が Generator 後に自動 image rebuild する。未 declare の場合は warning log のみで rebuild は skip (= volume mount / hot reload で src 変更が container に直接反映される PJ 向け) |
| `build_context` | 任意。default `"."` (= SUT root)。dockerfile_path を declare したときのみ意味を持つ。AskUserQuestion で「`docker build -t <image> -f <dockerfile_path> <build_context>` の最後の引数」を確認 |
| `container_name_template` | default `pge-{ac_id_slug}-app` (placeholder `{ac_id_slug}`)・AskUserQuestion で確認 |
| `network` | docker-compose の networks を listing して `docker network ls --format '{{.Name}}'` と照合 (DB clone と同じ network 推奨・AskUserQuestion で確認) |
| `internal_port` | Dockerfile の `EXPOSE` 行を **一次資料** として読み取る。EXPOSE が複数あれば AskUserQuestion で「主 listen port を declare してください」。EXPOSE が無い場合は AskUserQuestion で「PJ の framework 公式 docs に基づく default listen port を declare してください」(framework 別 literal を本 SKILL に hardcode しない) |
| `health_url_template` | default `http://{container_name}:{internal_port}/`。AskUserQuestion で確認 (`/health` 等の health endpoint path があれば置換)。`{container_name}` と `{internal_port}` placeholder は workflow が AC ごとに実行時置換する (= docker network DNS で接続するため・host port mapping 不要)。前提: PGE runner (devcontainer / CI runner) が SUT app container と同 docker network 上 |
| `startup_timeout_seconds` | default 60。重い build 系 (gradle/sbt/maven) や container cold start なら 90 を提示 |
| `datasource_env_name` | **必須**。AskUserQuestion で「PJ の framework 公式 docs に基づき SUT が baseline で DB 接続 URL を受け取っている env name を declare してください (= 同名 env に clone URL を上書き渡しする)」と提示・本 SKILL に framework 別 literal を hardcode しない |
| `env` | 任意・追加 env・配列形式 `["KEY=VALUE", ...]`。AskUserQuestion で「container 起動時に `datasource_env_name` 以外で必須となる env はありますか? (framework の profile / runtime mode / feature flag 等)」を聞き、空でも OK |

### Step 3: test_runner section の決定 (v1 + Phase Z3+ noise_filter 追加)

| field | 取得方法 |
|---|---|
| `engine` | `playwright.config.{ts,js,cjs}` / `jest.config.*` / `vitest.config.*` / `cypress.config.*` を find して特定 |
| `language` | config file の拡張子 |
| `install_dir` | config file の dirname |
| `config_path` | install_dir からの relative path |
| `test_dir` | config file を Read して `testDir` / `roots` 設定から取得 |
| `browsers` | Playwright `projects` 設定から取得・default `["chromium"]` |
| `fixtures_module_path` | default `.pge-fixtures` (SUT root 直下)・AskUserQuestion で「Playwright fixture module (`.pge-fixtures` 系) を SUT root 以外に配置しているなら relative path を declare してください (monorepo / 別 package 配下のとき)」と提示 |
| `noise_filter.network_abort[]` | default `[]` (空配列・何も block しない)・PJ owner に「E2E 実行時に block したい network request pattern (favicon / analytics / HMR endpoint 等の dev 環境ノイズ) が任意で declare 可能。常識的に block すべき汎用 pattern は `["**/favicon.ico"]` 1 件のみ提案」と AskUserQuestion |
| `noise_filter.console_suppress_pattern` | default `""` (空文字・何も suppress しない)・PJ owner に「console.log/warn に出現する HMR / vite / dev hot reload の noise を suppress する正規表現 (1 本) を任意で declare 可能。例: `\\[HMR\\]\|\\[vite\\]\|sourcemap`」と AskUserQuestion |

noise_filter の値は orchestrator が `.pge-fixtures.ts` に literal 注入する (詳細は [`.claude/references/playwright-fixture-template.md`](../../references/playwright-fixture-template.md))。PJ 固有 endpoint を block しないよう注意 (test 本質が壊れる)。

### Step 4: parallel_db section の決定 (v2 簡略化)

#### 4-1: pool_size

- default `5`。AskUserQuestion で「(app + DB) 同時起動数の上限を declare してください (memory bound のため・Docker Desktop 8 GB 環境なら 5 推奨)」を提示
- 0 / 負値 / 1 (= sequential 等価) は valid (1 なら逐次実行・並列 0)

#### 4-2: ac_id_slug_rule (top-level に昇格)

- default `"lowercase + remove '-'"` (`AC-1` → `ac1`)・RFC 952/1123 host header validation 下流 (例: Apache Tomcat 系の embedded server) で underscore を含む hostname が rejected されるケースに合わせ underscore を含まない slug を default 採用
- 別案 `"lowercase + replace '-' with '_'"` (`AC-1` → `ac_1`)・hostname validation を行わない downstream にのみ適用可・AskUserQuestion で「container 名が hostname として http parse される downstream で hostname validation の有無」を確認した上で選択

#### 4-3: strategy + DB engine 特定

- `docker-compose.yml` を Read して `services.<name>.image` から engine + version を抽出 (`<db_engine>:<version>` 形式・PJ の docker-compose に declare されている値そのまま)
- 複数 DB service があれば AskUserQuestion で「どれが baseline か」を聞く
- DB service がなければ `parallel_db.strategy = "none"` (= 当 PJ は parallel DB mode 非対応) を提案して人間確認

| strategy | 適用条件 |
|---|---|
| `named-volume-clone` | docker socket が host に mount されている + DB service が named volume を持つ |
| `schema-per-ac` | 単一 DB instance 内で database 名を AC ごとに分ける運用 (将来拡張・現状未実装) |
| `none` | 上記いずれも不可・workflow は sequential 強制 |

#### 4-4: db_clone section (v1 とほぼ同じ・追加 1 field)

| field | 取得方法 |
|---|---|
| `image` | docker-compose の DB service image を copy |
| `container_name_template` | default `pge-{ac_id_slug}-db`・AskUserQuestion で確認 |
| `volume_name_template` | default `pge_{ac_id_slug}_data`・AskUserQuestion で確認 |
| **`datasource_url_template`** (v2 新) | **必須**。app に渡す DB URL の template。placeholder `{ac_id_slug}` (container 名と一致)。AskUserQuestion で「SUT が DB へ接続している実 URL の host 部分のみ `pge-{ac_id_slug}-db` 等の clone container 名に置換した URL を declare してください」と提示し、SUT の baseline 接続文字列 (env / config / docker-compose の DB 接続情報) を起点に組み立てさせる。DB engine / port / schema 名は本 SKILL では declare せず、PJ owner が baseline 値をそのまま使う |
| `data_dir` | DB engine 公式 docs の data directory path (AskUserQuestion で「PJ の DB engine の公式 docs に基づく container 内 data directory path を declare してください」と提示・本 SKILL では engine 別 literal を hardcode しない) |
| `network` | docker-compose の networks → `docker network ls` 照合・AskUserQuestion |
| `env` | docker-compose の environment から DB root 認証 env のみ抽出 |
| `health_cmd` | docker-compose の healthcheck.test を copy |
| `health_timeout_seconds` | default 90 |
| `baseline_volume_name` | `docker volume ls --format '{{.Name}}'` で grep + 既存 `db_isolation_catalog.json#baseline_volume.volume_name` と一致確認 |
| `baseline_stop_command` | docker-compose の DB service container_name を probe → default `docker stop <baseline_container>` を AskUserQuestion で提示・「null (= 停止せず tar copy・silent corruption risk 受容)」選択肢も併記 |
| `baseline_start_command` | baseline_stop_command と pair・default `docker start <baseline_container>` |
| `seed_file` | SUT root から `find . -maxdepth 4 -type f \( -path './db/seed*.sql' -o -path './sql/seed*.sql' -o -path './scripts/seed*.sql' \)` で候補列挙 → AskUserQuestion で確認 |
| `seed_restore_command_template` | `seed_file != null` のときのみ probe・full bash command literal with `{container_name}` と `{seed_file_host_path}` placeholders。`docker exec -i {container_name} <DB CLI invocation> < {seed_file_host_path}` 形式 |

#### 4-5: kill_switch_env

- default `"PGE_ISOLATION_MODE"` (FW 規約)

### Step 4.6: regressive_fix_scan section の決定 (Phase Z9+ 新規)

Generator 4.6-A の退化的修正 self-check が grep で消費する **PJ 別 pattern catalog** を declare する。本 SKILL に stack-specific literal (Java annotation / Python decorator 等) を hardcode せず、SUT を probe + AskUserQuestion で 1 group ずつ collect する。

#### 4.6-1: SUT probe (file extension + annotation token 抽出)

1. SUT root 配下を file extension で listing (`find <sut_root> -maxdepth 6 -type f -name '*.<ext>'` を列挙)・stack を機械検出
2. 検出した extension に対し、**generic な annotation token regex** で SUT 内の使用箇所を grep (例: `@[A-Z][a-zA-Z]+\s*\(` のような汎用 token・本 SKILL に specific annotation 名を書かない):
   - 検出件数を「`<extension>: <unique_token_count>` 件」形式で集計
3. 件数 0 件の extension は本 step を skip (= scan group に追加しない)

#### 4.6-2: group ごとの declare

検出された extension 集合に対し、AskUserQuestion で以下を 1 group ずつ確認:

```
question: "[<group description>] SUT 内で grep した結果、以下の generic token pattern が検出されました。退化的修正 detect 対象 group として `regressive_fix_scan.groups[]` に追加しますか?"
options:
  - label: "追加 (推奨 default を使う)"
    description: "<集計結果>"
  - label: "追加 (regex を手動で declare)"
    description: "PJ owner が file_globs[] + removed_token_regex を手入力"
  - label: "skip"
    description: "本 group は scan しない (PJ CI / lint で代替検知している場合等)"
```

各 group の field:

| field | 取得方法 |
|---|---|
| `id` | AskUserQuestion で「短い group identifier (lowercase + hyphen のみ・例: `client-view` / `server-validation` / `auth-decorator`)」を確認 |
| `description` | AskUserQuestion で「このグループが保護する規約の 1 行説明」を確認 |
| `file_globs` | 検出 extension から `["*.<ext1>", "*.<ext2>"]` 形式に組み立てて AskUserQuestion で確認 (追加 / 削除可) |
| `removed_token_regex` | **PJ owner が手入力**・SUT 内で grep した unique token list を AskUserQuestion で提示し、保護対象の regex を 1 本に組み立てて declare させる (本 SKILL に specific annotation 名を hardcode しない・LLM 推論で値を fabricate しない) |

#### 4.6-3: 集約

declare された全 group を `regressive_fix_scan.groups[]` に push。1 件も declare されなかった場合は空配列 `[]` (= 退化的修正 detect は dis-armed・generator.md 4.6-A は warning log で skip)。

#### 4.6-4: 失敗時 / skip 時

- PJ owner が「本 self-check は不要」と判定した場合 → 全 group を skip → 空配列で生成 (= dis-armed)
- PJ owner が想定する pattern が SUT に 1 件も grep 不能な場合 → 該当 group を skip + 警告ログ表示

### Step 5: 既存 schema v1 config の検出と移行案内

PJ root の `plan/pge-runtime-config.json` が `schema_version: "1"` のとき:

1. v1 → v2 の差分を表示 (削除 field / 追加 field を箇条書き)
2. AskUserQuestion で「v2 schema で新規生成しますか? (v1 は破壊的に置換されます)」を確認
3. 確認後は本 Skill が v2 schema で完全に新規生成する (v1 値の自動 carry-over はしない・人間が AskUserQuestion で再入力)

### Step 6: 書き出し + 確認

1. `<PJroot>/plan/` ディレクトリが無ければ `mkdir -p plan`
2. 既存 `plan/pge-runtime-config.json` があれば diff を `diff -u` で表示し、AskUserQuestion で上書き確認
3. Write tool で JSON を書き出し
4. `jq -e '<schema check>'` で構文 + 必須 field 確認
5. 最終 summary: 「JSON 生成完了 (schema_version=2)。`/pge-sprint-cycle` で (runtime*1:db*1)*pool_size の pair pool mode が auto-activate されます。kill switch は env `<kill_switch_env>=sequential`」

## 出力 JSON schema (v2)

```json
{
  "schema_version": "2",
  "sut_root": "<absolute path to SUT root>",
  "app": {
    "framework": "spring-boot | express | django | rails | nextjs | ...",
    "language": "java | typescript | python | ruby | go | ...",
    "build_tool": "gradle | maven | npm | yarn | pnpm | cargo | poetry | go | ...",
    "image": "<docker image:tag (PJ が build 済)>",
    "dockerfile_path": "<SUT root からの relative path・任意 (推奨)>",
    "build_context": "<docker build の context・任意・default '.'>",
    "container_name_template": "pge-{ac_id_slug}-app",
    "network": "<docker network name>",
    "internal_port": <integer・container 内 listen port>,
    "health_url_template": "<URL template with {container_name} and {internal_port} placeholders>",
    "startup_timeout_seconds": <integer>,
    "datasource_env_name": "<env name for DB URL (PJ owner が framework 公式 docs に基づき declare)>",
    "env": ["<KEY=VALUE>", ...]
  },
  "test_runner": {
    "engine": "playwright | jest | vitest | cypress | pytest | ...",
    "language": "typescript | javascript | python | ...",
    "install_dir": "<absolute path>",
    "config_path": "<relative to install_dir>",
    "test_dir": "<relative to install_dir>",
    "browsers": ["<browser>", ...],
    "fixtures_module_path": "<SUT root relative path・default '.pge-fixtures'>",
    "noise_filter": {
      "network_abort": ["<glob or regex pattern>", "..."],
      "console_suppress_pattern": "<regex pattern (single string)・空文字なら何も suppress しない>"
    }
  },
  "regressive_fix_scan": {
    "groups": [
      {
        "id": "<group identifier (lowercase + hyphen)>",
        "description": "<1 行説明>",
        "file_globs": ["<git diff glob>", "..."],
        "removed_token_regex": "<grep -E に渡す regex (1 本)>"
      }
    ]
  },
  "parallel_db": {
    "strategy": "named-volume-clone | schema-per-ac | none",
    "pool_size": <integer・default 5・同時起動 (app+DB) pair 数上限>,
    "kill_switch_env": "<env name>",
    "ac_id_slug_rule": "<rule literal・top-level に昇格>",
    "db_clone": {
      "image": "<docker image:tag>",
      "container_name_template": "pge-{ac_id_slug}-db",
      "volume_name_template": "pge_{ac_id_slug}_data",
      "datasource_url_template": "<URL with {ac_id_slug} placeholder>",
      "data_dir": "<container path>",
      "network": "<docker network name>",
      "env": ["<KEY=VALUE>", ...],
      "health_cmd": "<command>",
      "health_timeout_seconds": <integer>,
      "baseline_volume_name": "<docker volume name>",
      "baseline_stop_command": "<full bash command, or null>",
      "baseline_start_command": "<full bash command, or null>",
      "seed_file": "<SUT root relative path, or null>",
      "seed_restore_command_template": "<full bash command with {container_name} and {seed_file_host_path} placeholders, or null>"
    }
  }
}
```

`parallel_db.strategy == "none"` の場合は `db_clone` を省略可能 (workflow は sequential 強制)。

## 失敗時の振る舞い

- **build manifest が見つからない** → halt + 「PJ root に build manifest がありません」
- **Dockerfile が見つからない / app image が build されていない** → halt + 「app を container 化してから再起動してください」(v2 では必須)
- **docker-compose.yml が見つからない & DB service 不明** → AskUserQuestion で「parallel DB mode を skip しますか?」→ yes なら `parallel_db.strategy = "none"` で生成
- **必須 field 不在** → 該当 field の AskUserQuestion を repeat

## 起動後の手順 (人間向け)

1. `/sut-precheck` で SUT 環境確認
2. PJ で `docker build -t <image>:<tag> <SUT root>` で app image を build (v2 必須)
3. `/pge-runtime-survey` → `plan/pge-runtime-config.json` 生成 (schema_version=2)
4. `/pge-planning <要望>` で spec.md 作成
5. `/pge-sprint-cycle` で full cycle 実行 (pair pool mode が config の存在で auto-activate)

## 補足: SUT-side routing 実装はもう不要

v1 では SUT 内部に multi-datasource routing 実装 (request context から DataSource を切り替える機構) を要求していたが、v2 では各 AC が独立した app container を持つため routing は不要。SUT は標準の単一 DataSource を `datasource_env_name` 経由で受け取れれば足りる (= PJ owner が declare した env name に clone URL を上書き渡しするだけで、SUT 側に特殊な実装は不要)。
