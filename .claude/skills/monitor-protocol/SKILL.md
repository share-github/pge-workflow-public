---
description: PGE subagent の state.json 更新義務・phase 遷移命名規約・10 分沈黙監視ルール。subagent 起動時に skills: [monitor-protocol] で preload して inject される共有 protocol。
user-invocable: false
disable-model-invocation: true
---

# Skill: Monitor Protocol (state.json + 命名規約)

このファイルは PGE subagent 共通の **monitoring の正典**である。各 agent は本ファイルの規約に従って `plan/monitor/<predicted-name>/state.json` に進行状態を残し、orchestrator が hang vs 進行中を判別できるようにする。

## 設計思想

monitoring は **state.json + 命名規約** のみで構成。`timeline.jsonl` (hook 経由・全 tool call append) や hash dir 構造は採用しない。理由:

1. teammate session に hook が届かない問題を回避
2. agent が **意味的 phase 遷移** (= state.json) を書けば hang vs 進行中の判別には十分
3. hook 経由の暗黙挙動が消えてデバッグが単純化される

## ファイル配置

```
plan/monitor/
  <agent-name-with-sprint>/
    state.json
  ...
```

- ディレクトリ名は **orchestrator が agent 起動時に task description で `monitor_dir` を渡す** ことで決定される (絶対ルール 26)
- 命名規約 (後述) に従って衝突しない名前を付ける
- 旧 `_orchestrator-<hash8>/` や hash dir 構造は廃止

## state.json スキーマ

Agent 本体が **重要 phase 遷移時** に Write tool で **全置換** で更新する。**append ではなく overwrite**。

### 必須フィールド (5 個・欠落・改名禁止・L2 規約)

| フィールド | 型 | 内容 |
|---|---|---|
| `agent_name` | string | 下記の固定値のいずれか。**`agent` への短縮や省略は禁止**(L2 規約) |
| `phase` | string | agent ごとに定義された phase ID (下記「phase の命名規約」) |
| `phase_message` | string | 人間に説明する 1 行・80 文字以内・末尾 newline なし |
| `last_update_ts` | string (ISO8601) | 更新時刻 |
| `started_at` | string (ISO8601) | agent 起動時刻 (boot 時に記録し以降不変) |

`agent_name` の固定値: `"evaluator-per-ac"` / `"evaluator-pre-smoke"` / `"evaluator-auditor"` / `"evaluator-aggregator"` / `"investigator"` / `"generator"` / `"planner"` / `"researcher"` / `"expert-reviewer"` / `"agnostic-auditor"` / `"orchestrator"`

(Phase Z1 で test-designer family は廃止・evaluator per-ac の Step 0 が design+exec を統合)

### 任意フィールド (条件付き必須・null 許容)

| フィールド | 型 | 必須条件 |
|---|---|---|
| `sprint` | string ("Sprint N") or null | sprint scope の agent では必須 (generator / investigator / evaluator family / expert-reviewer) |
| `ac_id` | string ("AC-K") or null | per-AC scope の agent では必須 (`evaluator-per-ac` のみ) |
| `scope` | string or null | mode 区別に必要な agent では推奨 |
| `mode` | string or null | mode 引数を持つ agent では必須 (investigator のみ・Phase Z4 で evaluator は mode 引数廃止) |

### 完全な JSON 例

```json
{
  "agent_name": "evaluator-per-ac",
  "phase": "0-test-design",
  "phase_message": "Step 0-h で fixture_strategy 確定中",
  "last_update_ts": "2026-06-02T15:30:00Z",
  "started_at": "2026-06-02T14:30:12Z",
  "sprint": "Sprint N",
  "ac_id": "AC-K",
  "scope": null,
  "mode": null
}
```

**Phase Z4**: `evaluator-per-ac` / `evaluator-pre-smoke` / `evaluator-auditor` / `evaluator-aggregator` は subagent_type 自体で責務分離するため `mode` フィールドは `null` (互換のため field 自体は保持)。

### Write 直前の self-check (必須)

state.json を Write する直前に、agent は以下を自己検証する:

1. 必須 5 フィールドの**全て**が存在し空文字でない (`agent_name` / `phase` / `phase_message` / `last_update_ts` / `started_at`)
2. `agent_name` の値が上記固定値リストに含まれている (`agent` への短縮・任意改名禁止)
3. `last_update_ts` と `started_at` が ISO8601 形式 (`YYYY-MM-DDTHH:MM:SSZ` または `+09:00` 等のタイムゾーン付き)
4. `phase` が agent.md の phase ID 連鎖に含まれる値である (発明した phase 名禁止)
5. phase scope と mode に応じて任意フィールドが埋まっている (sprint scope なら `sprint`、per-AC なら `ac_id` も必須)

1 件でも違反したら Write しない (状態書き換え失敗を黙認しない・log で気付くしかない)。違反は agent 起動直後の boot phase で発覚しても同様 (脆い state.json を書くより skip)。

### `phase` の命名規約

