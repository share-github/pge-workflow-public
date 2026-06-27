---
description: PGE Discovery を orchestrator inline で実行する skill。`plan/research/latest.md` を起点に discoverer subagent を 1 回起動して `plan/domain.json` (entities + endpoints + named_states + planned_changes) を生成し、AskUserQuestion で named_state / planned_change の scope と halt risk を人間に提示する。pge-planning の Planner (sprint.json author) の直前に挟まる事前ステップ。
disable-model-invocation: true
argument-hint: "<userRequest> (任意・pge-planning と同形式・引数なしで既存 domain.json の review modus 起動)"
---

# /pge-discovery — domain.json (SUT facts) 生成 Skill

PGE の Researcher と Planner の間に挟まる事前 discovery を orchestrator inline で実行する。schema 一次資料は `.claude/references/pge-spec-schema.md` の domain.json section。

## 設計の核心 (= 既存 PGE への増設理由)

複雑な業務系 SUT では Generator ↔ Evaluator loop が「実装バグ」ではなく **「前提 data / 業務状態 / fixture 不足」** で halt し、また Planner が SUT の実 schema / endpoint を想像で書くと Generator が halt する。本 Skill は spec drafting の前段で:

1. SUT の facts (実在 entity / endpoint / business state / 本 sprint の planned change) を evidence 付きで `plan/domain.json` に集積
2. Planner が test plan (sprint.json) を grounding して author できる素材を提供
3. **named_state の不足 / halt risk を spec 承認前に人間に提示** (= sprint 中盤の halt を構造的に前倒し検出)

Discovery の本体 (SUT grep + 構造化) は discoverer subagent で 1-shot 消費・Skill body は subagent 結果を AskUserQuestion で人間にかけて completeness を確定する。

## 入出力

- **入力 (引数あり)**: `<userRequest>` — pge-planning と同形式・新規 discovery モード
- **入力 (引数なし)**: 既存 `plan/domain.json` を読み込み review モード起動
- **入力 (必須)**: `plan/research/latest.md` (researcher 完了が必須・不在なら halt)
- **出力**: `plan/domain.json`

## 絶対ルール (本 Skill 実行時)

1. **discoverer は subagent で 1-shot 消費**・本 Skill body 内で再呼び出ししない
2. **domain.json の評価 / 差分修正は orchestrator が直接行う** (warm cache 維持)
3. **3 回連続で同一論点 FB が来たら halt**
4. **Discovery 結果なしで Planner (sprint.json author) に進ませない**

## ワークフロー

### Phase 1: 状態判定

1. `plan/research/latest.md` 存在確認 (不在 → halt `discovery-requires-research-latest`)
2. `plan/domain.json` の存在確認
3. 引数 `<userRequest>` の有無確認

| domain.json | userRequest | 動作 |
|---|---|---|
| 不在 | あり | 新規生成モード (Phase 2 → 3 → 4) |
| 不在 | なし | halt: `requires-userrequest-for-new-discovery` |
| 存在 | あり | 拡張 / 上書き判定モード (Phase 3 から) |
| 存在 | なし | review モード (Phase 3 から) |

### Phase 2: discoverer subagent 起動 (新規生成モードのみ)

```
Agent({
  subagent_type: "discoverer",
  description: "PGE Discovery — SUT facts extraction",
  prompt: `pge-discovery Skill から Discovery として起動。

monitor_dir: plan/monitor/discoverer-cycle1/
timestamp_iso: <orchestrator 算出の ISO 8601 文字列を literal で渡す>

userRequest:
<userRequest をそのまま literal で>

sprint_hint: <確定済 sprint 番号があれば echo・未確定なら null>

agent 定義 (.claude/agents/discoverer.md) の通り実行:
- plan/research/latest.md を起点に SUT を Grep し plan/domain.json を生成
- entities / endpoints / named_states / planned_changes を evidence 付きで
- named_states.setup.steps に test action を混入しない (state setup のみ)
- evidence 0 件で confidence: high を付けない

完了時 return: {entities_count, endpoints_count, named_states_count, planned_changes_count, unknowns_count, blocker?}`
})
```

返り値を Phase 3 の AskUserQuestion preview に使う。`blocker` があれば halt して人間に提示。

### Phase 3: 人間レビュー + FB loop (AskUserQuestion・本 Skill の中核)

