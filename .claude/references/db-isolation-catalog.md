# DB Isolation Catalog (PGE FW 正本)

> `.claude/pge-dev-reports/20260609/thinking/db-isolation-convergence-and-catalog.md` の議論収束結果を **PGE FW の正本** として再構成。investigator Phase 2 + evaluator-per-ac + orchestrator (SKILL.md Step 5-B) はすべて本ファイルを一次資料とする。

## 1. 目的

per-AC test 並列実行時、AC 間で DB 状態が干渉しないようにする isolation 機構の選択肢を catalog 化する。LLM は SQL を書かない・FW は per-AC clone orchestration のみ担当する三層責任分担を前提とする。

## 2. Catalog (3 entry)

### Entry 1: `postgres-template-database`

| 項目 | 内容 |
|---|---|
| 検出条件 | PJ の DB engine が PostgreSQL + `CREATE DATABASE FROM TEMPLATE` 利用可能 |
| 仕組み | 単一 Postgres instance 内で `CREATE DATABASE ac_N TEMPLATE baseline;` |
| baseline 準備 | 人間が baseline DB を populate (schema + master + transactional) |
| per-AC clone | `CREATE DATABASE` SQL のみ (engine 内完結) |
| docker socket | 不要 |
| latency | 10-30 ms / clone (IntegreSQL benchmark) |
| 適用範囲 | PostgreSQL 系全般 (PG 8.0+) |

### Entry 2: `named-volume-fs-plugin`

| 項目 | 内容 |
|---|---|
| 検出条件 | host OS が BTRFS / ZFS / LVM thin pool + docker volume plugin install 済 |
| 仕組み | named volume を CoW snapshot で per-AC instance に分岐 |
| baseline 準備 | 人間が named volume に baseline DB を populate |
| per-AC clone | `docker volume create --opt clone-from=<base> ac_N` (plugin 経由) |
| docker socket | 必要 |
| latency | instant (CoW) |
| 適用範囲 | dev infra に plugin install 可能な PJ・大規模 SaaS |

### Entry 3: `named-volume-clone` (default fallback)

| 項目 | 内容 |
|---|---|
| 検出条件 | (上記 2 つに該当しない場合の default) docker socket 利用可能 + DB が named volume で動作 |
| 仕組み | baseline DB の named volume を **AC 数分複製** (素朴な `docker volume create` + データ copy) し、各 volume を mount した DB container を AC 数分 並列起動 |
| baseline 準備 | 人間が baseline named volume に DB を populate (別途 dump / restore ツールは不要・volume 自体が baseline) |
| baseline 整合性 | tar copy 中の baseline DB write race を防ぐため、PJ が runtime config の `baseline_stop_command` / `baseline_start_command` を declare すれば `/pge-sprint-cycle` workflow が tar copy 前後で baseline DB を停止/再起動する (一対で declare 必須・両方 null なら旧動作で silent corruption risk 残存) |
| per-AC clone | (1) `docker volume create <prefix>_<ac>_data` (2) baseline volume → 新 volume へ `tar` pipe でデータ copy (3) 新 volume を mount した DB container を起動 (host port publish なし・network 内 container_name 経由でアクセス) |
| docker socket | 必要 |
| latency | clone 自体は volume size 依存 (中規模 ≤ 数秒・大規模は 10s 単位)・AC 並列で起動するため wall-clock は AC 1 個分の clone + startup 時間 |
| 適用範囲 | **どの PJ でも動く generic default** (DB engine 不問・FS 不問・plugin 不要) |

#### Entry 3 詳細フロー

