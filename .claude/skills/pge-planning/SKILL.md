---
description: PGE Step 1 (Researcher with cache reuse) → Step 1.5 (Discovery・任意) → Step 2 (Planner) → Step 3 (人間承認 FB loop) を orchestrator inline で実行する planning skill。Researcher / Discovery は heavy 1-shot のため subagent 起動・Planner は orchestrator が直接演じることで AskUserQuestion による review FB loop の iteration 間に context warm cache を維持する (旧 pge-planning Workflow が抱えていた「mid-run user input 不可・iteration ごとに subagent fresh context」問題の構造的解決)。
disable-model-invocation: true
argument-hint: "<userRequest> (短文 / 長文 / @path 参照混在可)・引数なしで既存 plan/spec.md の差し戻し review modus 起動"
---

# /pge-planning — PGE 仕様書起草 + Human Review FB Loop Skill

PGE の Step 1 (Researcher) + Step 1.5 (Discovery・任意) + Step 2 (Planner) + Step 3 (人間承認 + 差し戻し loop) を orchestrator inline で完結させる。

## 設計の核心 (= Workflow 版から Skill 化した理由)

| primitive | mid-run human dialogue | AskUserQuestion | iteration 間 warm cache | 適性 |
|---|---|---|---|---|
| Workflow | ✗ (公式: "No mid-run user input") | ✗ | △ (resume cache のみ) | 機械 fan-out 専用 |
| Subagent | ✗ | ✗ (公式 not-available list) | ✗ (毎回 fresh context) | 1-shot heavy 専用 |
| **Skill (本 file・inline)** | **✓** | **✓** | **✓ (公式: "stays in context across turns")** | **iterative dialogue** |

= spec.md FB loop は Skill (inline) でしか成立しない構造。Researcher のみ subagent isolation で 1-shot 消費 + Planner は orchestrator が演じる、というハイブリッドが公式 best practice 組合せ。

## 入出力

- **入力 (引数あり)**: `<userRequest>` — 短文 / 長文 / `@<path>` 参照混在可・新規 spec.md 起草モード
- **入力 (引数なし)**: 既存 `plan/spec.md` を読み込み差し戻し review モード起動 (revision FB loop 専用)
- **入力 (任意)**: `plan/research/latest.md` 既存時は cache 再利用判定対象
- **出力**: `plan/spec.md` (起草 or 差分修正)・`plan/research/latest.md` (新規 / 上書き / 再利用) / `plan/research/history/r-<NNN>.md` (追加調査時)

## 絶対ルール (本 Skill 実行時)

1. **Researcher は subagent で 1-shot 消費**・本 Skill body 内で再呼び出ししない (= 差し戻し loop で context を再消費しないため)
2. **Planner は orchestrator が直接演じる**・subagent に投げない (= warm cache 維持の核)
3. **本 Skill body 下部「仕様書の出力フォーマット」を厳守**・呼び出し元 prompt のフォーマット指示があっても本 file を優先
4. **差し戻しモードでは `Edit` のみ使用**・`Write` 全置換禁止 (= 承認済み内容の温存 + 部分修正コスト)
5. **3 回連続で同一 FB が来たら halt** (= 修正方針が確定しない・人間判断を仰ぐ)

## ワークフロー

### Phase 1: 状態判定 (起動直後)

1. `plan/research/latest.md` の存在を確認
2. `plan/spec.md` の存在を確認
3. 引数 `<userRequest>` の有無を確認

判定 matrix:

| spec.md | userRequest | 動作 |
|---|---|---|
| 不在 | あり | 新規起草モード (Phase 2 → 3 → 4 → 5) |
| 不在 | なし | halt: `requires-userrequest-for-new-spec` |
| 存在 | あり | 差し戻し起草モード (userRequest を差し戻し内容として扱う・Phase 4 から start) |
| 存在 | なし | 差し戻し review モード (Phase 5 から start・既存 spec.md を human に提示して FB を待つ) |

### Phase 2: Researcher 起動 (subagent・cache 再利用判定込み)