orchestrator が `plan/domain.json` を Read し以下を整理:

1. **scope=required の named_state** (sprint test が直接依存する)
2. **scope=out-of-scope の named_state** (今 sprint 対象外・理由付き)
3. **unknowns[]** (人間判断を仰ぐべき不明点)
4. **named_state.setup.kind == "unavailable"** な state (Generator が factory を新規実装)
5. **named_state.scope == "required" + setup.missing_components 非空** (Generator deliverable 候補)
6. **planned_changes[].source == "planner_decision"** (research / scenario に根拠がない独自判断・要確認)

AskUserQuestion で承認を求める:

```
question: "Discovery 完了 (entities={E} / endpoints={N} / named_states={S} / planned_changes={P} / unknowns={U})。domain.json を承認しますか?"
options:
  - label: "承認"
    description: "/pge-planning に戻り Planner が sprint.json を author する"
  - label: "named_state 追加 / 修正"
    description: "不足 state / scope 修正を口頭で示し orchestrator が domain.json を Edit で差分修正"
  - label: "planned_change 修正"
    description: "新規 schema / endpoint / behavior の declaration を口頭で示し orchestrator が Edit"
  - label: "halt"
    description: "本 Skill を中断 (domain.json は現状で残す)"
```

| 選択 | 動作 |
|---|---|
| 承認 | 完了報告 + 「次に `/pge-planning` に戻り Planner が sprint.json を author してください」と案内して終了 |
| named_state 追加 / 修正 | orchestrator が `plan/domain.json` を `Edit` で差分修正 (全置換禁止) → Phase 3 loop |
| planned_change 修正 | orchestrator が `plan/domain.json` を `Edit` で差分修正 → Phase 3 loop |
| halt | domain.json は現状を維持・本 Skill 終了 |

### Phase 4: FB loop 規約

- **`Write` 全置換禁止**・`Edit` のみで該当 entry を差し替える
- 差し戻し範囲を超えた整形をしない
- **FB loop 上限**: 同一論点 3 回連続で halt (`blocker.reason: "discovery-fb-loop-not-converging"`)
- domain.json 修正と並行して sprint.json を書く手伝いはしない (Planner 責務)

### Phase 5: halt 判断

CLAUDE.md halt プロトコル準拠。該当時は `plan/domain.json` root に `blocker` field を追加して停止:

| halt 条件 | 例 |
|---|---|
| `plan/research/latest.md` 不在 | researcher 未起動 / latest.md 削除 |
| discoverer が `blocker` 付き return | target-files-undetermined / evidence-grounding-failed 等 |
| 引数なしモードで既存 domain.json も不在 | userRequest 欠落 |
| FB loop 3 回 | 修正方針が確定しない |
| named_state 30 件超で discoverer が `discovery-scope-too-broad` | sprint scope が広すぎ・分割が必要 |

halt 時は通常 entry を書かない。

## /pge-planning との接続

本 Skill 完了後、orchestrator は `/pge-planning` の Planner (sprint.json author) に進む。Planner は:

1. `plan/domain.json#named_states[]` の scope=required な state を test_case.state の参照先として使う
2. `plan/domain.json#entities / endpoints / planned_changes` を grounding source として sprint.json#test_cases を author
3. test_case の trigger.path / db_after.table / row の col / input field / html message が domain.json に grounded であることを Phase 3.5 grounding gate で機械検証

詳細は `/pge-planning` SKILL.md Phase 2.5 / 3.5 を参照。

## 注意事項

- **技術選定 / 仕様決定は行わない**: Discovery は SUT facts の集積のみ
- **scope の最終判断は Planner**: scope=required は userRequest 近接性で暫定決定・Planner が test plan で確定
- **既存 domain.json の reuse 優先**: source 一致なら Read 確認のみ
- **domain.json は PJ artifact**: SUT 固有名詞 OK (entity / endpoint / column 名は literal)・agnostic-auditor の対象外

## 完了報告

承認が出たら簡潔に報告:

- entities / endpoints 件数
- named_state 数 (scope 別 + setup.kind=="unavailable" 件数)
- Generator が新規実装すべき factory 数 (= missing_components 非空の required state 数)
- planned_changes 件数 (うち source=="planner_decision" 件数)
- 未解決 unknowns 数
- 次の起動: `/pge-planning` に戻り Planner が sprint.json を author
