# PGE Workflows

PGE (Planner-Generator-Evaluator) を Claude Code の **Workflow tool** で deterministic 化した script 群。orchestrator の text-generation 層で routing が判断される構造を排し、JS の `if`/`switch`/`while` で機械的に分岐する。

## 一覧

| script | scope | 入口 |
|---|---|---|
| [`pge-sprint-cycle.js`](pge-sprint-cycle.js) | sprint full cycle: Discovery → **Generator (Step 4)** → Build-Image → TI (Step 4.25) → DB-Setup → Contracts (Step 4.5) → Pre-smoke → Per-AC batch (Step 5-B) → Auditor → Aggregator → Reviewer (Step 7) → Routing (Step 8) → DB-Dispose。`while` loop で changes_requested → generator_retry を cycle closure | `/pge-sprint-cycle` (saved) |

注: Step 1 (Researcher) + Step 2 (Planner) + Step 3 (人間承認 FB loop) は **Phase Z8 で `.claude/skills/pge-planning/SKILL.md` (Skill 版) に移行**。Workflow tool は mid-run user input 不可のため FB loop dialogue を Skill 内で完結させる構造に変更した (公式 best practice 適合)。

phase 一覧の正本は `pge-sprint-cycle.js` 冒頭の `meta.phases` (= /workflows の progress 表示と完全一致)。本 README には載せず一次資料 1 箇所に集約する。

## 設計原則