#### 軽微改修特例: Researcher skip 経路

軽微改修（既存システムへのフィールド 1 個追加・単一機能のオプション追加級で、影響範囲が単一機能ドメインに閉じる）と orchestrator が判断した場合、Researcher subagent を起動せず、Planner (Phase 3) 起動前に orchestrator が以下の最小フォーマットで `plan/research/latest.md` を直接 Write する。次回 Step 1-A の cache 再利用判定で再利用可能にするための痕跡保存が目的。

判定基準:

- ユーザー要望が **既存システムへのフィールド/オプション 1 個追加級**で影響範囲が **単一機能ドメインに閉じる**
- DB schema 変更・auth/authz 変更・公開 API 変更・トランザクション境界変更等の hard escalation rule に該当しない
- 既存コードを orchestrator が直接 Read して影響範囲が一次判断できる規模

判定が成立したら本節を skip せず以下の最小フォーマットで latest.md を Write し、Phase 3 に進む。判定不能なら通常の Researcher 起動 (本節「Researcher subagent 起動」) に fallback。

```markdown
# Pre-Planning Result（軽微改修・Researcher スキップ）

## 1. 要件整理
- 目的: [ユーザー要望の要約 1〜2 行]
- 対象システム: [リポジトリ名・主なパス]
- スキップ判断: 軽微改修特例（影響範囲が単一機能ドメインに閉じる）

## 2. オーケストレータが読み取った既存コード
- [ファイルパス]: [短い役割メモ]
- [ファイルパス]: [短い役割メモ]
- ...

## 3. 影響範囲（オーケストレータの一次判断）
- 変更候補箇所: [ファイル群]
- リスク: [想定される副作用、なければ「特になし」]

## 4. 不確実性
- [あれば。なければ「なし」]

## 5. メタ
- skip_reason: minor_modification
- skipped_at: [日時 (ISO8601)]
- read_files: [Planner 起動前にオーケストレータが Read したファイルのリスト]
```

通常の Researcher 出力に比べて簡素だが、最低限の構造を保つことで次回の Step 1-A cache 判定で再利用可能。このファイルが残らないと、次回同タスクでも再びソースを読み直すことになり累積コストが発生する。

#### Researcher subagent 起動 (通常経路)

Agent tool で **researcher subagent を 1 回起動**する (`.claude/agents/researcher.md` の定義に従う):

```
Agent({
  subagent_type: "researcher",
  description: "PGE Step 1 research for spec drafting",
  prompt: `pge-planning Skill から Step 1 (Researcher) として起動。

monitor_dir: plan/monitor/researcher-cycle1/

ユーザー要望:
<userRequest をそのまま literal で>

agent 定義 (.claude/agents/researcher.md) の通り 実行:
- 既存 plan/research/latest.md があれば再利用可否を判定 (対象 system + 要望 keyword が整合するなら latest.md を維持)
- 再利用しない場合は plan/research/latest.md を新規 Write or 上書き
- 再利用 + 追加調査が必要な場合は plan/research/history/r-<YYYYMMDD>-<NNN>.md に追加分のみ Write

完了時 return: {research_path, reused_cache, summary, sections, new_history_file?}`
})
```

返り値の `research_path` / `reused_cache` / `summary` を control flow に使う。`blocker` があれば halt して人間に提示。

### Phase 2.5: Discovery 起動判定 (Z11.0・推奨)

Researcher 完了後、Planner 起動前に **Discovery (SUT facts 抽出)** を起動するか判定する。Discovery は discoverer subagent を起動し `plan/domain.json` (entities + endpoints + named_states + planned_changes) を生成する。Planner はこれを sprint.json の grounding source として消費する。

#### Discovery 起動が推奨されるケース

- 既存 SUT 内に **業務 validation rule** (entity 重複 / permission / 状態遷移制約等) があり、test が特定 state でないと happy path に到達できない
- test_case が SUT の実 schema / endpoint に grounded であることを保証したい (= ほぼ全ての非自明 sprint)

#### Discovery を skip してよいケース