```
[orchestrator (Step 5-B-2 周辺)]
  ↓
1. catalog detection 結果 (db_isolation_catalog.json) を Read
   → selected_entry == "named-volume-clone" を確認
   → base_volume / db_image / network / data_dir 等を取得
2. AC 数分 loop:
   - .claude/scripts/db-isolation/clone-named-volume.sh \
       --base-volume <baseline-volume-name> \
       --target-volume <prefix>_ac_<K>_data \
       --db-image <DB engine image:tag> \
       --container-name <prefix>_ac_<K>_db \
       --network <compose network> \
       --data-dir <container 内 DB data directory>
   - container が healthy になるまで wait
   注: host port publish は行わない (clone へのアクセスは network 内 container_name 経由で完結する設計)・
       container 内 listen port は image (engine) が決定し PJ が runtime config の per_ac_datasource.url_template
       に literal で declare 済 (例: `jdbc:<engine>://{container}:<image_internal_port>/...`)
3. 各 AC test には DB 接続情報 (host=container_name / port=image internal port) を runtime config の
   per_ac_datasource.url_template 経由で SUT に渡す
   ↓
[per-AC test 実行 (Playwright / bash)]
  ↓
[orchestrator (Step 5-B-7)]
  ↓
4. AC 数分 dispose:
   - .claude/scripts/db-isolation/dispose-named-volume.sh \
       --container-name <prefix>_ac_<K>_db \
       --target-volume <prefix>_ac_<K>_data
```

#### Entry 3 の注意点

- `docker commit` → image 化方式 (Zoosk pattern) ではなく **named volume 複製方式** を採用 (FW 側 image registry 管理不要・baseline 更新が dev cycle に自然に組み込まれる)
- baseline volume の DB process は **一時的に停止 or read-only mount** にして tar copy する (running 中の copy は inconsistent になりうる)
- Entry 2 と異なり plugin 不要・overlay2 でも動く・代わりに per-clone latency は volume size に比例 (大規模 baseline では Entry 2 の優位性が残る)

## 3. Dispatch Logic (機械判定)

investigator Phase 2 (`7-db-isolation-catalog`) が以下の順で検査:

```
1. PJ の DB engine を検出:
   - build manifest (pom.xml / build.gradle / package.json / requirements.txt / go.mod 等) で
     postgresql / postgres-jdbc / pg / psycopg / ... → DB engine = "postgresql"
   - mysql-connector / mysql / mysqlclient / mysql2 → DB engine = "mysql"
   - sqlite / sqlite3 → DB engine = "sqlite" (isolation 不要扱い)
   - DB engine 検出不可 → 後続 entry も unavailable とし catalog 結果は "no-db-isolation-required"

2. DB engine が postgresql の場合:
   - PostgreSQL 8.0+ の文法は普遍的に template database 利用可
   - Entry 1 を available として記録

3. host FS / docker plugin の検出:
   - df / lsblk / mount で FS type を取得 (host から見た / volume の FS)
     btrfs / zfs / lvm-thin のいずれか + `docker plugin ls` で snapshot plugin install 済
   - 該当時のみ Entry 2 を available として記録
   - コンテナ内環境では `/var/run/docker.sock` 経由で host docker を query (mount があれば可能・無ければ skip)

4. docker socket 利用可能性:
   - `/var/run/docker.sock` が mount されている (`test -S /var/run/docker.sock`)
   - docker CLI が利用可能 (`which docker`)
   - DB engine が container で動いている (baseline named volume が存在する)
   - 上記すべて該当時のみ Entry 3 を available として記録

5. selected_entry を機械決定:
   - Entry 1 available → "postgres-template-database" を選択
   - else Entry 2 available → "named-volume-fs-plugin" を選択
   - else Entry 3 available → "named-volume-clone" を選択
   - いずれも unavailable → "none" (isolation 不能・PJ が DB を使わない or socket 不在)
