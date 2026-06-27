export const meta = {
  name: 'pge-sprint-cycle',
  description: 'PGE 1 sprint 分の full cycle (Step 4 Generator → 4.25 Investigator → 4.5 Contracts → 5-B Evaluator family → 6 Escalation → 7 Reviewer → 8 Routing) を deterministic 実行。changes_requested → generator_retry の cycle closure は while loop 内 continue 1 文で機械化 (O-4 違反箇所の構造的解決)。args 完全省略でも plan/pge-runtime-config.json + plan/spec.md + plan/progress.md からの auto discovery で動く。parallel DB mode は 2 wire (runtime config の parallel_db.strategy != "none" / TI phase2 の db_isolation_catalog.json#selected_entry != "none") + kill switch (PGE_ISOLATION_MODE=sequential でない) で auto activate (SKILL.md 規約・LLM 推論ゼロで判定)。',
  whenToUse: 'spec.md + plan/pge-runtime-config.json が揃った状態で /pge-sprint-cycle を引数なしで起動 = 「次の未着手 sprint を実行」(= 起動自体が人間承認のアクション)。明示的に sprint 番号 / mode / acIds を override したい場合のみ args を渡す。runtime config は /pge-runtime-survey で生成する。',
  phases: [
    { title: 'Discovery',  detail: 'plan/pge-runtime-config.json / spec.md / progress.md から deterministic に sprint state 抽出' },
    { title: 'Generator',  detail: '仕様実装 (1 sprint 分)' },
    { title: 'Build-Image', detail: 'Generator 後の app image rebuild (runtime config app.dockerfile_path 宣言時のみ・src 変更が container 内 artifact に反映されない問題の構造的解決)' },
    { title: 'Test-Fixture-Setup', detail: 'Phase Z3+: SUT root に .pge-fixtures.ts を generate (runtime config の test_runner.noise_filter から network_abort / console_suppress_pattern を literal 注入・per-iteration ではなく sprint initial run のみ 1 回)' },
    { title: 'TI',         detail: 'Investigator phase 1+2 parallel + phase 3' },
    { title: 'DB-Setup',   detail: 'v2: 2 wire 自動判定のみ (iteration 0)・parallel mode 不満足なら halt・実際の起動は Per-AC 内' },
    { title: 'Contracts',  detail: 'Step 4.5 deterministic contracts (bash + jq)' },
    { title: 'Pre-smoke',  detail: 'app health gate (evaluator-pre-smoke)' },
    { title: 'Per-AC',     detail: 'v2: pool_size 単位の batch loop・各 batch で (app+DB) pair を並列起動 → per-AC 並列実行 → 一括 dispose' },
    { title: 'Auditor',    detail: 'cross-AC consistency check (A4 isolation prefix)' },
    { title: 'Aggregator', detail: '集約 + sprint/final JSON 生成' },
    { title: 'Reviewer',   detail: 'Expert-Reviewer (hard_rule_hit OR risk_score>=6 のみ)' },
    { title: 'Routing',    detail: '機械 routing 決定 (verdict + next_action → action)' },
    { title: 'DB-Dispose', detail: 'per-AC DB clone を全 dispose (done/halt 共通の cleanup)' },
  ],
}

// ────────────────────────────────────────────────────────────────
// args (全 field optional・未指定なら Discovery phase で自動補完):
// {
//   sprint?:           number   // 未指定 → progress.md から「次の未着手 sprint」を auto-detect
//   mode?:             'intermediate' | 'final' // 未指定 → sprint == 最終 sprint なら 'final' / else 'intermediate'
//   acIds?:            string[] // 未指定 → spec.md の該当 sprint の AC を抽出
//   maxGeneratorRetry?: number  // default 3
//   tiMode?:           'initial' | 'update-capture' // default 'initial'
//
//   // cross-session resume hint (caller が事前に FS scan して構築・iteration 0 のみ適用)
//   // 詳細: .claude/workflows/README.md「Resume protocol (2 層)」
//   resumeHint?: {
//     smoke?:  { skip: boolean, path?: string },          // path default: plan/feedback/sprint-N/_smoke.json
//     perAc?:  { skipSet: string[] },                     // ['AC-1', 'AC-3'] のみ skip・他は full spawn
//     audit?:  { skip: boolean, path?: string },          // path default: plan/feedback/sprint-N/_audit.json
//     agg?:    { skip: boolean, path?: string },          // path default: plan/feedback/sprint-N.json or final.json
//     review?: { skip: boolean, path?: string },          // path default: plan/review/sprint-N.json
//   }
// }
//
// 注意 (v2): PJ 固有 config は本 workflow から削除した。一次資料は plan/pge-runtime-config.json (`/pge-runtime-survey` で生成・schema_version=2)。
// v2 設計: (1 app : 1 DB) × pool_size の pair pool 方式。SUT 側 routing 実装は不要。各 AC が独立 app container + DB clone を持ち、
// 同時起動数は parallel_db.pool_size で上限。AC 数 > pool_size のときは batch 順次実行。
// parallel mode は 2 wire (runtime config の strategy + TI db_isolation_catalog.json) + kill switch (env) で auto activate。
// v2 では sequential fallback は無く、3 条件いずれか不満足なら halt。
//
// return: { action, ... } where action ∈ {
//   'done'                   sprint 合格 (caller は次 sprint へ)
//   'halt'                   人間判断必要 (blocker 含む)
//   'needs_per_ac_regen'     reviewer が next_action=per_ac_regen を返したが本 PoC 未実装で caller に振る
// }
// ────────────────────────────────────────────────────────────────

// args 正規化: undefined/null/string/object のいずれも受ける
const argsObj = (() => {
  if (args === undefined || args === null) return {}
  if (typeof args === 'string') {
    const s = args.trim()
    if (s === '') return {}
    // 'sprint' keyword 必須 (任意の単独数値を sprint 番号扱いしない・"5 AC" 等の誤抽出回避)
    const sprintMatch = s.match(/(?:^|[^a-z])sprint\s+(\d+)/i)
    const modeMatch = s.match(/\b(intermediate|final)\b/i)
    return {
      ...(sprintMatch ? { sprint: parseInt(sprintMatch[1], 10) } : {}),
      ...(modeMatch ? { mode: modeMatch[1].toLowerCase() } : {}),
      _argsRaw: s,
    }
  }
  if (typeof args === 'object' && !Array.isArray(args)) return args
  return { _argsInvalid: `unexpected args type: ${typeof args}` }
})()
if (argsObj._argsInvalid) {
  return { action: 'halt', stage: 'args-normalize', blocker: { reason: argsObj._argsInvalid } }
}

// ────────────────────────────────────────────────────────────────
// Discovery: plan/pge-runtime-config.json + spec.md + progress.md を deterministic に read
// LLM 推論禁止 (bash + jq + Read のみ)・runtime config から PJ 固有値を 1 source で取得
// ────────────────────────────────────────────────────────────────