- 新規プロダクトで既存 SUT facts が存在しない (= entities / endpoints が空集合)
- 軽微改修特例 (Phase 2 で Researcher skip と同じ基準) で影響範囲が単一機能ドメインに閉じる

#### 起動方法

Discovery を起動する場合、`/pge-discovery` Skill を inline で呼び出す:

```
/pge-discovery <userRequest と同じ literal>
```

`/pge-discovery` Skill 内部で:

1. discoverer subagent が `plan/research/latest.md` を起点に SUT を Grep し `plan/domain.json` を生成 (schema 一次資料: `.claude/references/pge-spec-schema.md`)
2. orchestrator が domain.json を Read し AskUserQuestion で named_states / planned_changes の scope を人間に確認
3. 承認後に本 Skill (`/pge-planning`) Phase 3 に戻る

Discovery を skip する場合、Phase 3 にそのまま進む。sprint.json は生成されず spec.md の概要のみで実装に進む (= grounding gate dis-armed の簡易 sprint)。

### Phase 3: Planner role (orchestrator 直接演じる・初回起草)

**Z11.1+ 重要**: 人間向け prose (概要 / 出発点 / コア機能 / 前提条件 / 制約) は **`plan/sprint.json#prose` に構造化 authored** する (Phase 3.5 と同時)。`plan/spec.md` には authored prose を書かない (= 人間は spec-visual.html 1 枚だけ読む)。spec.md は legacy `ls spec.md` check 互換のための **thin pointer** (下記) のみ書く。

#### spec.md (Z11.1+ thin pointer)

```markdown
# [プロダクト名] — Sprint N

詳細は機械可読 spec に一元化されています (Phase Z11.1)。人間レビューは HTML を参照してください。

- 人間レビュー: `plan/spec-visual.html` (= `domain.json + sprint.json` から tool 生成)
- test plan (authored): `plan/sprint.json` (prose + requirements + test_cases)
- SUT facts: `plan/domain.json`
```

prose の本体 (概要 / 出発点 / コア機能 / 前提条件 / 制約 / Planner 決定) は次の Phase 3.5 で `sprint.json#prose` に書く。下記「(参考) prose の内容指針」は sprint.json#prose の各 field を author する際の品質基準。

#### (参考) prose の内容指針 (sprint.json#prose の field 品質基準)

```markdown
# [プロダクト名]

## 概要
[1〜3文でプロダクトの目的とターゲットユーザーを記述]

## コア機能一覧

| #   | 機能名 | 説明（1文） |
| --- | ------ | ----------- |
| 1   | ...    | ...         |
| 2   | ...    | ...         |

- 「説明」は **1 文**に厳格化・「何を作るか」のみを記述する。詳細要件・実装条件・コード参照・バリデーション仕様などはスプリント計画側に一元化し、ここには書かない。
- 「#」列はスプリント計画から ID 参照するためのキー。番号は連番で振り、スプリント分割の順序とは独立に確定させる。
- この一覧に載せる機能は**全て実装対象**として扱う。実装しない機能は載せず、「## 制約事項」に「スコープ外（将来拡張候補）」として明示する。
- 優先度列は持たない。spec.md は実装対象として確定したスコープのみを表現し、Generator/Evaluator が「実装すべきか」で判断ぶれを起こさないようにする。

## スプリント計画

### Sprint 1: [テーマ]
**ゴール:** [このスプリントで達成すること]
**機能:**
- [ ] (#1) 機能名: 詳細な要件説明
- [ ] (#2) 機能名: 詳細な要件説明
**前提条件:** [アプリ起動成功・既存テスト全パス等の環境前提]

### Sprint 2: [テーマ]
...（同様の形式で続く）
```

#### AC (= test_case) の authoring 場所 (Z11.0: spec.md に AC を書かない)

**Phase Z11.0 では spec.md に AC / 受け入れ基準を書かない**。要件粒度の分岐と検証ケースは `plan/sprint.json` に authored される (Phase 3.5):