```

selected_entry が決定したら `db_isolation_catalog.json` に書き出す。詳細 schema は [`test-investigator-phase2-schemas.md`](test-investigator-phase2-schemas.md#db_isolation_catalogjson) を参照。

## 4. Catalog 活性化 (parallel vs sequential 判定・2 wire 自動判定)

「catalog を per-AC clone のために実際に発火させるか / sequential test で済ますか」は **2 wire 自動判定** で確定 (詳細は `.claude/workflows/pge-sprint-cycle.js` Step 5-B-2-DB の prompt と activation guard 実装を参照):

| wire | 検査内容 |
|---|---|
| (1) 自律検出 | `plan/test-investigation/phase2/db_isolation_catalog.json#selected_entry != "none"` |
| (2) PJ declaration | `<PJroot>/plan/pge-runtime-config.json#parallel_db.strategy != "none"` (Phase Z7+ で `/pge-runtime-survey` Skill が生成・workspace root CLAUDE.md の旧 inline YAML 規約は廃止) |

2 wire 揃 → catalog を per-AC clone で発火 (`/pge-sprint-cycle` workflow 起動だけで activate)。1 つでも欠ければ sequential gracefully fall back。

### Kill switch (任意)

`PGE_ISOLATION_MODE=sequential` env を明示すると 2 wire を skip して sequential 強制 (parallel を一時的に止める CI / debug 用途)。

### 議論履歴

判定置き場の確定経緯は `issue/SHOULD-isolation-mode-decision-point.md` (status: done) を参照。

## 5. 三層責任分担

| 層 | 担う責務 | 担わない責務 |
|---|---|---|
| 人間 | baseline 準備 (schema + master + transactional)・"良い状態" の declare → snapshot trigger・evidence の最終監査 | per-AC clone の orchestration・test code 実装 |
| LLM (PGE subagent) | Playwright / bash test code 実装・UI 操作 logic・assertion 設計・evidence attachment | **SQL を一切書かない** (DDL / DML / TRUNCATE / INSERT すべて)・baseline data 設計・migration script 作成 |
| PGE FW | catalog dispatch (本 file の Entry 1-3 から機械選択)・per-AC clone script 提供 (`.claude/scripts/db-isolation/`)・isolation 検証 (evaluator-auditor が cross-AC pollution 検査) | baseline の中身を決める・SQL を書く・PJ-specific な DB schema を assume する |

## 6. 棄却された案

| 案 | 棄却理由 |
|---|---|
| TRUNCATE per-table | LLM が FK 順序・soft-delete を maintain → fragile・業界権威一致 |
| Spring `@Transactional` rollback | nested transaction 非対応・SUT 構造で成立しない |
| migration tool only | migration は schema+master のみ・transactional precondition を解決しない |
| API-driven Arrange を FW 要件化 | PJ-specific API 依存 = PJ-agnostic 性と矛盾 |
| MySQL Clone Plugin 単独 | DB-specific → 汎用 FW catalog 主軸不適格 |
| `docker commit` → image 化 (Zoosk pattern) | FW 側 image registry 管理が必要・baseline 更新が dev cycle と乖離 (Entry 3 を named-volume-clone に再設計して棄却) |
| 「docker socket 露出回避」を必達条件化 | AI が host で動いている時点で socket mount は等価 risk |

## 7. 利用先

- **investigator Phase 2 (phase_id `7-db-isolation-catalog`)** — 本 catalog を一次資料に detection + `db_isolation_catalog.json` を出力
- **evaluator-per-ac (Step 0)** — `db_isolation_catalog.json` の `selected_entry` を hint として参照可 (test code shape は parallel/sequential 判定が確定してから利用)
- **orchestrator SKILL.md Step 5-B-2 / 5-B-7** — 2 wire 揃時に `selected_entry` を発火し clone / dispose script を実行 (`PGE_ISOLATION_MODE=sequential` kill switch で強制 OFF 可)

## 8. 参考実装

- `.claude/scripts/db-isolation/clone-named-volume.sh` — Entry 3 の per-AC clone (named volume copy + container 起動)
- `.claude/scripts/db-isolation/dispose-named-volume.sh` — Entry 3 の cleanup (container 停止 + volume 削除)
- Entry 1 / Entry 2 の参考実装 script は未提供 (該当 PJ 出現時に追加)