const DISCOVERY_SCHEMA = {
  type: 'object',
  required: ['runtime_config_raw', 'next_sprint', 'total_sprint_count', 'sprints'],
  properties: {
    // runtime_config は **生 JSON 文字列** で返す (LLM の field selection / nested object 再構築の介入を完全排除)
    // workflow JS が JSON.parse(runtime_config_raw) で deterministic に消費する
    runtime_config_raw: { type: 'string' },
    next_sprint: { type: 'number' },
    last_completed_sprint: { type: ['number', 'null'] },
    total_sprint_count: { type: 'number' },
    sprints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sprint', 'ac_ids'],
        properties: {
          sprint: { type: 'number' },
          name: { type: ['string', 'null'] },
          ac_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    blocker: { type: ['object', 'null'] },
  },
}

phase('Discovery')
const discovery = await agent(
  `pge-sprint-cycle preflight discovery として起動。

**LLM 推論で値を construct / 選別しない**。bash + jq + Read のみで以下を実行し、構造化 return せよ:

1. **plan/pge-runtime-config.json**: 以下の手順で文字列として読み取り、return value の \`runtime_config_raw\` field に格納
   - 不在なら blocker={ reason: "runtime-config-missing", remediation: "/pge-runtime-survey を起動して plan/pge-runtime-config.json を生成してください" } を返す
   - \`cat plan/pge-runtime-config.json | jq -c .\` で 1 行 compact JSON 文字列を取得 (jq -c が parse error にならないことが構文確認を兼ねる)
   - 取得した文字列を **そのまま** \`runtime_config_raw\` field に格納 (= 各 nested field の選別 / 整形 / 再構築を一切しない・LLM が "重要そうな field だけ抜く" 介入を排除)
   - workflow JS 側で JSON.parse して deterministic に消費する

2. **plan/sprint.json** (Phase Z11.0+ 一次 source・存在時はこちらを優先):
   - \`jq -r '.sprint'\` で sprint ラベルを取得 → 末尾の数値を sprint 番号に (例 "Sprint 1" → 1・数値が取れなければ 1)
   - \`jq -r '.test_cases[].id'\` で per-AC 評価単位の id 一覧を取得 (id prefix は framework 共通の \`AC-\`・この一覧が ac_ids)
   - \`jq -r '.feature'\` を name に
   - sprints は **単一 entry** [{ sprint: <N>, name: <feature>, ac_ids: [<test_cases ids>] }]・total_sprint_count = 1
   - **fallback**: plan/sprint.json が不在のときのみ plan/spec.md の legacy parse ("## Sprint N:" 見出し + "AC-K [..]" 行を sed/awk) で sprints[] / total_sprint_count を構成

3. **plan/progress.md**: 完了済 sprint の判定
   - "## Sprint N" + "ステータス: ... 完了" を grep
   - 最後の完了 sprint 番号を last_completed_sprint に
   - 不在 or 空なら null (= 次は sprint 1)
   - 補強: plan/feedback/sprint-N.json と plan/feedback/final.json の存在を ls で確認

4. **next_sprint 判定**:
   - last_completed_sprint が null → next_sprint = 1
   - last_completed_sprint < total_sprint_count → next_sprint = last_completed_sprint + 1
   - last_completed_sprint == total_sprint_count → blocker={ reason: "all-sprints-completed" }

5. **失敗条件 → blocker で halt return**:
   - plan/sprint.json と plan/spec.md が両方不在 → "planning-not-done"
   - plan/sprint.json は在るが plan/domain.json が不在 → "domain-missing" (Generator / per-AC が SUT facts を引けない・Discovery 未完の疑い)
   - plan/pge-runtime-config.json 不在 → "runtime-config-missing"
   - 全 sprint 完了済 → "all-sprints-completed"

完了時 return value として上記構造を JSON で返せ (StructuredOutput tool 経由)。\`runtime_config_raw\` は **bash で cat したそのままの string** であり、JSON object に変換して各 field を抽出してはならない (workflow JS が JSON.parse する)。`,
  { label: 'discovery', phase: 'Discovery', agentType: 'general-purpose', model: 'sonnet', schema: DISCOVERY_SCHEMA }
  // model: sonnet — runtime_config_raw を raw 保持しつつ入れ子 sprints[] schema を埋める multi-step task。
  // sonnet の典型 fail mode (raw 整形・境界 1 ずれ) は直後の JSON.parse + must[] 死活確認で deterministic に捕捉されるため opus 不要。
)

if (!discovery) {
  return { action: 'halt', stage: 'discovery', blocker: { reason: 'discovery agent returned null' } }
}
if (discovery.blocker) {
  return { action: 'halt', stage: 'discovery', blocker: discovery.blocker, discovery }
}

// runtime_config_raw を deterministic に JSON.parse (LLM 介入余地ゼロ)
let config
try {
  config = JSON.parse(discovery.runtime_config_raw)
} catch (e) {
  return {
    action: 'halt',
    stage: 'discovery',
    blocker: {
      reason: 'runtime-config-raw-parse-failed',
      detail: (e && e.message) || String(e),
      raw_snippet: (discovery.runtime_config_raw || '').slice(0, 200),
    },
    discovery,
  }
}
// schema_version 強制チェック (v2 のみサポート)
if (config.schema_version !== '2') {
  return {
    action: 'halt',
    stage: 'discovery',
    blocker: {
      reason: 'runtime-config-schema-version-mismatch',
      detail: `schema_version="${config.schema_version}" は本 workflow (v2) でサポートしていない。/pge-runtime-survey を再起動して v2 schema で再生成してください。`,
      found_schema_version: config.schema_version,
      required_schema_version: '2',
    },
    discovery,
  }
}
// 最低限の field 存在チェック (v2 schema・workflow が使う field の死活確認)
const must = [
  ['schema_version', config.schema_version],
  ['sut_root', config.sut_root],
  ['app.image', config.app?.image],
  ['app.container_name_template', config.app?.container_name_template],
  ['app.network', config.app?.network],
  ['app.internal_port', config.app?.internal_port],
  ['app.health_url_template', config.app?.health_url_template],
  ['app.datasource_env_name', config.app?.datasource_env_name],
  ['parallel_db.strategy', config.parallel_db?.strategy],
]
const missing = must.filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k)
if (missing.length > 0) {
  return {
    action: 'halt',
    stage: 'discovery',
    blocker: { reason: 'runtime-config-incomplete', missing_fields: missing },
    discovery,
  }
}
const seedFileDecl = config.parallel_db?.db_clone?.seed_file
const seedTemplateDecl = config.parallel_db?.db_clone?.seed_restore_command_template
const seedFileSet = (seedFileDecl !== undefined && seedFileDecl !== null && seedFileDecl !== '')
const seedTemplateSet = (seedTemplateDecl !== undefined && seedTemplateDecl !== null && seedTemplateDecl !== '')
if (seedFileSet !== seedTemplateSet) {
  return {
    action: 'halt',
    stage: 'discovery',
    blocker: {
      reason: 'runtime-config-seed-fields-must-pair',
      detail: 'parallel_db.db_clone.seed_file と seed_restore_command_template は両方 declare or 両方 null/省略・片方のみは invalid',
      seed_file_set: seedFileSet,
      seed_restore_command_template_set: seedTemplateSet,
    },
    discovery,
  }
}
const baselineStopDecl = config.parallel_db?.db_clone?.baseline_stop_command
const baselineStartDecl = config.parallel_db?.db_clone?.baseline_start_command
const baselineStopSet = (baselineStopDecl !== undefined && baselineStopDecl !== null && baselineStopDecl !== '')
const baselineStartSet = (baselineStartDecl !== undefined && baselineStartDecl !== null && baselineStartDecl !== '')
if (baselineStopSet !== baselineStartSet) {
  return {
    action: 'halt',
    stage: 'discovery',
    blocker: {
      reason: 'runtime-config-baseline-lifecycle-must-pair',
      detail: 'parallel_db.db_clone.baseline_stop_command と baseline_start_command は両方 declare or 両方 null/省略・片方のみは invalid',
      baseline_stop_command_set: baselineStopSet,
      baseline_start_command_set: baselineStartSet,
    },
    discovery,
  }
}
log(`discovery: ${discovery.total_sprint_count} sprints total, next=${discovery.next_sprint}, last_completed=${discovery.last_completed_sprint ?? 'none'}, app_image=${config.app.image}, sut=${config.sut_root}, db_strategy=${config.parallel_db.strategy}, pool_size=${config.parallel_db.pool_size ?? 5}, app_access=docker-network-dns`)

// ────────────────────────────────────────────────────────────────
// Merge args (override) with discovered defaults
// ────────────────────────────────────────────────────────────────
const sprint = argsObj.sprint ?? discovery.next_sprint
const sprintObj = discovery.sprints.find((s) => s.sprint === sprint)
if (!sprintObj) {
  return {
    action: 'halt',
    stage: 'discovery',
    blocker: { reason: `sprint ${sprint} not found in spec.md (total=${discovery.total_sprint_count})` },
    discovery,
  }
}
const mode = argsObj.mode || (sprint === discovery.total_sprint_count ? 'final' : 'intermediate')
const acIds = argsObj.acIds || sprintObj.ac_ids
const sutRoot = config.sut_root
const appImage = config.app.image
const appContainerNameTemplate = config.app.container_name_template
const appNetwork = config.app.network
const appInternalPort = config.app.internal_port
// app への接続は docker network DNS (container_name + internal_port) で行う。host port mapping (-p) は使わない
const appHealthUrlTemplate = config.app.health_url_template
const appStartupTimeoutSec = config.app.startup_timeout_seconds || 60
const appDatasourceEnvName = config.app.datasource_env_name
const appEnvArray = config.app.env || []
const poolSize = Math.max(1, config.parallel_db?.pool_size ?? 5)
const MAX_GENERATOR_RETRY = argsObj.maxGeneratorRetry || 3

// 最終 validation
if (!Array.isArray(acIds) || acIds.length === 0) {
  return { action: 'halt', stage: 'args-validate', blocker: { reason: `acIds が空 (sprint ${sprint}・spec.md の sprint section に AC 記載なし可能性)` }, discovery }
}
if (!['intermediate', 'final'].includes(mode)) {
  return { action: 'halt', stage: 'args-validate', blocker: { reason: `mode は 'intermediate'|'final'・確定値: ${mode}` }, discovery }
}

log(`pge-sprint-cycle 起動: sprint=${sprint} mode=${mode} acIds=[${acIds.join(',')}]`)

// parallelDbMode は TI phase2 完了後に 2 wire 自動判定で確定する (iteration 0 で 1 度のみ)
// 初期値 false で、wires が揃ったら true に昇格・以後 iteration で sticky
let parallelDbMode = false
let activeBatchAcIds = []  // 現 batch 内で起動中の AC ID 群 (cleanup 用)

// ────────────────────────────────────────────────────────────────
// Schemas (PGE 既存 JSON の必須 field を minimal に拘束)
// agent return は schema 違反時に workflow runtime が auto retry する
// ────────────────────────────────────────────────────────────────

const SMOKE_SCHEMA = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { enum: ['pass', 'blocked'] },
    blocker: { type: ['object', 'null'] },
    smoke_tests: {
      type: 'array',
      items: {
        type: 'object',
        required: ['category', 'success'],
        properties: {
          category: { type: 'string' },
          success: { type: 'boolean' },
          url: { type: ['string', 'null'] },
          status_code: { type: ['number', 'null'] },
        },
      },
    },
  },
}

const PER_AC_SCHEMA = {
  type: 'object',
  required: ['scope', 'ac_id', 'verdict', 'test_artifact'],
  properties: {
    scope: { const: 'per-ac' },
    ac_id: { type: 'string' },
    sprint: { type: ['string', 'number'] },
    mode: { type: 'string' },
    verdict: { enum: ['pass', 'fail', 'blocked'] },
    blocker: { type: ['object', 'null'] },
    test_artifact: {
      type: 'object',
      required: ['file', 'runner_command', 'artifact_framework'],
      properties: {
        file: { type: 'string' },
        runner_command: { type: 'string' },
        artifact_framework: { enum: ['F-playwright-ts', 'F-http-request-curl', 'F-bash-script', 'F-sql-with-bash-wrapper'] },
      },
    },
    self_execution_result: { type: ['object', 'null'] },
    retry_local_metadata: { type: ['object', 'null'] },
    findings: { type: 'array' },
    scores_local: { type: ['object', 'null'] },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { enum: ['pass', 'drift_detected', 'blocked'] },
    blocker: { type: ['object', 'null'] },
    summary: { type: ['object', 'null'] },
    findings: { type: 'array' },
  },
}

const AGG_SCHEMA = {
  type: 'object',
  required: ['scope', 'mode', 'verdict'],
  properties: {
    scope: { const: 'aggregated' },
    mode: { enum: ['intermediate', 'final'] },
    verdict: { enum: ['pass', 'fail', 'blocked'] },
    blocker: { type: ['object', 'null'] },
    scores: { type: ['object', 'null'] },
    thresholds_met: { type: ['object', 'null'] },
    smoke_tests: { type: 'array' },
    tests_run: { type: 'array' },
    findings: { type: 'array' },
    regressions: { type: 'array' },
    risk_flags: { type: ['object', 'null'] },
    risk_score: { type: ['number', 'null'] },
    impact_surface: { type: ['object', 'null'] },
    loop_metrics: { type: ['object', 'null'] },
  },
}

const GEN_SCHEMA = {
  type: 'object',
  required: ['sprint_implemented', 'progress_path'],
  properties: {
    sprint_implemented: { type: ['string', 'number'] },
    progress_path: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    self_eval_summary: { type: ['string', 'null'] },
    blocker: { type: ['object', 'null'] },
  },
}

const TI_SCHEMA = {
  type: 'object',
  required: ['phase', 'verdict'],
  properties: {
    phase: { enum: [1, 2, 3, '1', '2', '3'] },
    verdict: { enum: ['initial', 'delta-captured', 'no-update-needed', 'blocked'] },
    output_dir: { type: ['string', 'null'] },
    captured_urls: { type: ['array', 'null'] },
    analyzed_files_count: { type: ['number', 'null'] },
    blocker: { type: ['object', 'null'] },
  },
}

const CONTRACTS_SCHEMA = {
  type: 'object',
  required: ['isolation_contract_path', 'multiplicity_hint_path'],
  properties: {
    isolation_contract_path: { type: 'string' },
    multiplicity_hint_path: { type: 'string' },
    ac_count: { type: ['number', 'null'] },
    fallback_used: { type: ['boolean', 'null'] },
    blocker: { type: ['object', 'null'] },
  },
}