- `sprint.json#requirements[]` = 要件粒度の機能分岐 (id + description + scope の thin grouping)
- `sprint.json#test_cases[]` = 各 requirement を verify する具体ケース (AC-N・state / input / expected を全て literal)

(Z11.1+) prose (概要 / 出発点 / コア機能 / 前提条件 / 制約) も spec.md ではなく `sprint.json#prose` に構造化 authored される。spec.md は thin pointer のみ。人間が読む唯一の artifact は `plan/spec-visual.html` (tool が domain.json + sprint.json から生成)。

Discovery skip sprint (= sprint.json 非生成) では spec.md に簡易 AC を書いてよいが、その場合 grounding gate は dis-armed。

#### test_case 規約 (Phase 3.5 で sprint.json に author する際の指針・spec.md には書かない)

- 各 test_case は **単一の検証可能な behavior** のみを含める (複数動作を `かつ`/`および` で連結しない・分割する)
- `test_cases[].id` は `AC-N` の連番・**sprint.json 全体で通し番号** (Evaluator の parallelism 単位)。prefix は framework 共通の `AC-` (execution 層の `AC-*.json` glob / contracts key / evidence dir と同一 token・schema doc `pge-spec-schema.md` 参照)
- 各 test_case は親 `requirement_id` を持つ (= 要件粒度の grouping)
- 環境前提 (アプリ起動成功・既存テスト全パス等) は test_case にせず spec.md 末尾「前提条件」節に分離する
- 検証カテゴリの考え方 (HTTP default / BROWSER は browser 必須のみ) は下記表を Planner の自己問診に用いる (Evaluator は capability composition で artifact_framework を機械導出するため tag は guidance のみ)

#### test_case にしてはいけないパターン

以下は test_case ではなく「前提条件」「非機能要件」に分離する:

- ❌ "既存テストが全件 pass する" / "build が成功する" / "lint / type-check pass" / "test coverage が X% 以上" / "performance が劣化しない" (基準なし) / "セキュリティスキャン pass" (脅威モデルなし)

理由: これらは**ユーザーから見た受け入れ可能な behavior** ではなく**実装の健全性検証**で Generator 責任範囲。evaluator per-ac Step 0 の observation kind catalog (render / state-write / state-read / state-transition・全 Playwright E2E 前提) のいずれにも該当しない。AC として書くと **evaluator per-ac が halt**。

正しい配置:

| ❌ AC として | ✅ 正しい配置 |
|---|---|
| 既存テスト pass | spec.md 末尾「前提条件」節 |
| build / lint pass | 同上 |
| test coverage X% | 「非機能要件」節 |
| performance 劣化なし | 「非機能要件」節 (具体 metric 必須: 「P95 < 200ms」等) |
| 仕様検証 (新機能が動く) | AC として列挙 |

#### 検証カテゴリの選び方 (Phase Z5+ 改訂: HTTP default・BROWSER は本当に browser 必須なときのみ)

| カテゴリ | 適用 AC | Evaluator の典型手段 (capability composition で機械導出) | エビデンス |
|---|---|---|---|
| **`[HTTP]`** (推奨 default) | server-rendered HTML response (Thymeleaf / JSP / ERB / Jinja2 等) の text / 属性検証・REST API レスポンス・HTTP status / redirect 検証 | F-http-request-curl (curl + bash + grep / jq / xmllint)・~1-2s/test | `.txt` (response body) / `.json` |
| **`[BROWSER]`** | browser engine 必須要素: JS による DOM 動的変更 (SPA) / client-side state / focus / animation / ARIA live region (JS update) / CSS visual / multi-step UI 操作 | F-playwright-ts (browser engine 必須) | `.png` / trace.zip |
| `[CLI]` | コマンド実行結果・標準出力・終了コード | F-bash-script | `.txt` |
| `[Batch]` | バッチジョブ・スケジュール処理・大量データ処理 | F-bash-script | `.txt` |
| `[DB]` | DB 状態変更・スキーマ変更・データ整合性 | F-sql-with-bash-wrapper or F-http-request-curl + SQL 観測 | `.diff` / `.dump` |
| `[UI]` (後方互換) | = `[BROWSER]` の旧名・新規 spec では `[BROWSER]` 使用推奨 | 同上 | 同上 |
| `[API]` (後方互換) | = `[HTTP]` の旧名・新規 spec では `[HTTP]` 使用推奨 | 同上 | 同上 |