各 agent.md の「ワークフロー」節の章番号またはステップ ID をそのまま使う。例:

- evaluator (per-ac scope・Phase Z5): `"0-test-design"` → `"5-ac-operations"` → `"6-artifact-gen"` → `"7-self-check"` → `"8-per-ac-json-write"` → `"9-self-execution"` → (fail 時) `"10-retry-1"` / `"10-retry-2"` / `"10-retry-3"` → (N=3 消費 fail 時) `"11-escalation-prep"` → `"done"` (halt 時は `"halt"`)
  - `"10-retry-N"` の N は iteration 番号 (1 始まり) の動的文字列。監視側は prefix `"10-retry-"` でマッチする規約。
  - `"9-self-execution"` の後 exit_code == 0 なら `"10-retry-*"` と `"11-escalation-prep"` をスキップして `"done"` に直行する。
- investigator (phase1): `"1-route-discover"` → `"2-aria-tree-capture"` → `"3-screenshot"` → `"done"`
- aggregator: `"1-per-ac-read"` → `"2-results-read"` → `"3-cross-cutting-check"` → `"4-findings-aggregate"` → `"5-evidence-enumerate"` → `"6-feedback-write"` → `"done"`

### 更新義務

各 agent は以下のタイミングで state.json を Write で **全置換**する:

1. **agent 起動直後** — `phase: "boot"` で初期記録
2. **主要 phase 遷移時** — 上記の `phase` 命名規約に従い、進入した時点で更新
3. **halt 発火時** — `phase: "halt"` + `phase_message` に halt 理由要約
4. **完了直前** — `phase: "done"` で最終記録

**10 分以上 state.json を更新せず沈黙してはならない**。長時間 Bash や Playwright で詰まる場合は途中でも `phase_message` を更新して進行を示す。

## 命名規約 (絶対ルール 26 と整合)

orchestrator は agent 起動時に task description に必ず `monitor_dir` を含める。命名は以下の規約に従う:

| Agent 種別 | monitor_dir 命名 |
|---|---|
| **researcher** | `plan/monitor/researcher-<topic-slug>/` (topic がない場合は `researcher-initial`) |
| **planner** | `plan/monitor/planner-sprint<N>/` (初回は `planner-initial`、append-only モードは `planner-clarifications-sprint<N>`) |
| **generator** | `plan/monitor/generator-sprint<N>/` (retry は `generator-sprint<N>-retry<count>`) |
| **investigator (phase1)** | `plan/monitor/investigator-phase1-sprint<N>/` |
| **investigator (phase2)** | `plan/monitor/investigator-phase2-sprint<N>/` |
| **investigator (phase3)** | `plan/monitor/investigator-phase3-sprint<N>/` |
| **`evaluator-pre-smoke`** | `plan/monitor/eval-presmoke-sprint<N>/` |
| **`evaluator-auditor`** | `plan/monitor/eval-auditor-sprint<N>/` |
| **`evaluator-per-ac`** | `plan/monitor/eval-ac-<K>-sprint<N>/` (再生成は `eval-ac-<K>-sprint<N>-regen<count>`) |
| **`evaluator-aggregator`** | `plan/monitor/eval-aggregator-sprint<N>/` (再起動は `eval-aggregator-sprint<N>-rerun<count>`) |
| **expert-reviewer** | `plan/monitor/expert-reviewer-sprint<N>/` |
| **orchestrator** | `plan/monitor/_orchestrator/state.json` (本セッション全体・1 個固定) |

## hang detection 手順 (orchestrator)

orchestrator が subagent を Agent tool で起動した後に hang 疑いを検出する手順:

1. Agent tool が長時間 (例: 15 分以上) 戻ってこない
2. orchestrator が `cat plan/monitor/<agent_dir>/state.json` で `phase` と `last_update_ts` を確認 (CWD = project root 相対)
3. `last_update_ts` が **10 分以上前** で `phase != "done"` → hang 確定
4. 確定した hang は人間に提示 (CLAUDE.md「halt プロトコル」フローに乗せる)

**Phase X3 では auto-recovery は実装しない**。観測可能にするだけで十分。

## state.json が無い場合

以下のケースでは state.json が存在しない:
- orchestrator が monitor_dir を渡し忘れた (絶対ルール 26 違反・要修正)
- agent が起動直後にクラッシュした
- 旧 hash dir 由来の残骸

orchestrator はこの状態を **monitoring 不能** として扱い、Agent tool の戻り値で進行を判定する。**monitoring 不在は PGE 判定基準には影響しない** (Evaluator JSON / agent 出力 MD が一次資料)。

## このプロトコルが想定しない範囲

- リアルタイム push 通知 (現状は polling 前提)
- マルチユーザー / マルチセッション間での monitoring 共有 (1 セッション 1 monitor dir 群)
- 永続的なメトリクス集計 (時系列 DB への投入は別レイヤ)
- 全 tool call の append-only ログ (Phase X3 で廃止・git history と Agent tool の戻り値で代替)