const APP_LIFECYCLE_SCHEMA = {
  type: 'object',
  required: ['action', 'success'],
  properties: {
    action: { enum: ['restart', 'start', 'stop'] },
    success: { type: 'boolean' },
    health_url: { type: ['string', 'null'] },
    status_code: { type: ['number', 'null'] },
    duration_ms: { type: ['number', 'null'] },
    parallel_env_applied: { type: ['boolean', 'null'] },
    blocker: { type: ['object', 'null'] },
  },
}

const WIRE_CHECK_SCHEMA = {
  type: 'object',
  required: ['wire_a', 'wire_b', 'kill_switch', 'parallel_db_mode_decision'],
  properties: {
    wire_a: {
      type: 'object',
      required: ['satisfied'],
      properties: {
        satisfied: { type: 'boolean' },
        selected_entry: { type: ['string', 'null'] },
        reason: { type: ['string', 'null'] },
      },
    },
    wire_b: {
      type: 'object',
      required: ['satisfied'],
      properties: {
        satisfied: { type: 'boolean' },
        strategy: { type: ['string', 'null'] },
        reason: { type: ['string', 'null'] },
      },
    },
    kill_switch: {
      type: 'object',
      required: ['active'],
      properties: {
        active: { type: 'boolean' },
        env_value: { type: ['string', 'null'] },
      },
    },
    parallel_db_mode_decision: { type: 'boolean' },
    decision_reason: { type: 'string' },
  },
}

const BASELINE_LIFECYCLE_SCHEMA = {
  type: 'object',
  required: ['action', 'success'],
  properties: {
    action: { enum: ['stop', 'start'] },
    success: { type: 'boolean' },
    container_state: { type: ['string', 'null'] },
    duration_ms: { type: ['number', 'null'] },
    blocker: { type: ['object', 'null'] },
  },
}

const DB_CLONE_SCHEMA = {
  type: 'object',
  required: ['action', 'success'],
  properties: {
    action: { enum: ['start', 'dispose'] },
    success: { type: 'boolean' },
    clones: {
      type: 'array',
      items: {
        type: 'object',
        required: ['ac_id', 'container_name', 'success'],
        properties: {
          ac_id: { type: 'string' },
          container_name: { type: 'string' },
          volume_name: { type: ['string', 'null'] },
          datasource_url: { type: ['string', 'null'] },
          success: { type: 'boolean' },
          error: { type: ['string', 'null'] },
        },
      },
    },
    blocker: { type: ['object', 'null'] },
  },
}

const REVIEWER_SCHEMA = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { enum: ['approved', 'changes_requested', 'blocked'] },
    next_action: {
      anyOf: [
        { type: 'null' },
        { enum: ['generator_retry', 'per_ac_regen', 'aggregator_regen'] },
      ],
    },
    blocker: { type: ['object', 'null'] },
    required_changes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'summary'],
        properties: {
          id: { type: ['number', 'string'] },
          severity: { enum: ['major', 'minor', 'critical', 'blocker'] },
          summary: { type: 'string' },
          location: { type: ['string', 'null'] },
          rationale: { type: ['string', 'null'] },
        },
      },
    },
    observations: { type: ['string', 'object', 'array', 'null'] },
    trigger: { type: ['string', 'object', 'null'] },
    sprint: { type: ['string', 'number'] },
  },
}