選定指針 (Phase Z5+):
- **default は `[HTTP]`**: server-rendered HTML (Thymeleaf / JSP / ERB / Jinja2 等) を text / 属性検証する場合・REST API・status code / redirect 検証は `[HTTP]`。eval が **~1-2s/test と高速**で・大半の AC はこれで十分。
- **`[BROWSER]` は厳格な閾値で**: 以下のいずれかを **AC が明示的に要求する**場合のみ `[BROWSER]` を選ぶ:
  - SPA (React / Vue / Angular 等の client-side rendering)
  - JS による DOM 動的変更 (button click → state change → re-render)
  - browser-only state (focus / localStorage / ARIA live region の JS update)
  - CSS / visual / animation / hover effect 等の見た目検証
  - multi-step UI 操作 (form click → modal → confirm → result の遷移)
- 「API / エンドポイント / HTTP / JSON」→ `[HTTP]`
- 「コマンド / 実行 / 起動」+ 出力が標準出力・ファイル → `[CLI]` or `[Batch]`
- 「保存 / 削除 / 更新」+ UI 経由でない確認 → `[DB]`
- 複数層検証要求 → 複数タグ (例: フォーム POST → DB 確認 → `[HTTP, DB]`)

**重要**: tag は **Planner の自己レビュー hint** であり、Evaluator の dispatcher ではない (Phase Z2+ 規約)。最終的な artifact_framework は Evaluator が available capability + spec 解釈から機械導出する。Planner が `[BROWSER]` と書いても、Evaluator の capability composition が「browser-essential capability 不在」と判定すれば F-http-request-curl に降格することがある (= tag は guidance・最終決定は capability composition)。

#### スプリント設計指針 (最重要)

**主原則**: スプリント = AC を end-to-end で検証可能な作業単位。backend-only / view-only の中間状態を別スプリントに切らない。UI を伴う機能追加は UI まで含めて 1 スプリントに収めるのが基本。

理由: backend-only や view-only の中間スプリントは AC を integration test client/curl 単体テスト等の代替手段でしか検証できず、後続スプリントで同一シナリオを UI 経由で再検証する重複コストを生む。Evaluator の検証手段格下げを誘発し、SKILL.md「禁止事項 (手段の格下げ禁止)」と衝突する。

判定軸 (orchestrator がスプリント分割で考慮):

| 軸 | 基準 | 行動 |
|---|---|---|
| end-to-end 検証可能性 (最優先) | AC が UI 経由で end-to-end 検証できる粒度 | UI まで含めて 1 sprint に収める |
| 1 sprint 想定実装量 | Generator 1 回・Evaluator 1 回で完結する規模 | 超えるなら分割・下回るなら統合 |
| AC 数 | 5 件未満 + 依存一直線 | 1 sprint に統合 |
| 変更ファイル群 | 同一機能ドメインの拡張 (フィールド追加・カラム追加等) | 同 sprint・ファイル単位で分割しない |
| 軽微改修 | 「フィールド 1 個追加」級 + hard rule 該当なし | **1 sprint** (backend + view + test 1 本化) |
| 縦割り機能 | Generator 1 回で実装しきれない + 各層が独立に end-to-end 検証可能 | 例外的に 2-3 sprint (上限) |

禁止事項:

- ❌ 「念のため」「テストを別 sprint に」で分割しない (テストは該当機能 sprint に含める)
- ❌ **依存順序 (model → form → UI 等) を理由に sprint 分割しない**・依存は sprint 内実装順序で扱う
- ❌ **backend-only / view-only の中間 sprint を作らない**・AC を end-to-end 検証できない粒度は sprint として不成立
- ❌ 1 sprint で `tests_run` が空配列になる分割 (テスト無し sprint) を作らない
- ❌ 受け入れ基準を機能ごとにバラさない (1 機能 = 受け入れ基準 1 つ未満になる細分化禁止)