1. **mid-run user input 不可** ([公式 docs](https://code.claude.com/docs/en/workflows.md#behavior-and-limits)): 「For sign-off between stages, run each stage as its own workflow」。**human gate を要する planning (Step 1-3) は Skill (`/pge-planning`) で完結**し、本 workflows/ 配下には機械的 fan-out の sprint cycle のみが残る。
2. **routing は code で表現**: SKILL.md の text routing 表は **document**、本 workflow の `if`/`switch` が **enforcement**。LLM 解釈の余地ゼロ。
3. **agent 定義は変更しない**: `.claude/agents/<name>.md` をそのまま `agentType` opt で reuse。workflow は dispatcher のみ。
4. **schema 拘束**: 各 agent return を JSON schema で validation。Phase Z5 で観測した「半 populated return」は runtime auto-retry で構造的に防止。
5. **Agent Teams 不使用**: parallel() で workflow subagent を fan-out。teammate 同士の communication が PGE では発生しないため Agent Teams の機能は over-engineered。

## Iterating on a workflow (in-session edit + re-run)

過去 (Phase Z7 まで) Workflow tool の `name:` resolution は session boot 時 snapshot cache を持っており、session 中の編集が反映されない trait が観測されていた。**現在の harness では `Workflow({name})` 起動でも edit が次回反映されることが多い** (2026-06 検証時に複数 commit を `name:` で連続起動して各 commit の挙動を確認済) が、harness 側挙動は version 依存のため**断定はできない**。

### 起動形式の選択

| 起動形式 | 動作 (現状観測) |
|---|---|
| `Workflow({name: 'pge-sprint-cycle'})` | 多くの環境で各起動時に file system 最新版を読み直す挙動が観測される・ただし harness version によっては session boot snapshot cache が残る可能性あり |
| `Workflow({scriptPath: '<absolute path to .claude/workflows/<name>.js>'})` | 起動時 file system Read を**保証**する形式・cache の有無に依存しない |

### Iterating on a workflow の安全な手順

1. `.claude/workflows/<name>.js` を Edit / Write で更新する
2. `workflow-syntax-check` PostToolUse hook が parse error を即 block する (= 構文 error は file save 時に検出済み・起動後に気付くケースはない)
3. **iterate 中は `Workflow({scriptPath})` 形式を推奨** — `name:` が cache hit する harness でも確実に最新を読む
4. iterate 完了後の正規起動は `Workflow({name})` で良い
5. `scriptPath` 経由起動時の resume も同じく invocation 時 Read のため、`Workflow({scriptPath, resumeFromRunId})` で edit-and-resume が成立する (詳細は次節 §「Resume protocol」)

## Resume protocol (2 層)

### 層 1: in-session resume (workflow tool 標準)

同一 Claude session 内で workflow が中断/edit された場合、`Workflow({scriptPath, resumeFromRunId: 'wf_...'})` で再起動する。**agent call の (prompt, opts) が同一なら cached result を即返す**。script を edit すると、edit 行以降だけ live 実行される。

```bash
# 例
Workflow({scriptPath: '/path/to/pge-sprint-cycle.js', resumeFromRunId: 'wf_abc123', args: {sprint: 1, ...}})
```

caller (orchestrator) は前回 run の Run ID を覚えていれば良い。session exit すると cache 消失。

### 層 2: cross-session resume (artifact + state.json 経由)

session が落ちる / 別 session から再開する場合、workflow runtime の cache は使えない。代わりに **PGE 既存の成果物書き込み pattern** を流用:

1. caller が事前に Bash で plan/feedback/ / plan/review/ / plan/monitor/ を scan
2. 既存 artifact を発見したら、workflow 起動時の `args.resumeHint` に「skip + path」hint を載せる
3. workflow は hint に従い、対応 step を **既存 artifact を読み込む軽量 agent** に置換 (full agent spawn せず)

`pge-sprint-cycle.js` の `resumeHint` 仕様:

```js
args.resumeHint = {
  smoke:  { skip: bool, path: 'plan/feedback/sprint-1/_smoke.json' },
  perAc:  { skipSet: ['AC-1', 'AC-3'] },  // skipSet 内 AC のみ skip・他は full spawn
  audit:  { skip: bool, path: 'plan/feedback/sprint-1/_audit.json' },
  agg:    { skip: bool, path: 'plan/feedback/sprint-1.json' },  // or final.json
  review: { skip: bool, path: 'plan/review/sprint-1.json' },
}
```

caller が `args.resumeHint` を含めない場合、workflow は通常通り全 step を full spawn する (backward compatible)。

### caller (orchestrator) 用の事前 FS scan example

```bash
SPRINT=1
RESUME_JSON=$(jq -n \
  --argjson smoke "$([ -f plan/feedback/sprint-$SPRINT/_smoke.json ] && echo true || echo false)" \
  --argjson audit "$([ -f plan/feedback/sprint-$SPRINT/_audit.json ] && echo true || echo false)" \
  --argjson agg "$([ -f plan/feedback/sprint-$SPRINT.json ] && echo true || echo false)" \
  --argjson review "$([ -f plan/review/sprint-$SPRINT.json ] && echo true || echo false)" \
  --argjson perAcs "$(ls plan/feedback/sprint-$SPRINT/AC-*.json 2>/dev/null | sed -E 's|.*/(AC-[0-9]+)\.json|"\1"|' | paste -sd,)" \
  '{smoke:{skip:$smoke,path:"plan/feedback/sprint-\($sprint)/_smoke.json"},...}')
# 上記 JSON を args.resumeHint として Workflow 起動時に渡す
```

(実用版は orchestrator が動的構築・本 README の example は scaffold)

## Step 2.5 advisor の取り扱い (未統合)

user 決定 (2026-06-14): advisor は **evaluator のための事前 scaffold** なので planning workflow には含めず、**sprint workflow (`pge-sprint-cycle.js`) の Pre-smoke と並列で起動** する設計。

現状: `test-perspective-advisor` / `e2e-infra-prep-advisor` の workflow 内統合は **未着手** (agent 定義は `.claude/agents/` 配下にあるが workflow からは呼ばれていない)。Pre-smoke phase 自体は `evaluator-pre-smoke` 経由で実装済 (v2 batch mode では noop pass を返す設計)。

実装時は Pre-smoke 起動と同じ phase で `parallel()` 内に advisor 2 種を spawn する。

## Step 4-4.5 (Generator / TI / Contracts) 統合 (完了)

`runStep4to4_5()` は実装完了済:

1. **Generator** agent を `agent({agentType: 'generator'})` で起動 (`phase('Generator')`)
2. **Build-Image** phase を Generator 直後に挿入 (runtime config `app.dockerfile_path` 宣言時のみ・src 変更を image に反映)
3. **Investigator** phase 1+2 を `parallel()` で並列起動・phase 3 を sequential (`phase('TI')`)
4. **Contracts** (Step 4.5) は `general-purpose` agent で Bash + jq の deterministic 算出を実行 (`phase('Contracts')`)

`generator_retry` 経路は while loop 内 `continue` 1 文で full closure 完成済 (= caller は workflow 1 回の invocation で sprint 全体を処理できる)。

## Runtime container 前提 (`/pge-sprint-cycle` 実行時)

`pge-sprint-cycle.js` は v2 batch mode で **app container を per-AC 並列起動** し、**baseline DB volume から DB clone を per-AC で作成** する。実行前に以下の環境が整っている必要がある。詳細 field 仕様は [`pge-runtime-config-spec.md`](../references/pge-runtime-config-spec.md) を参照。

| 必要なもの | 必須性 | 形態の選択肢 / 補足 |
|---|---|---|
| **runtime config** (`plan/pge-runtime-config.json`) | ✓ 必須 | `/pge-runtime-survey` で生成・schema v2 |
| **app の pre-built image** | ✓ 必須 | runtime config `app.image` の tag で docker 上に build 済であること。Build-Image phase が使えれば workflow が自動で再 build する |
| **app の Dockerfile** | △ 条件付き必須 | runtime config `app.dockerfile_path` を declare して **Build-Image phase** を有効化する場合に必要 (推奨)。未 declare の場合 Build-Image は skip-with-warning され、Generator の src 変更が container 内 artifact に反映されない (= volume mount / hot reload 等で別途反映する PJ 専用) |
| **app の docker-compose.yml** | ✗ **不要** | workflow は `docker run --network <app.network> -e <env>... <image>` で **compose を経由せず直接 container 起動** する。app の compose 定義は PGE では使わない |
| **baseline DB container 起動済** | ✓ 必須 | per-AC DB clone の元 named volume の所有者。runtime config `parallel_db.db_clone.baseline_volume_name` で識別される volume を持つ container が起動済であること |
| **baseline DB の起動定義** | ✓ 必須 (間接) | 上記 baseline DB container を立ち上げる手段が必要。典型は `docker-compose.yml` で declare するが、別の方法 (devcontainer.json の postCreateCommand / 手動 `docker run` 等) でも可。workflow は `baseline_stop_command` / `baseline_start_command` で一時停止して clone の tar copy race を回避する |
| **PGE runner が `app.network` に join** | ✓ 必須 | workflow が docker network DNS (= container 名で app に reach) で接続するため。devcontainer / CI runner container が `app.network` に居る形態が典型 (testcontainers の sibling network pattern と同等)。bare host から PGE を回す形態は現状サポート外 |

### 「app の docker-compose.yml は不要」の意味

PGE は app container のライフサイクル (start / stop / dispose) を workflow が直接管理するため、開発者が手元で `docker-compose up` する代わりの仕組みを **workflow 内に内蔵** している。`app.image` を docker から起動するために compose 定義は要らず、`app.dockerfile_path` を declare すれば image 自体も workflow が build する。

baseline DB だけは workflow の管轄外 (= clone 元として存在することを workflow は前提とするだけ) のため、これだけは PJ 側で起動手段を用意する必要がある (典型は compose)。

### 動作確認済の環境例

| 環境 | 形態 |
|---|---|
| devcontainer + docker socket mount + docker-compose | sample-java-app (本リポジトリ): devcontainer の `app` + `db` service が compose で立ち上がり、devcontainer 自身が `app.network` に join。PGE workflow は devcontainer 内 shell から sibling として per-AC container を起動 |

bare host runner / CI runner container 等の他 pattern は将来検証 / `access_mode` field opt-in 拡張で対応見込み。

## 設計参照

- 公式: [Workflows](https://code.claude.com/docs/en/workflows.md) / [Sub-agents](https://code.claude.com/docs/en/sub-agents.md)
- 移行根拠: [issue/20260614/O-4](../../issue/20260614/O-4-orchestrator-asks-human-instead-of-generator-retry.md)
- 既存 PGE 規約: [pge-planning SKILL](../skills/pge-planning/SKILL.md) / [pge-sprint-cycle workflow](pge-sprint-cycle.js) / 各 [agent.md](../agents/)