// ────────────────────────────────────────────────────────────────
// Helper: AC ID → slug (config.parallel_db.routing.ac_id_slug_rule に従う)
// 'lowercase + remove "-"' (default) または 'lowercase + replace "-" with "_"'
// ────────────────────────────────────────────────────────────────
function acIdToSlug(acId) {
  const rule = config.parallel_db?.ac_id_slug_rule || 'lowercase + replace "-" with "_"'
  const lower = acId.toLowerCase()
  if (/remove\s+['"-]+/.test(rule)) return lower.replace(/-/g, '')
  return lower.replace(/-/g, '_')
}

// per-AC の app URL を docker network DNS で組み立て (container_name + internal_port を template に置換)
// 前提: PGE runner (devcontainer / CI runner) が SUT app container と同じ docker network 上にいる
// (= docker-in-docker / sibling container 構成・testcontainers 等が前提とする一般構成)
function appUrlForAc(acId) {
  const slug = acIdToSlug(acId)
  const containerName = appContainerNameTemplate.replace(/\{ac_id_slug\}/g, slug)
  return appHealthUrlTemplate
    .replace('{container_name}', containerName)
    .replace('{internal_port}', String(appInternalPort))
}

// Per-AC ごとの DB URL (datasource_url_template + ac_id_slug から組み立て)
function acDataSourceUrl(acId) {
  const slug = acIdToSlug(acId)
  const tmpl = config.parallel_db?.db_clone?.datasource_url_template
  if (!tmpl) return null
  return tmpl.replace(/\{ac_id_slug\}/g, slug)
}

// ────────────────────────────────────────────────────────────────
// Resume helper: 既存 artifact を skip 指定で読み込む (cross-session resume)
// ────────────────────────────────────────────────────────────────

const resumeHint = argsObj.resumeHint || {}

async function readExistingArtifact(path, schema, label) {
  return agent(
    `軽量 read agent として起動。\n\nファイル ${path} を Read し、その内容を JSON で構造化 return せよ (StructuredOutput tool 経由)。

- ファイルが既に valid JSON ならその中身をそのまま return value にする
- ファイルが存在しない / 破損している場合は \`{ "blocker": { "reason": "resume-artifact-missing-or-corrupt", "path": "${path}" } }\` を return

新しい解析・実行・推論は一切行わない。`,
    { label: `resume-read:${label}`, agentType: 'general-purpose', model: 'haiku', schema }
    // model: haiku — 既存 file を Read して JSON で返すだけの passthrough・推論なし
  )
}

// ────────────────────────────────────────────────────────────────
// Prompt helpers (PJ 固有値は config から差し込む・workflow に hardcode しない)
// ────────────────────────────────────────────────────────────────

// v2: pre-smoke は shared app を前提とするため batch mode では noop で pass を返す。
// 各 AC は自分の app container 起動時に health check を経由するため pre-smoke 相当の確認は構造的に担保される。
const smokePrompt = () =>
  `Workflow pge-sprint-cycle から Step 5-B-1 (pre-smoke) として起動 (v2 batch mode・noop pass)。

sprint: ${sprint}
mode: ${mode}
monitor_dir: plan/monitor/eval-pre-smoke-sprint-${sprint}/

v2 設計では各 AC が独立した app container を持ち、起動時 health check が pre-smoke 相当を兼ねる。共有 smoke 対象が存在しないため、本起動は **smoke_tests=[] / verdict="pass" / _meta.skip_reason="v2-batch-mode-no-shared-app"** で \`plan/feedback/sprint-${sprint}/_smoke.json\` を Write して即時 return せよ。agent 定義 (.claude/agents/evaluator-pre-smoke.md) の通常 smoke ロジックは skip。完了時は return value として \`_smoke.json\` の内容そのものを JSON で返せ。`

// v2: perAcPrompt は per-AC ごとの appUrl を受け取る。routing header は撤去。
const perAcPrompt = (acId, perAcAppUrl, dbContainerName) => {
  const slug = acIdToSlug(acId)
  const seedFile = config.parallel_db?.db_clone?.seed_file || null
  const seedTemplate = config.parallel_db?.db_clone?.seed_restore_command_template || null
  const seedActive = parallelDbMode && seedFile && seedTemplate
  let seedBlock = ''
  if (seedActive) {
    const seedFileHostPath = `${sutRoot}/${seedFile}`
    const seedRestoreCommand = seedTemplate
      .replace(/\{container_name\}/g, dbContainerName)
      .replace(/\{seed_file_host_path\}/g, seedFileHostPath)
    seedBlock = `seed_file_in_clone: ${seedFile}
seed_file_host_path: ${seedFileHostPath}
seed_restore_command: ${seedRestoreCommand}     # ← Step 10 retry loop 各 iteration 開始前に Bash で実行 (詳細は agent.md Step 10)
`
  }
  return `Workflow pge-sprint-cycle から Step 5-B-4 (per-AC・batch 内 1 個) として起動。

sprint: ${sprint}
mode: ${mode}
ac_id: ${acId}
parallel_db_mode: ${parallelDbMode}
app_url: ${perAcAppUrl}     # ← この AC 専用の app container の URL (docker network DNS で接続・container_name + internal_port で解決)
${parallelDbMode ? `db_container_name: ${dbContainerName}
` : ''}${seedBlock}monitor_dir: plan/monitor/eval-${slug}-sprint-${sprint}/
SUT root: ${sutRoot}
runtime_config: plan/pge-runtime-config.json (PJ 固有値の一次資料・必要に応じて Read)
test_case_source: plan/sprint.json#test_cases[] から id == ${acId} の entry を Read (state / input / expected の literal 一次 source・Phase Z11.0+)
state_source: plan/domain.json#named_states[] (test_case.state が参照する state setup template・Phase Z11.0+)

agent 定義 (.claude/agents/evaluator-per-ac.md) の Step 0 → 5 → 6 → 7 → 8 → 9 → 10 → 11 を順番通り実行。test artifact は **app_url を baseURL として使う** (routing header は不要・v2 では各 AC の app は単一 DataSource を持ち独立)。
\`plan/feedback/sprint-${sprint}/${acId}.json\` + \`e2e/sprint-${sprint}/${acId}.<ext>\` を Write。Step 9 self-execution + Step 10 retry loop (N=3) は **必ず実行** (skip 禁止・verdict が blocked 以外なら self_execution_result を non-null で埋める)。完了時は return value として \`${acId}.json\` の内容そのものを JSON で返せ。`
}

const auditorPrompt = () =>
  `Workflow pge-sprint-cycle から Step 5-B-4.5 (cross-AC auditor) として起動。

sprint: ${sprint}
mode: ${mode}
monitor_dir: plan/monitor/eval-auditor-sprint-${sprint}/

per-AC artifacts: plan/feedback/sprint-${sprint}/AC-*.json
test artifacts: ${sutRoot}/e2e/sprint-${sprint}/AC-*.<ext>

agent 定義 (.claude/agents/evaluator-auditor.md) の通り A4 (isolation prefix 衝突) のみ機械判定し \`plan/feedback/sprint-${sprint}/_audit.json\` を Write。完了時は return value として \`_audit.json\` の内容を JSON で返せ。`

const aggPrompt = () =>
  `Workflow pge-sprint-cycle から Step 5-B-6 (aggregator) として起動。

sprint: ${sprint}
mode: ${mode}
monitor_dir: plan/monitor/eval-aggregator-sprint-${sprint}/

入力:
- plan/sprint.json (#test_cases = AC 一覧・Phase Z11.0+) + plan/domain.json (#endpoints[].messages[].literal = business_rule_conflict regex source) / plan/progress.md / plan/spec.md (thin pointer)
- plan/feedback/sprint-${sprint}/AC-*.json (全件)
- plan/feedback/sprint-${sprint}/_smoke.json
- plan/feedback/sprint-${sprint}/_audit.json
- per-AC JSON の self_execution_result / retry_local_metadata (Phase Z5: 一次集約源)
- ${sutRoot}/evidence/ 配下 (Playwright/bash 各 AC の evidence)

agent 定義 (.claude/agents/evaluator-aggregator.md) の通り 集約し:
${mode === 'final'
    ? `- \`plan/feedback/final.json\` を Write
- final + verdict=pass + Playwright AC ≥ 1 件 なら **\`${sutRoot}/e2e/sprint-final.spec.ts\` を Write 必須** (O-3 で観測した skip を再発させない)`
    : `- \`plan/feedback/sprint-${sprint}.json\` を Write`}

完了時は return value として ${mode === 'final' ? 'final.json' : `sprint-${sprint}.json`} の内容そのものを JSON で返せ。`

const reviewerPrompt = (aggregate) =>
  `Workflow pge-sprint-cycle から Step 7 (Expert-Reviewer) として起動。

起動理由: ${(aggregate.risk_flags?.hard_rule_hit?.length || 0) > 0
    ? `hard_rule_hit=[${(aggregate.risk_flags.hard_rule_hit || []).join(',')}]`
    : `risk_score=${aggregate.risk_score} (>= 6)`}

sprint: ${sprint}
monitor_dir: plan/monitor/expert-reviewer-sprint-${sprint}/

入力:
- plan/sprint.json (#test_cases = AC 一覧・Phase Z11.0+) + plan/domain.json (SUT facts) / plan/progress.md / plan/spec.md (thin pointer)
- plan/feedback/${mode === 'final' ? 'final.json' : `sprint-${sprint}.json`}
- plan/feedback/sprint-${sprint}/AC-*.json (必要に応じて)
- ${sutRoot}/evidence/ (必要に応じて)

agent 定義 (.claude/agents/expert-reviewer.md) の通り設計妥当性・回帰可能性・整合性を審査し、\`plan/review/sprint-${sprint}.json\` + \`plan/review/sprint-${sprint}.md\` を Write。

完了時は return value として \`sprint-${sprint}.json\` の内容そのものを JSON で返せ。**特に \`verdict\` と \`next_action\` を厳格に埋めること** (changes_requested の場合は next_action に generator_retry / per_ac_regen / aggregator_regen のいずれかを必須記載)。`

const genPrompt = (iteration, retryHint) =>
  `Workflow pge-sprint-cycle から Step 4 (Generator) として起動 (iteration ${iteration + 1}/${MAX_GENERATOR_RETRY})。

sprint: ${sprint}
monitor_dir: plan/monitor/generator-sprint-${sprint}/

agent 定義 (.claude/agents/generator.md) の通り実装する。一次 source は **plan/domain.json (#planned_changes = behavior rule の正本) + plan/sprint.json (#test_cases.expected = 実装の検証目標 / #test_cases.state が参照する domain.json#named_states = state factory)** (Phase Z11.0+)。plan/spec.md は thin pointer (人間レビュー用 plan/spec-visual.html への案内) なので AC literal の source にしない。未着手 sprint を 1 個実装し、完了後 plan/progress.md に自己評価 + 起動コマンド + 引き渡し事項を書く。

${retryHint ? `## Retry 文脈 (前 iteration の失敗を踏まえて修正)
source: ${retryHint.source}
${retryHint.required_changes ? `required_changes:\n${JSON.stringify(retryHint.required_changes, null, 2)}` : ''}
${retryHint.findings ? `findings:\n${JSON.stringify(retryHint.findings.slice(0, 5), null, 2)}` : ''}

前 iteration の修正要望を最優先で処理せよ (SKILL.md 絶対ルール: フィードバック優先処理)。
` : ''}

完了時 return: {sprint_implemented, progress_path: 'plan/progress.md', files_changed[], self_eval_summary}`

const tiPrompt = (phase) =>
  `Workflow pge-sprint-cycle から Step 4.25 (Investigator phase=${phase}) として起動。

phase: ${phase}
mode: ${argsObj.tiMode || 'initial'}
sprint: ${sprint}
monitor_dir: plan/monitor/ti-phase${phase}-sprint-${sprint}/
SUT root: ${sutRoot}

${phase === 1 ? `v2 batch mode では shared app が存在しないため runtime UI capture (本 phase) は **skip-with-pass** で動作する。\`plan/test-investigation/phase1/_skipped.json\` を \`{"reason":"v2-batch-mode-no-shared-app"}\` の内容で Write し、即時 return せよ。verdict は "no-update-needed" を返す。実 runtime capture は行わない。` :
   phase === 2 ? 'Static Code Analysis を実行し plan/test-investigation/phase2/ を Write (available_capabilities.json + db_isolation_catalog.json 含む)' :
                  'Phase 2 出力を統合し plan/test-investigation/phase3/ + assessment-sprint-${sprint}.json を Write (v2 では Phase 1 出力は skip 扱いで存在しない前提)'}。

完了時 return: {phase: ${phase}, verdict, output_dir, captured_urls?, analyzed_files_count?}`

const contractsPrompt = () =>
  `Workflow pge-sprint-cycle から Step 4.5 (Test Design Contracts・deterministic) として起動。

sprint: ${sprint}

入力:
- plan/test-investigation/phase2/controller_action_map.json (optional)
- plan/test-investigation/phase2/route_map.json (optional)
- plan/test-investigation/phase1/*/aria_snapshot.yaml (optional)
- plan/sprint.json#test_cases[].id (AC id 一覧抽出 source・Phase Z11.0+) / 不在時のみ plan/spec.md の AC 行 fallback

agent 定義 (.claude/skills/test-design-contracts/SKILL.md) の bash + jq one-liner を **deterministic に**実行:

1. mkdir -p plan/test-design/contracts/
2. plan/sprint.json#test_cases[].id から AC id 一覧を抽出 (\`jq -r '.test_cases[].id'\`)・sprint.json 不在時のみ spec.md から AC-1..AC-N を抽出
3. routes_touched は **空発行** で OK
4. write_set / read_set / pollution graph / fixture strategy を jq で算出
5. multiplicity_hint を grep + jq で算出
6. plan/test-design/contracts/isolation_contract.json + multiplicity_hint.json を Write
7. jq -e . で両 file の parse check

TI artifact が欠落・破損なら **空 contract** を発行して fallback (fallback_used: true で return)。

LLM 推論禁止・bash + jq + Read のみ。完了時 return: {isolation_contract_path, multiplicity_hint_path, ac_count, fallback_used}`

// ────────────────────────────────────────────────────────────────
// v2: Per-AC app pair lifecycle (1 AC につき 1 app container を docker run / stop)
// 各 app は runtime config の datasource_env_name を介して per-AC DB URL を受け取る
// ────────────────────────────────────────────────────────────────
const appPerAcStartPrompt = (acId, dataSourceUrl) => {
  const slug = acIdToSlug(acId)
  const containerName = appContainerNameTemplate.replace(/\{ac_id_slug\}/g, slug)
  const healthUrl = appHealthUrlTemplate
    .replace('{container_name}', containerName)
    .replace('{internal_port}', String(appInternalPort))
  const envFlags = appEnvArray.concat([
    `${appDatasourceEnvName}=${dataSourceUrl}`,
  ]).map(e => `-e "${e}"`).join(' ')
  // docker network DNS で接続するため -p flag を使わない (host port mapping 不要)。
  // PGE runner (= 本 workflow を実行している container / 環境) が ${appNetwork} に join
  // していれば container DNS 名で sibling container の internal_port へ直接 reach できる。
  // (devcontainer / docker-in-docker / CI runner pattern で一般的な設計・testcontainers 等と同様)
  return `Workflow pge-sprint-cycle から app (per-AC) start として起動。

ac_id: ${acId}
container_name: ${containerName}
internal_port: ${appInternalPort}
network: ${appNetwork}
image: ${appImage}
datasource_env: ${appDatasourceEnvName}=${dataSourceUrl}
health_url: ${healthUrl}  ← docker network DNS で container name + internal_port をそのまま使う (host port mapping 無し)

以下を Bash で実行:

\`\`\`bash
set +e
start_ms=$(date +%s%3N 2>/dev/null || echo 0)
docker stop ${containerName} 2>/dev/null
docker rm -f ${containerName} 2>/dev/null
docker run -d \\
  --name ${containerName} \\
  --network ${appNetwork} \\
  ${envFlags} \\
  ${appImage}
run_ec=$?
echo "RUN_EC=$run_ec"
echo "HEALTH_URL=${healthUrl}"

# health polling (container DNS 名で reach する・runner が同 network 上にいる前提)
for i in $(seq 1 ${appStartupTimeoutSec}); do
  curl -sf "${healthUrl}" >/dev/null 2>&1 && break
  sleep 1
done
status_code=$(curl -s -o /dev/null -w '%{http_code}' "${healthUrl}")
end_ms=$(date +%s%3N 2>/dev/null || echo 0)
echo "STATUS_CODE=$status_code"
echo "DURATION_MS=$((end_ms - start_ms))"
\`\`\`

完了後 return value (StructuredOutput tool 経由):
{
  action: 'start',
  ac_id: '${acId}',
  container_name: '${containerName}',
  success: bool (run_ec=0 かつ status_code が 2xx/3xx であれば true),
  health_url: '${healthUrl}',
  status_code: number,
  duration_ms: number
}`
}

const appPerAcDisposePrompt = (acIds) => {
  const calls = acIds.map((acId) => {
    const slug = acIdToSlug(acId)
    const containerName = appContainerNameTemplate.replace(/\{ac_id_slug\}/g, slug)
    return `docker stop ${containerName} 2>/dev/null; docker rm -f ${containerName} 2>/dev/null && echo "APP_DISPOSE_OK ${acId} ${containerName}" || echo "APP_DISPOSE_FAIL ${acId} ${containerName}"`
  }).join('\n')
  return `Workflow pge-sprint-cycle から app (per-AC) dispose・${acIds.length} 個 として起動。

ac_ids: [${acIds.join(',')}]

以下を Bash で順次実行:

\`\`\`bash
set +e   # 1 個失敗でも他を試す
${calls}
\`\`\`

完了後 return:
{action: 'dispose', success: bool (全件 OK なら true・1 個でも FAIL なら false), apps: [{ac_id, container_name, success}, ...]}

APP_DISPOSE_FAIL は許容 (container 既存しない等)。`
}

// ────────────────────────────────────────────────────────────────
// 2 wire check (deterministic・LLM 推論禁止)
// Wire A: TI phase2 が出力する plan/test-investigation/phase2/db_isolation_catalog.json#selected_entry != "none"
// Wire B: runtime config の parallel_db.strategy != "none"
// Kill switch: PGE_ISOLATION_MODE env が "sequential" なら強制 sequential
// 3 条件全てが parallel 寄りに揃ったときのみ parallel mode を発火
// ────────────────────────────────────────────────────────────────
const wireCheckPrompt = () =>
  `Workflow pge-sprint-cycle から 2 wire 自動判定として起動。LLM 推論禁止・bash + jq + env 確認のみ。

以下を実行して JSON return:

1. **Wire A**: \`plan/test-investigation/phase2/db_isolation_catalog.json\` を jq で読む
   - 不在 → wire_a={ satisfied: false, reason: "db_isolation_catalog.json not found (TI phase2 が未完?)" }
   - \`.selected_entry == "none"\` or null → wire_a={ satisfied: false, selected_entry: <value>, reason: "selected_entry indicates no available DB isolation strategy" }
   - それ以外 → wire_a={ satisfied: true, selected_entry: <value> }

2. **Wire B**: runtime config の strategy 値 (caller から渡された値: ${config.parallel_db.strategy})
   - strategy == "none" → wire_b={ satisfied: false, strategy: "none", reason: "runtime config declares strategy=none" }
   - strategy in ["named-volume-clone", "schema-per-ac"] → wire_b={ satisfied: true, strategy: <value> }

3. **Kill switch**: \`echo "\${PGE_ISOLATION_MODE:-}"\` で env 確認
   - 値が "sequential" → kill_switch={ active: true, env_value: "sequential" }
   - 値が空 or 他 → kill_switch={ active: false, env_value: <value or null> }

4. **Final decision**:
   - wire_a.satisfied && wire_b.satisfied && !kill_switch.active → parallel_db_mode_decision = true
   - それ以外 → false
   - decision_reason に上記 3 値からの判定 logic を string で書く

完了時 return value として WIRE_CHECK_SCHEMA 準拠の JSON で返せ (StructuredOutput tool 経由)。`

// ────────────────────────────────────────────────────────────────
// Baseline lifecycle (db clone 前後で baseline DB を停止/再起動)
// runtime config の baseline_stop_command / baseline_start_command が一対で declare
// されているときのみ発火する。tar copy 中の baseline DB write race による clone
// 破損 (silent corruption) を構造的に防ぐ。
// ────────────────────────────────────────────────────────────────
const baselineLifecyclePrompt = (action) => {
  const cmd = action === 'stop'
    ? config.parallel_db.db_clone.baseline_stop_command
    : config.parallel_db.db_clone.baseline_start_command
  const successCheck = action === 'stop'
    ? `# stop 完了確認 (30s timeout・container running でないことを polling)
for i in $(seq 1 30); do
  state=$(docker ps --filter "name=\${BASELINE_CONTAINER_NAME:-}" --format '{{.Status}}' 2>/dev/null | head -1)
  if [ -z "$state" ]; then break; fi
  sleep 1
done`
    : `# start 完了確認 (60s timeout・container running を polling)
for i in $(seq 1 60); do
  state=$(docker ps --filter "name=\${BASELINE_CONTAINER_NAME:-}" --format '{{.Status}}' 2>/dev/null | head -1)
  if [ -n "$state" ]; then break; fi
  sleep 1
done`
  return `Workflow pge-sprint-cycle から baseline lifecycle (${action}) として起動。
action: ${action}
command: ${cmd}

以下を Bash で実行:

\`\`\`bash
set +e
${cmd}
${successCheck}
\`\`\`

完了後 return:
{action: '${action}', success: bool, container_state: <"running"|"stopped"|null>, duration_ms: number}

success の判定: stop なら container が停止していること・start なら running していること。`
}

// ────────────────────────────────────────────────────────────────
// Build-Image: Generator 後の app image rebuild
// runtime config の app.dockerfile_path が宣言されているときのみ発火する。
// Generator が src を変更しても container は既存 image を参照し続けるため、
// 「Generator → image rebuild → Per-AC で container 起動」の順を強制する。
// dockerfile_path 未宣言なら skip-with-warning (= volume mount / hot reload 等
// で src 変更が container に直接反映される PJ では rebuild 不要)。
// ────────────────────────────────────────────────────────────────
const buildImagePrompt = () => {
  const dockerfilePath = config.app.dockerfile_path
  const buildContext = config.app.build_context || '.'
  const image = config.app.image
  const sutRoot = config.sut_root
  return `Workflow pge-sprint-cycle から Build-Image (Generator 後の app image rebuild) として起動。

sut_root: ${sutRoot}
image_tag: ${image}
dockerfile_path: ${dockerfilePath}
build_context: ${buildContext}

以下を Bash で実行:

\`\`\`bash
set +e
start_ms=$(date +%s%3N 2>/dev/null || echo 0)
cd "${sutRoot}" || { echo "CD_FAIL"; exit 1; }
docker build -t "${image}" -f "${dockerfilePath}" "${buildContext}" 2>&1 | tail -100
ec=$?
end_ms=$(date +%s%3N 2>/dev/null || echo 0)
echo "BUILD_EXIT=$ec"
echo "BUILD_DURATION_MS=$((end_ms - start_ms))"
docker images "${image}" --format '{{.ID}} {{.CreatedAt}}' | head -1
\`\`\`

完了後 return value (StructuredOutput tool 経由):
{
  success: bool,                   // BUILD_EXIT が 0 のとき true
  image_tag: '${image}',
  duration_ms: number,             // BUILD_DURATION_MS (ms)
  image_id: string|null,           // docker images の ID (確認できれば)
  stderr_excerpt: string|null      // 失敗時のみ tail 30 行 (success 時は null)
}

注意: 成功条件は「BUILD_EXIT=0 かつ docker images で image が存在」。どちらか欠ければ success=false で stderr_excerpt にエラー断片を入れる。`
}

const BUILD_IMAGE_SCHEMA = {
  type: 'object',
  required: ['success', 'image_tag'],
  properties: {
    success: { type: 'boolean' },
    image_tag: { type: 'string' },
    duration_ms: { type: ['number', 'null'] },
    image_id: { type: ['string', 'null'] },
    stderr_excerpt: { type: ['string', 'null'] },
  },
}

const FIXTURE_SETUP_SCHEMA = {
  type: 'object',
  required: ['success', 'file_path'],
  properties: {
    success: { type: 'boolean' },
    file_path: { type: 'string' },
    bytes_written: { type: ['number', 'null'] },
    stderr_excerpt: { type: ['string', 'null'] },
  },
}

// ────────────────────────────────────────────────────────────────
// Test-Fixture-Setup: SUT root に .pge-fixtures.ts を generate (Phase Z3+)
// runtime config の test_runner.noise_filter から network_abort /
// console_suppress_pattern を literal 注入し、Playwright fixture fragment を
// 1 file 書き出す。LLM 推論で内容を改変させない (workflow JS で確定済 literal
// をそのまま渡し、agent は Write tool で書くだけ)。
// per-iteration ではなく sprint initial run のみ 1 回 generate。
// 詳細規約は .claude/references/playwright-fixture-template.md を参照。
// ────────────────────────────────────────────────────────────────
const fixtureSetupPrompt = () => {
  const sutRoot = config.sut_root
  const tr = config.test_runner || {}
  const nf = tr.noise_filter || {}
  const networkPatterns = Array.isArray(nf.network_abort) ? nf.network_abort : []
  const consolePattern = typeof nf.console_suppress_pattern === 'string' ? nf.console_suppress_pattern : ''

  const networkBody = networkPatterns.length === 0
    ? ''
    : networkPatterns.map((p) => `  ${JSON.stringify(p)},`).join('\n') + '\n'
  const consoleLine = consolePattern
    ? `const NOISE_CONSOLE_PATTERN: RegExp | null = new RegExp(${JSON.stringify(consolePattern)});`
    : 'const NOISE_CONSOLE_PATTERN: RegExp | null = null;'

  const fragmentContent = [
    '// .pge-fixtures.ts',
    '// PGE が runtime_config.test_runner.noise_filter から自動生成する fixture fragment。',
    '// このファイルを手で編集すると次回 sprint で上書きされる (PJ owner は編集禁止)。',
    '// PJ の playwright.config.ts はこの fixture を import する規約に従う。',
    '',
    "import { test as base, expect, type Page } from '@playwright/test';",
    '',
    'const NOISE_NETWORK_PATTERNS: string[] = [',
    networkBody + '];',
    '',
    consoleLine,
    '',
    'export const test = base.extend<{ pgeFixtures: void }>({',
    '  pgeFixtures: [',
    '    async ({ page }, use) => {',
    '      for (const pattern of NOISE_NETWORK_PATTERNS) {',
    '        await page.route(pattern, (route) => route.abort());',
    '      }',
    '      if (NOISE_CONSOLE_PATTERN) {',
    "        page.on('console', (msg) => {",
    '          if (NOISE_CONSOLE_PATTERN.test(msg.text())) {',
    '            return;',
    '          }',
    '        });',
    '      }',
    '      await use();',
    '    },',
    '    { auto: true },',
    '  ],',
    '});',
    '',
    'export { expect };',
    'export type { Page };',
    '',
  ].join('\n')

  return `Workflow pge-sprint-cycle から Test-Fixture-Setup として起動 (sprint initial run のみ 1 回・per-iteration ではない)。

sut_root: ${sutRoot}
target_file: ${sutRoot}/.pge-fixtures.ts

責務: 下記 FRAGMENT_BEGIN / FRAGMENT_END 間の literal content を **Write tool** で ${sutRoot}/.pge-fixtures.ts に書く。LLM 推論で内容を改変しない (workflow JS が確定済 literal をそのまま渡している・改変は禁止)。

FRAGMENT_BEGIN
${fragmentContent}
FRAGMENT_END

完了後 StructuredOutput で:
{
  success: bool,                       // Write が成功したら true
  file_path: "${sutRoot}/.pge-fixtures.ts",
  bytes_written: number|null,          // 書き込んだ bytes 数 (取得できれば)
  stderr_excerpt: string|null          // 失敗時のみエラー断片
}

注意:
- Write tool 1 回で完結 (既存ファイルがあっても全置換 OK)
- FRAGMENT_BEGIN / FRAGMENT_END マーカー自体は file に含めない (内側 content のみ)
- LLM 推論で fragment 構造を再構築しない (literal echo のみ)
- 詳細規約は .claude/references/playwright-fixture-template.md を参照`
}

// ────────────────────────────────────────────────────────────────
// DB clone start / dispose (per-AC × batch_size)
// .claude/scripts/db-isolation/{clone,dispose}-named-volume.sh を呼ぶ
// args は config.parallel_db.db_clone (v2 では top-level に統合) から組み立て
// ────────────────────────────────────────────────────────────────
// v2: DB clone は per-AC・container_name_template と datasource_url_template は v2 で db_clone 直下
const dbCloneStartPrompt = (acIds) => {
  const dc = config.parallel_db.db_clone
  const envFlags = (dc.env || []).map((e) => `--env "${e}"`).join(' ')
  const healthCmdArg = dc.health_cmd ? `--health-cmd "${dc.health_cmd}"` : ''
  const healthTimeoutArg = dc.health_timeout_seconds ? `--health-timeout ${dc.health_timeout_seconds}` : ''
  const baselineVol = dc.baseline_volume_name
  const cloneCalls = acIds.map((acId) => {
    const slug = acIdToSlug(acId)
    const container = dc.container_name_template.replace(/\{ac_id_slug\}/g, slug)
    const volume = dc.volume_name_template.replace(/\{ac_id_slug\}/g, slug)
    const dsUrl = dc.datasource_url_template.replace(/\{ac_id_slug\}/g, slug)
    return `bash .claude/scripts/db-isolation/clone-named-volume.sh \\
  --base-volume "${baselineVol}" \\
  --target-volume "${volume}" \\
  --db-image "${dc.image}" \\
  --container-name "${container}" \\
  --network "${dc.network}" \\
  --data-dir "${dc.data_dir}" \\
  ${envFlags} ${healthCmdArg} ${healthTimeoutArg} \\
  && echo "CLONE_OK ${acId} ${container} ${volume} ${dsUrl}" \\
  || echo "CLONE_FAIL ${acId} ${container} ${volume} -"`
  }).join('\n')

  return `Workflow pge-sprint-cycle から DB clone start・per-AC × ${acIds.length} として起動。

baseline volume: ${baselineVol}
network: ${dc.network}
image: ${dc.image}
ac_ids: [${acIds.join(',')}]

以下を Bash で順次実行 (script は host docker socket 経由で sibling container を起動):

\`\`\`bash
set +e   # 1 個失敗でも他を試す
${cloneCalls}
\`\`\`

各 AC ごとに CLONE_OK / CLONE_FAIL 行が出る。各 AC の datasource_url は CLONE_OK 行の 4 列目 literal。

return JSON 形式:
{
  action: 'start',
  success: bool (全件 OK なら true),
  clones: [{ ac_id, container_name, volume_name, datasource_url, success, error }, ...]
}`
}

const dbCloneDisposePrompt = (acIds) => {
  const dc = config.parallel_db.db_clone
  const disposeCalls = acIds.map((acId) => {
    const slug = acIdToSlug(acId)
    const container = dc.container_name_template.replace(/\{ac_id_slug\}/g, slug)
    const volume = dc.volume_name_template.replace(/\{ac_id_slug\}/g, slug)
    return `bash .claude/scripts/db-isolation/dispose-named-volume.sh \\
  --container-name "${container}" \\
  --target-volume "${volume}" \\
  && echo "DISPOSE_OK ${acId} ${container}" \\
  || echo "DISPOSE_FAIL ${acId} ${container}"`
  }).join('\n')

  return `Workflow pge-sprint-cycle から DB clone dispose・${acIds.length} 個 として起動。

ac_ids: [${acIds.join(',')}]

以下を Bash で順次実行:

\`\`\`bash
set +e   # 1 個失敗でも他を試す (container 存在しない等)
${disposeCalls}
\`\`\`

return JSON:
{action: 'dispose', success: bool, clones: [{ac_id, container_name, success}, ...]}

DISPOSE_FAIL は許容 (container 既存しない等)・caller は warning として扱う。`
}

// ────────────────────────────────────────────────────────────────
// dispose 必要時のみ呼ぶ helper (return 前の cleanup)
// ────────────────────────────────────────────────────────────────
async function disposeIfNeeded(reason) {
  if (!parallelDbMode || activeBatchAcIds.length === 0) return null
  const toDispose = activeBatchAcIds.slice()
  log(`Cleanup: ${toDispose.length} active pairs (app+DB) を dispose (理由: ${reason}・ACs: ${toDispose.join(',')})`)
  phase('DB-Dispose')
  // app と DB を並列 dispose (best-effort・1 個失敗しても他を試す)
  const [appDispose, dbDispose] = await Promise.all([
    agent(appPerAcDisposePrompt(toDispose), {
      label: 'app-dispose',
      phase: 'DB-Dispose',
      agentType: 'general-purpose',
      model: 'haiku',
      schema: APP_LIFECYCLE_SCHEMA,
    }),
    agent(dbCloneDisposePrompt(toDispose), {
      label: 'db-dispose',
      phase: 'DB-Dispose',
      agentType: 'general-purpose',
      model: 'haiku',
      schema: DB_CLONE_SCHEMA,
    }),
  ])
  activeBatchAcIds = []
  log(`cleanup done: app_success=${appDispose?.success ?? '?'}, db_success=${dbDispose?.success ?? '?'}`)
  return { app_dispose: appDispose, db_dispose: dbDispose }
}

async function runStep4to4_5(iteration, retryHint) {
  // Step 4: Generator
  phase('Generator')
  const gen = await agent(genPrompt(iteration, retryHint), {
    label: `generator#${iteration + 1}`,
    phase: 'Generator',
    agentType: 'generator',
    schema: GEN_SCHEMA,
  })
  if (!gen) return { error: 'generator null', stage: 'generator' }
  if (gen.blocker) return { error: 'generator blocked', blocker: gen.blocker, stage: 'generator' }
  log(`generator done: sprint ${gen.sprint_implemented} (${(gen.files_changed || []).length} files)`)

  // Build-Image: Generator が src を変更した直後に image rebuild する。
  // 各 AC の app container は Per-AC batch loop 内で起動されるため、その前に
  // image を最新化しないと旧 image 由来の stale container が立つ (v1 で発覚した
  // 「image rebuild 欠落」問題の構造的対応)。runtime config に
  // app.dockerfile_path が無い PJ (volume mount / hot reload 前提) では skip。
  phase('Build-Image')
  if (config.app.dockerfile_path) {
    const build = await agent(buildImagePrompt(), {
      label: `build-image#${iteration + 1}`,
      phase: 'Build-Image',
      agentType: 'general-purpose',
      schema: BUILD_IMAGE_SCHEMA,
    })
    if (!build) return { error: 'build-image null', stage: 'build-image' }
    if (!build.success) {
      return {
        error: 'build-image failed',
        stage: 'build-image',
        blocker: {
          reason: 'app-image-rebuild-failed',
          detail: `docker build -t ${build.image_tag} が失敗 (exit code != 0)。stderr 末尾: ${build.stderr_excerpt || '(unavailable)'}`,
          attempted_recovery: ['Generator は完了しているが image 化に失敗・stale container での Per-AC 評価は無意味'],
          human_decision_needed: 'Dockerfile / build context / SUT src の整合性を確認し、手動で docker build を通してから workflow を再開してください',
        },
        build,
      }
    }
    log(`build-image done: ${build.image_tag} (${build.duration_ms}ms${build.image_id ? `, id=${build.image_id.slice(0, 12)}` : ''})`)
  } else {
    log(`build-image skipped: app.dockerfile_path が runtime config に未宣言 (= volume mount / hot reload 前提の PJ と判断)`)
  }

  // Step 4.25: TI (phase 1+2 parallel → phase 3 sequential)
  // v2: phase 1 は shared app 不在のため skip-with-pass で noop return する
  phase('TI')
  const tiPhase12 = await parallel(
    [1, 2].map((p) => () =>
      agent(tiPrompt(p), {
        label: `ti-phase${p}#${iteration + 1}`,
        phase: 'TI',
        agentType: 'investigator',
        schema: TI_SCHEMA,
      })
    )
  )
  const tiResults = tiPhase12.filter(Boolean)
  if (tiResults.length < 2) {
    return { error: 'TI phase 1/2 failed', stage: 'ti', tiPhase12 }
  }
  const tiBlocked = tiResults.find((r) => r.verdict === 'blocked' || r.blocker)
  if (tiBlocked) return { error: 'TI phase 1/2 blocked', stage: 'ti', blocker: tiBlocked.blocker, tiPhase12 }
  log(`TI phase 1+2 done: ${tiResults.map((r) => `p${r.phase}=${r.verdict}`).join(', ')}`)

  // ──── v2: 2 wire 自動判定 (iteration 0 のみ・以後 sticky) ────
  // v2 では sequential fallback は無く、3 条件全て揃わなければ halt する。
  // 実際の (app + DB) pair 起動は Per-AC phase の batch loop 内で行う。
  if (iteration === 0) {
    phase('DB-Setup')
    if (config.parallel_db.strategy === 'none') {
      return {
        error: 'parallel_db.strategy=none is not supported in v2',
        stage: 'wire-check',
        blocker: {
          reason: 'v2-sequential-mode-unsupported',
          detail: 'v2 では parallel mode 必須。runtime config の parallel_db.strategy を named-volume-clone 等に設定するか、v1 を使うか判断してください。',
        },
      }
    }
    const wires = await agent(wireCheckPrompt(), {
      label: 'wire-check',
      phase: 'DB-Setup',
      agentType: 'general-purpose',
      model: 'haiku',
      schema: WIRE_CHECK_SCHEMA,
    })
    if (!wires) {
      return { error: 'wire check returned null', stage: 'wire-check' }
    }
    log(`2 wire check: A=${wires.wire_a.satisfied} B=${wires.wire_b.satisfied} kill=${wires.kill_switch.active} → parallel=${wires.parallel_db_mode_decision} (${wires.decision_reason})`)
    if (!wires.parallel_db_mode_decision) {
      return {
        error: 'parallel mode wire check failed',
        stage: 'wire-check',
        blocker: {
          reason: 'v2-wires-not-satisfied',
          detail: wires.decision_reason,
          wires,
        },
      }
    }
    parallelDbMode = true
    log(`v2 batch mode active・pool_size=${poolSize}・AC 数=${acIds.length}・batch 数=${Math.ceil(acIds.length / poolSize)}`)
  }
  // iteration > 0 では parallelDbMode は sticky・追加処理なし
  // (各 AC の app/DB は batch loop 内で起動されるため iter 間で前 iter の container は dispose 済)

  const tiPhase3 = await agent(tiPrompt(3), {
    label: `ti-phase3#${iteration + 1}`,
    phase: 'TI',
    agentType: 'investigator',
    schema: TI_SCHEMA,
  })
  if (!tiPhase3 || tiPhase3.verdict === 'blocked') {
    return { error: 'TI phase 3 failed/blocked', stage: 'ti', blocker: tiPhase3?.blocker, tiPhase3 }
  }
  log(`TI phase 3 done: verdict=${tiPhase3.verdict}`)

  // Step 4.5: Contracts (deterministic bash + jq via general-purpose)
  phase('Contracts')
  const contracts = await agent(contractsPrompt(), {
    label: `contracts#${iteration + 1}`,
    phase: 'Contracts',
    agentType: 'general-purpose',
    // model: opus — .claude/skills/test-design-contracts/SKILL.md を消化した
    // jq placeholder substitution + fallback 判定。
    // sonnet は "jq を成功させようと頑張る" 方向に逸脱しやすく、
    // 失敗 mode (hard fail or broken JSON Write) のいずれも cycle 全部やり直しで fail-cost 大
    model: 'opus',
    schema: CONTRACTS_SCHEMA,
  })
  if (!contracts) return { error: 'contracts null', stage: 'contracts' }
  if (contracts.blocker) return { error: 'contracts blocked', blocker: contracts.blocker, stage: 'contracts' }
  log(`contracts done: ${contracts.ac_count ?? '?'} AC contracts ${contracts.fallback_used ? '(fallback)' : ''}`)

  return { generator: gen, tiPhase12: tiResults, tiPhase3, contracts }
}

// ────────────────────────────────────────────────────────────────
// Test-Fixture-Setup (Phase Z3+): sprint initial run のみ 1 回・per-iteration
// ではない。runtime_config.test_runner.noise_filter から .pge-fixtures.ts を
// SUT root に generate (LLM 推論ゼロ・workflow JS で literal 確定)。
// 失敗時は halt (blocker.reason: 'pge-fixture-write-failed')。
// ────────────────────────────────────────────────────────────────
phase('Test-Fixture-Setup')
const fixture = await agent(fixtureSetupPrompt(), {
  label: 'fixture-setup',
  phase: 'Test-Fixture-Setup',
  agentType: 'general-purpose',
  schema: FIXTURE_SETUP_SCHEMA,
})
if (!fixture || !fixture.success) {
  log(`fixture-setup failed: ${fixture?.stderr_excerpt || '(unknown)'}`)
  // halt: 後続 Per-AC が .pge-fixtures.ts を import できず大量の test 失敗を招くため
  // まだ iteration loop に入っていない (DB clone 未起動) ので returnWithDispose は不要
  return {
    action: 'halt',
    stage: 'fixture-setup',
    blocker: {
      reason: 'pge-fixture-write-failed',
      detail: `${config.sut_root}/.pge-fixtures.ts への Write が失敗。stderr 末尾: ${fixture?.stderr_excerpt || '(unavailable)'}`,
      attempted_recovery: ['fragment 内容は workflow JS で確定済・agent への伝達 / Write 権限が原因の可能性'],
      human_decision_needed: 'SUT root の書き込み権限を確認・workflow を再実行してください',
    },
    fixture,
  }
}
log(`fixture-setup done: ${fixture.file_path}${fixture.bytes_written ? ` (${fixture.bytes_written} bytes)` : ''}`)

// ────────────────────────────────────────────────────────────────
// MAIN CYCLE: while loop で Generator retry を機械的に closure
// O-4 違反 (changes_requested 時の人間 approval 要求) を構造的に解消
// 全 return 前に disposeIfNeeded() を必ず通す (DB clones cleanup)
// ────────────────────────────────────────────────────────────────

let iteration = 0
const cycleHistory = []
let lastRetryHint = null

async function returnWithDispose(result, reason) {
  const dispose = await disposeIfNeeded(reason)
  if (dispose) result.db_dispose = dispose
  return result
}

while (iteration < MAX_GENERATOR_RETRY) {
  log(`──── Sprint ${sprint} iteration ${iteration + 1}/${MAX_GENERATOR_RETRY} (mode=${mode}) ────`)

  const step4Result = await runStep4to4_5(iteration, lastRetryHint)
  if (step4Result.error) {
    return returnWithDispose({
      action: 'halt',
      stage: step4Result.stage || 'step4-4.5',
      iteration,
      error: step4Result.error,
      blocker: step4Result.blocker || { reason: step4Result.error },
      step4Result,
      cycleHistory,
    }, step4Result.error)
  }

  // Step 5-B-1: Pre-smoke
  phase('Pre-smoke')
  const applyResumeThisIter = (iteration === 0)
  let smoke
  if (applyResumeThisIter && resumeHint.smoke?.skip) {
    const path = resumeHint.smoke.path || `plan/feedback/sprint-${sprint}/_smoke.json`
    log(`pre-smoke: resume skip → read existing ${path}`)
    smoke = await readExistingArtifact(path, SMOKE_SCHEMA, 'smoke')
  } else {
    smoke = await agent(smokePrompt(), {
      label: `pre-smoke#${iteration + 1}`,
      phase: 'Pre-smoke',
      agentType: 'evaluator-pre-smoke',
      schema: SMOKE_SCHEMA,
    })
  }
  if (!smoke) return returnWithDispose({ action: 'halt', stage: 'pre-smoke', iteration, error: 'pre-smoke null', cycleHistory }, 'pre-smoke-null')
  if (smoke.blocker) return returnWithDispose({ action: 'halt', stage: 'pre-smoke', iteration, blocker: smoke.blocker, smoke, cycleHistory }, 'pre-smoke-blocker')
  log(`pre-smoke verdict=${smoke.verdict}`)
  if (smoke.verdict === 'blocked') {
    return returnWithDispose({ action: 'halt', stage: 'pre-smoke', iteration, blocker: smoke.blocker, smoke, cycleHistory }, 'pre-smoke-blocked')
  }

  // Step 5-B-4: Per-AC・v2 batch loop
  phase('Per-AC')
  const perAcSkipSet = (applyResumeThisIter && resumeHint.perAc?.skipSet) || []
  if (perAcSkipSet.length > 0) {
    log(`per-AC: resume skip ${perAcSkipSet.length}/${acIds.length} (${perAcSkipSet.join(',')})`)
  }

  // AC を pool_size 単位の batch に分割
  const batches = []
  for (let i = 0; i < acIds.length; i += poolSize) {
    batches.push(acIds.slice(i, i + poolSize))
  }
  log(`per-AC batches: ${batches.length} × pool_size=${poolSize} (total ${acIds.length} AC)`)

  // baseline stop (clone race avoidance) — 全 batch loop の前に 1 回
  let baselineStoppedForBatch = false
  if (baselineStopSet && baselineStartSet) {
    const stopResult = await agent(baselineLifecyclePrompt('stop'), {
      label: `baseline-stop-iter${iteration + 1}`,
      phase: 'Per-AC',
      agentType: 'general-purpose',
      model: 'haiku',
      schema: BASELINE_LIFECYCLE_SCHEMA,
    })
    if (!stopResult || !stopResult.success) {
      return returnWithDispose({ action: 'halt', stage: 'baseline-stop', iteration, error: 'baseline stop failed', lifecycle: stopResult, smoke, cycleHistory }, 'baseline-stop-failed')
    }
    baselineStoppedForBatch = true
    log(`baseline DB stopped・batch loop 開始`)
  } else {
    log(`baseline_stop_command 未 declare・batch tar copy 中の write race risk 残存`)
  }

  const perAcResults = []
  let batchError = null

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batchAcIds = batches[batchIdx]
    log(`──── Per-AC batch ${batchIdx + 1}/${batches.length}: [${batchAcIds.join(',')}] ────`)
    activeBatchAcIds = batchAcIds.slice()

    // 1. DB clones を batch 内 N 個 順次起動 (script 内部で sibling container 立ち上げ)
    const cloneStart = await agent(dbCloneStartPrompt(batchAcIds), {
      label: `db-clone-start#batch${batchIdx + 1}#iter${iteration + 1}`,
      phase: 'Per-AC',
      agentType: 'general-purpose',
      model: 'opus',
      schema: DB_CLONE_SCHEMA,
    })
    if (!cloneStart || !cloneStart.success) {
      batchError = { stage: `batch${batchIdx + 1}-clone-start`, blocker: { reason: 'batch-clone-failed', batch: batchIdx + 1 } }
      break
    }
    log(`batch ${batchIdx + 1} DB clones started: ${cloneStart.clones?.length || 0} 個 OK`)

    // 2. app container を batch 内 N 個 並列起動 (docker network DNS mode・-p flag なし・同 network 内 container DNS で接続)
    const appStarts = await parallel(batchAcIds.map((acId) => () => {
      const dsUrl = acDataSourceUrl(acId)
      return agent(appPerAcStartPrompt(acId, dsUrl), {
        label: `app-start:${acId}#batch${batchIdx + 1}#iter${iteration + 1}`,
        phase: 'Per-AC',
        agentType: 'general-purpose',
        model: 'haiku',
        schema: APP_LIFECYCLE_SCHEMA,
      })
    }))
    const appStartFailures = appStarts.filter(s => !s || !s.success).length
    if (appStartFailures > 0) {
      batchError = { stage: `batch${batchIdx + 1}-app-start`, blocker: { reason: 'batch-app-start-failed', batch: batchIdx + 1, failures: appStartFailures } }
      break
    }
    log(`batch ${batchIdx + 1} apps started: ${appStarts.length} 個 OK (DNS access mode・container_names: ${batchAcIds.map(a => acIdToSlug(a)).join(', ')})`)

    // 3. Per-AC を batch 内 N 個 並列実行
    const batchResults = await parallel(batchAcIds.map((acId) => () => {
      if (perAcSkipSet.includes(acId)) {
        return readExistingArtifact(`plan/feedback/sprint-${sprint}/${acId}.json`, PER_AC_SCHEMA, `per-ac:${acId}`)
          .then((r) => (r && !r.blocker) ? r : null)
      }
      const perAcAppUrl = appUrlForAc(acId)
      const slug = acIdToSlug(acId)
      const dbContainerName = config.parallel_db.db_clone.container_name_template.replace(/\{ac_id_slug\}/g, slug)
      return agent(perAcPrompt(acId, perAcAppUrl, dbContainerName), {
        label: `per-ac:${acId}#batch${batchIdx + 1}#iter${iteration + 1}`,
        phase: 'Per-AC',
        agentType: 'evaluator-per-ac',
        schema: PER_AC_SCHEMA,
      }).then((r) => {
        if (!r) {
          log(`${acId}: per-AC returned null`)
          return null
        }
        if (r.verdict !== 'blocked' && (r.self_execution_result === null || r.self_execution_result === undefined)) {
          log(`${acId}: WARN verdict=${r.verdict} だが self_execution_result が null (Phase Z5 違反候補)`)
        }
        log(`${acId}: verdict=${r.verdict} retry=${(r.retry_local_metadata || {}).iteration ?? 0}`)
        return r
      }).catch((e) => {
        log(`${acId}: per-AC threw — ${(e && e.message) || e}`)
        return null
      })
    }))
    perAcResults.push(...batchResults)

    // 4. batch dispose (app + DB を並列・best-effort)
    const [appDispose, dbDispose] = await Promise.all([
      agent(appPerAcDisposePrompt(batchAcIds), {
        label: `app-dispose#batch${batchIdx + 1}#iter${iteration + 1}`,
        phase: 'Per-AC',
        agentType: 'general-purpose',
        model: 'haiku',
        schema: APP_LIFECYCLE_SCHEMA,
      }),
      agent(dbCloneDisposePrompt(batchAcIds), {
        label: `db-dispose#batch${batchIdx + 1}#iter${iteration + 1}`,
        phase: 'Per-AC',
        agentType: 'general-purpose',
        model: 'haiku',
        schema: DB_CLONE_SCHEMA,
      }),
    ])
    activeBatchAcIds = []
    log(`batch ${batchIdx + 1} disposed (app=${appDispose?.success ?? '?'}, db=${dbDispose?.success ?? '?'})`)
  }

  // baseline restart — どんな経路でも必ず実行 (落ちたままだと SUT 復帰不能)
  if (baselineStoppedForBatch) {
    const startResult = await agent(baselineLifecyclePrompt('start'), {
      label: `baseline-start-iter${iteration + 1}`,
      phase: 'Per-AC',
      agentType: 'general-purpose',
      model: 'haiku',
      schema: BASELINE_LIFECYCLE_SCHEMA,
    })
    if (!startResult || !startResult.success) {
      return returnWithDispose({ action: 'halt', stage: 'baseline-start', iteration, error: 'baseline restart failed・人間 intervention 必要', lifecycle: startResult, smoke, cycleHistory }, 'baseline-start-failed')
    }
    log(`baseline DB restarted (${startResult.duration_ms}ms)`)
  }

  if (batchError) {
    return returnWithDispose({
      action: 'halt',
      iteration,
      ...batchError,
      perAcs: perAcResults,
      smoke,
      cycleHistory,
    }, batchError.stage)
  }

  const validPerAcs = perAcResults.filter(Boolean)
  if (validPerAcs.length === 0) {
    return returnWithDispose({ action: 'halt', stage: 'per-ac', iteration, error: 'all per-AC failed', smoke, cycleHistory }, 'all-per-ac-failed')
  }

  // Step 5-B-4.5: Auditor
  phase('Auditor')
  let audit
  if (applyResumeThisIter && resumeHint.audit?.skip) {
    const path = resumeHint.audit.path || `plan/feedback/sprint-${sprint}/_audit.json`
    log(`auditor: resume skip → read existing ${path}`)
    audit = await readExistingArtifact(path, AUDIT_SCHEMA, 'audit')
  } else {
    audit = await agent(auditorPrompt(), {
      label: `auditor#${iteration + 1}`,
      phase: 'Auditor',
      agentType: 'evaluator-auditor',
      schema: AUDIT_SCHEMA,
    })
  }
  if (!audit) {
    return returnWithDispose({ action: 'halt', stage: 'auditor', iteration, error: 'auditor null', smoke, perAcs: validPerAcs, cycleHistory }, 'auditor-null')
  }
  log(`auditor verdict=${audit.verdict} (${(audit.findings || []).length} findings)`)
  if (audit.verdict === 'blocked') {
    return returnWithDispose({ action: 'halt', stage: 'auditor', iteration, blocker: audit.blocker, smoke, perAcs: validPerAcs, audit, cycleHistory }, 'auditor-blocked')
  }
  if (audit.verdict === 'drift_detected') {
    log(`drift_detected: 影響 AC を regen するべきだが本 PoC は未実装。aggregator に進む`)
  }

  // Step 5-B-6: Aggregator
  phase('Aggregator')
  let aggregate
  if (applyResumeThisIter && resumeHint.agg?.skip) {
    const aggPath = resumeHint.agg.path || `plan/feedback/${mode === 'final' ? 'final.json' : `sprint-${sprint}.json`}`
    log(`aggregator: resume skip → read existing ${aggPath}`)
    aggregate = await readExistingArtifact(aggPath, AGG_SCHEMA, 'aggregator')
  } else {
    aggregate = await agent(aggPrompt(), {
      label: `aggregator#${iteration + 1}`,
      phase: 'Aggregator',
      agentType: 'evaluator-aggregator',
      schema: AGG_SCHEMA,
    })
  }
  if (!aggregate) {
    return returnWithDispose({ action: 'halt', stage: 'aggregator', iteration, error: 'aggregator null', smoke, perAcs: validPerAcs, audit, cycleHistory }, 'aggregator-null')
  }
  log(`aggregator verdict=${aggregate.verdict} risk_score=${aggregate.risk_score ?? 'n/a'} hard_rule_hit=[${(aggregate.risk_flags?.hard_rule_hit || []).join(',')}]`)

  // Step 6: Escalation 判定
  cycleHistory.push({ iteration, smoke: smoke.verdict, perAcCount: validPerAcs.length, audit: audit.verdict, agg: aggregate.verdict, risk_score: aggregate.risk_score })

  if (aggregate.verdict === 'blocked') {
    return returnWithDispose({ action: 'halt', stage: 'aggregator', iteration, blocker: aggregate.blocker, smoke, perAcs: validPerAcs, audit, aggregate, cycleHistory }, 'aggregator-blocked')
  }

  if (aggregate.verdict === 'fail') {
    log(`aggregator fail → Generator retry (iteration ${iteration + 1} → ${iteration + 2})`)
    lastRetryHint = { source: 'aggregator-fail', findings: aggregate.findings || [] }
    iteration++
    continue
  }

  // aggregate.verdict === 'pass'
  const hardRuleHit = (aggregate.risk_flags || {}).hard_rule_hit || []
  const riskScore = aggregate.risk_score || 0
  const needReviewer = hardRuleHit.length > 0 || riskScore >= 6

  if (!needReviewer) {
    log(`aggregator pass + 低リスク (risk_score=${riskScore}, hard_rule_hit=[]) → sprint done`)
    return returnWithDispose({ action: 'done', stage: 'aggregator', iteration, smoke, perAcs: validPerAcs, audit, aggregate, cycleHistory, parallelDbMode }, 'done-aggregator')
  }

  // Step 7: Expert-Reviewer
  phase('Reviewer')
  let review
  if (applyResumeThisIter && resumeHint.review?.skip) {
    const revPath = resumeHint.review.path || `plan/review/sprint-${sprint}.json`
    log(`reviewer: resume skip → read existing ${revPath}`)
    review = await readExistingArtifact(revPath, REVIEWER_SCHEMA, 'reviewer')
  } else {
    review = await agent(reviewerPrompt(aggregate), {
      label: `reviewer#${iteration + 1}`,
      phase: 'Reviewer',
      agentType: 'expert-reviewer',
      model: 'opus',
      schema: REVIEWER_SCHEMA,
    })
  }
  if (!review) {
    return returnWithDispose({ action: 'halt', stage: 'reviewer', iteration, error: 'reviewer null', smoke, perAcs: validPerAcs, audit, aggregate, cycleHistory }, 'reviewer-null')
  }
  log(`reviewer verdict=${review.verdict} next_action=${review.next_action ?? 'n/a'} required_changes=${(review.required_changes || []).length}`)

  // Step 8: Routing (mechanical switch・O-4 構造的解決)
  phase('Routing')
  switch (review.verdict) {
    case 'approved':
      log(`reviewer approved → sprint done`)
      return returnWithDispose({ action: 'done', stage: 'reviewer', iteration, smoke, perAcs: validPerAcs, audit, aggregate, review, cycleHistory, parallelDbMode }, 'done-reviewer')

    case 'blocked':
      log(`reviewer blocked → halt to human`)
      return returnWithDispose({ action: 'halt', stage: 'reviewer', iteration, blocker: review.blocker, smoke, perAcs: validPerAcs, audit, aggregate, review, cycleHistory }, 'reviewer-blocked')

    case 'changes_requested':
      switch (review.next_action) {
        case 'generator_retry':
          log(`reviewer changes_requested + next_action=generator_retry → iteration ${iteration + 1} → ${iteration + 2}`)
          lastRetryHint = { source: 'reviewer-generator-retry', required_changes: review.required_changes || [] }
          iteration++
          continue

        case 'per_ac_regen':
          log(`reviewer changes_requested + next_action=per_ac_regen → 本 PoC 未実装で caller に振る`)
          return returnWithDispose({
            action: 'needs_per_ac_regen',
            stage: 'reviewer', iteration,
            required_changes: review.required_changes || [],
            smoke, perAcs: validPerAcs, audit, aggregate, review, cycleHistory,
          }, 'needs-per-ac-regen')

        case 'aggregator_regen':
          log(`reviewer changes_requested + next_action=aggregator_regen → aggregator のみ再 spawn`)
          const aggRegen = await agent(aggPrompt(), {
            label: `aggregator-regen#${iteration + 1}`,
            phase: 'Aggregator',
            agentType: 'evaluator-aggregator',
            schema: AGG_SCHEMA,
          })
          return returnWithDispose({ action: 'done', stage: 'aggregator-regen', iteration, smoke, perAcs: validPerAcs, audit, aggregate: aggRegen || aggregate, review, cycleHistory, parallelDbMode }, 'done-aggregator-regen')

        default:
          return returnWithDispose({
            action: 'halt',
            stage: 'reviewer-routing', iteration,
            blocker: { reason: `unknown next_action: ${review.next_action}` },
            smoke, perAcs: validPerAcs, audit, aggregate, review, cycleHistory,
          }, 'unknown-next-action')
      }

    default:
      return returnWithDispose({
        action: 'halt',
        stage: 'reviewer-routing', iteration,
        blocker: { reason: `unknown reviewer verdict: ${review.verdict}` },
        smoke, perAcs: validPerAcs, audit, aggregate, review, cycleHistory,
      }, 'unknown-reviewer-verdict')
  }
}

// retry 上限超過
return await returnWithDispose({
  action: 'halt',
  stage: 'retry-limit',
  iteration,
  blocker: { reason: `Generator retry 上限 ${MAX_GENERATOR_RETRY} 回到達。修正が収束しない。` },
  cycleHistory,
}, 'retry-limit')