**スプリント数を増やすほど隔離コンテキスト初期化コストが複利で発生**することを認識し、安全側に倒して細かく刻まない。不確実なときは「Generator 1 回で実装が完結するか」「AC を UI 経由で end-to-end 検証できるか」の 2 点を自問。

#### 制約事項節

```markdown
## UI/UX 要件
[画面遷移、主要なUIコンポーネント、ユーザーフローの説明]

## 非機能要件
[パフォーマンス、アクセシビリティ、レスポンシブ対応など]

## 制約事項
[スコープ外の機能、既知の制限]
```

### Phase 3.5: sprint.json 構築 (Phase Z11.0・Discovery 実行時推奨)

Phase 3 (spec.md 概要起草) 直後、または差し戻しモード (Phase 4) で要件が変わった直後に、`plan/sprint.json` (requirements + test_cases) を author する。schema 一次資料は **`.claude/references/pge-spec-schema.md` の sprint.json section**。

**Z11.0 核心規約**:
- spec.md は薄い概要のみ・要件と test_case は sprint.json に一元 authored (drift 不能)
- test_cases[].input / expected は **literal only** (rule 表現禁止)・behavior rule は `domain.json#planned_changes[].behavior.rule` の 1 箇所のみ
- test_cases[].trigger.path / expected.db_after.table / expected.db_after.row の各 col / input の各 field / html_contains の各 message は **`plan/domain.json` に grounded 必須** (grounding gate を末尾で機械検証)

#### 起動推奨ケース / skip ケース

- 推奨: Phase 2.5 で `plan/domain.json` が生成済・非自明 sprint (要件分岐が複数ある)
- skip: 軽微改修特例 (test_case 3 件未満) / Discovery skip sprint (domain.json 不在)

#### sprint.json 構築手順

0. **prose を author (Z11.1+)**: `sprint.json#prose` に人間向け散文を構造化記述:
   - `title` / `overview` (概要 1-3 文) / `starting_point[]` (出発点・既存 SUT 現状) / `core_features[]` ({id, name, description}) / `prerequisites[]` (前提条件) / `constraints[]` (制約・スコープ外) / `planner_decisions[]` ({topic, decision}・Discovery unknowns への決定)
   - prose は「何を作るか」の高レベルのみ・実装 detail (column 名 / status code) は書かない (それは test_cases / planned_changes)
1. **requirements[] を author**: 要件粒度の機能分岐を列挙 (= 「機能の意味として何分岐あるか」)。各 entry は `id` (R-N) + `description` (要件 1 文・実装 detail を含めない) + `scope` (required / optional-regression / out-of-scope)。典型 5-10 件。
2. **test_cases[] を author**: 各 requirement を verify する具体ケースを列挙:
   - `id` (AC-N 連番) + `requirement_id` (親 R-N) + `label` (verify 観点 1 行)
   - `state` = `domain.json#named_states[].id` を refer (state-independent な test は null)
   - `trigger` (kind / method / path) — **path は domain.endpoints に grounded か planned_changes に declare**
   - `input` (全 field literal・**field 名は domain.endpoints[].form_fields に grounded**・rule 表現禁止)
   - `expected.http` (status / redirect_to / html_contains — **message は domain.endpoints[].messages または planned_changes.behavior に grounded**)
   - `expected.db_after` (table / op / match / row — **table と row の各 col は domain.entities に grounded**・controller 固定値は domain.endpoints[].fixed_field_values と一致確認)
   - `extra_steps[]` (E2E chain 等)
   - 同 requirement を input variation 違い (通常値 / 境界 / 空 / E2E 等) で複数 test_case にする (= requirement:test_case = 1:N)
3. **coverage を算出**: `gap` = scope=required で test_case を持たない requirement 数
4. **grounding を算出**: trigger_path / db_table / db_column / input_field / html_message の 5 軸それぞれで grounded / planned / ungrounded を数える

#### Phase 3.5 完了 gate (Z11.0 / Z11.1)

- `plan/sprint.json` が `.claude/references/pge-spec-schema.md` の sprint.json schema を満たす (`prose` section を含む)
- `coverage.gap == 0` (全 required requirement が test_case を持つ)
- `grounding.*.ungrounded == 0` (全 5 軸で想像 field なし — domain.json に grounded or planned_changes に declare 済)
- 各 test_case.expected が空 object でない (literal で埋まっている)
- **(Z11.1) spec-visual.html を生成**: gate を満たしたら以下を Bash 実行し人間レビュー artifact を deterministic 生成する:

```bash
python3 .claude/tools/pge-spec-visual.py
# → plan/spec-visual.html を生成 (domain.json + sprint.json から)・grounding_gate=PASS を確認
```

  tool が `grounding_gate=FAIL` を report したら gate 未達 (gap or ungrounded > 0)・Phase 5 に進まず差し戻し。LLM が HTML を手書きしない (= tool で deterministic 生成・JSON との drift 排除)。

gate fail なら Phase 5 に進まず差し戻し (test_case 修正 or Discovery 差し戻しで domain.json 拡張)。

#### file の役割分離 (Z11.1)

- **plan/domain.json**: SUT facts (Generator 実装 spec + grounding source)・discoverer 生成
- **plan/sprint.json**: prose (概要〜制約) + requirements + test_cases — **人間が編集する唯一の authored file**・Planner author
- **plan/spec-visual.html**: tool が生成する **唯一の人間レビュー artifact** (人間は HTML 1 枚だけ読む)
- **plan/spec.md**: thin pointer のみ (legacy `ls spec.md` check 互換)・authored prose を持たない

Generator / Evaluator は domain.json + sprint.json を一次 source とする。人間は spec-visual.html を読む (spec.md / JSON を直接読まなくてよい)。

### Phase 4: 差し戻しモード (spec.md 既存時の差分修正)

ユーザーから「修正・追加・削除」の差し戻しを受けたら、**全体再生成せず差分修正のみ**を行う。本 Skill の cost 効率と承認済み内容の温存を両立するための必須ルール。

- **`Write` ツール使用禁止**・`Edit` (or `MultiEdit`) のみで該当行・該当節を差し替える
- 該当しない節 (承認済み章・スプリント・受け入れ基準) は読み取りのみ・書き換えない
- 差し戻し範囲を超えた「ついでの整形」「言い回し統一」を行わない
- 完了報告は**変更箇所のみ**を列挙 (差分単位の `Before → After`)・仕様書サマリ全体の再掲示はしない

差し戻しモードでも以下は必ず守る:

- スプリント番号の振り直しが必要なら整合を取る (`Sprint 1 → Sprint 2` の番号変更も `Edit` で行う)
- スコープ外 (制約事項) に動かす場合は「## 制約事項」節に追記
- 機能をスコープ外に動かすときは「## コア機能一覧」の該当行を削除し「## 制約事項」へ追記・スコープ内に戻すときはその逆・いずれも `Edit` で
- 機能 ID (`#N`) は欠番を許容する・スコープ外移動で行を消したときに残りの ID を振り直さない (スプリント計画側の `(#N)` 参照が壊れるため)

### Phase 5: 人間承認 + FB loop (AskUserQuestion・本 Skill の中核)

spec.md 起草 / 差分修正完了後、`AskUserQuestion` で承認を求める:

```
question: "spec.md (sprint_count={N} / ac_count={M}) を起草しました。承認しますか?"
options:
  - label: "承認"
    description: "/pge-runtime-survey で runtime config を生成し /pge-sprint-cycle で実装に進む"
  - label: "修正依頼"
    description: "FB を口頭で示し、orchestrator が Edit で差分修正"
  - label: "halt"
    description: "本 Skill を中断 (spec.md は現状で残す)"
```

選択別の遷移:

| 選択 | 動作 |
|---|---|
| 承認 | 完了報告 (sprint_count / requirement 数 / test_case 数 / coverage.gap / grounding 各軸の ungrounded / 主要設計判断 1-2 件) + 「次に `/pge-runtime-survey` (未生成の場合) → `/pge-sprint-cycle` を起動してください」と案内して終了 |
| 修正依頼 | 人間の FB を待つ → Phase 4 (差し戻しモード) → Phase 5 に loop (test_case / requirement 関連の FB なら Phase 3.5 も含めて再起草) |
| halt | spec.md / sprint.json は現状を維持・本 Skill 終了 |

#### sprint.json の整合 self-check (Discovery 連携時)

`plan/sprint.json` が存在する場合、Phase 5 で AskUserQuestion を投げる前に以下を機械的に確認:

1. `coverage.gap == 0` (全 required requirement が test_case を持つ)
2. `grounding.*.ungrounded == 0` (全 5 軸で想像 field なし)
3. domain.json で `scope: "required"` な named_state のうち、どの test_case からも参照されないものを列挙 (= 取りこぼし候補・人間に追加要否を確認)
4. domain.json で `named_states[].setup.missing_components` 非空の state を参照する test_case がある場合は generator が factory 実装を deliverable に積む旨を承認 question に明示

self-check fail は差し戻しモードで修正 (gate を満たすまで Phase 5 に進まない)。

**FB loop の上限**: 同一論点で 3 回連続の修正依頼が来たら **halt** し人間に判断を仰ぐ (`blocker.reason: "fb-loop-not-converging"`)。

### Phase 6: halt 判断

CLAUDE.md halt プロトコル準拠。以下に該当したら `plan/spec.md` 末尾に `## BLOCKED` 節のみを書いて停止する (既存 spec を壊さないため、差し戻しモードのときは既存内容を残したまま末尾追加):

| halt 条件 | 例 |
|---|---|
| ユーザー要望が既存設計／前提と両立せず本 Skill 単独で判断不能 | 「DB を使わずに永続化したい」 vs 既存設計が DB 前提 |
| 必須入力 (Researcher 結果・既存 spec) が欠落・破損 | `plan/research/latest.md` 不在 + researcher subagent も blocker return |
| ユーザー要望に複数解釈があり、どれを採用しても spec が破綻 | 受け入れ基準と非機能要件が背反 |
| FB loop 3 回 (Phase 5 上限) | 修正方針が確定しない |

halt フォーマット:

```markdown
## BLOCKED
- 発火条件: [CLAUDE.md halt プロトコルのどの条件に該当したか]
- 不確実な前提: [仕様確定に必要な情報のうち欠けているもの]
- 人間に判断してほしいこと: [選択肢を 2〜3 個提示]
- 違反しないと進めない規約: [CLAUDE.md / 本 SKILL.md のどの条文か]
```

halt 時は受け入れ基準・スプリント計画を**書かない** (曖昧な spec のまま Generator が起動するのを防ぐ)。

## 注意事項

- **技術選定は行わない**: 「React で実装」「SQLite を使用」などの技術指定は書かない・Generator が最適技術を選択
- **DB スキーマは書かない**: テーブル設計・カラム定義は Generator 責務
- **API 設計は書かない**: エンドポイント定義・リクエスト/レスポンス形式は Generator 責務
- **機能の「振る舞い」を書く**: 「ユーザーがボタンをクリックすると一覧がフィルタリングされる」のようにユーザー視点で記述
- 各スプリントには明確な受け入れ基準を設定し Evaluator がテスト可能な形にする
- Pre-Planning 結果 (researcher) は参考情報であり決定ではない・最終判断は orchestrator (= 本 Skill を演じる側) が行う

## 完了報告

承認が出たら以下を簡潔に報告:

- 総機能数
- 総スプリント数
- 最も重要な設計判断
- スコープ外にした事項とその理由
- 次の起動コマンド案内: `/pge-runtime-survey` (config 未生成時) → `/pge-sprint-cycle`
