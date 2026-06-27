# Playwright Fixture Fragment Template (catalog 専用・Phase Z3+)

このファイルは `/pge-sprint-cycle` workflow が SUT 配下に generate する **PGE fixture fragment** (`.pge-fixtures.ts`) の **template + 注入規約** catalog (絶対ルール 11)。behavioral rule は `.claude/workflows/pge-sprint-cycle.js` の `Test-Fixture-Setup` phase prompt および `evaluator-per-ac.md` 本文を一次資料とし、本ファイルは literal 引用元としてのみ使用する。

## 1. 目的

E2E test 実行時に発生する **PJ-level 共通の dev 環境ノイズ** (favicon 404 / HMR warning / vite warning / analytics 失敗 等) を **artifact (spec.ts) 側ではなく fixture 層**で一括 mute する。これにより:

- artifact_framework template が noise filter を毎回 inline せずに済む (artifact が薄くなる + LLM が noise 設定を発明する余地ゼロ)
- noise pattern は `plan/pge-runtime-config.json` の `test_runner.noise_filter` で **declarative 管理** + orchestrator が機械置換で fragment に注入
- PJ owner 既存の `playwright.config.ts` を **破壊しない** (fragment は別 file・既存 config が import する形)
- Step 9 self-execution / Step 10 retry の `stderr_excerpt` ノイズ混入が消え、LLM の失敗診断品質が向上

## 2. 生成先パス (固定)

| 出力 | パス (SUT root 相対) | 書き込み権限 |
|---|---|---|
| PGE fixture fragment | `.pge-fixtures.ts` | orchestrator (`/pge-sprint-cycle` workflow) のみ |

per-iteration ではなく **sprint initial run のみ 1 回 generate** (runtime_config の `noise_filter` 値が sprint 中に変化しないため・変化したら orchestrator が再生成)。

## 3. Template (generic placeholder 形式)

```ts
// .pge-fixtures.ts
// PGE が runtime_config.test_runner.noise_filter から生成する fixture fragment。
// PJ owner が手動編集すると orchestrator の次回 sprint で上書きされる。
// PJ の playwright.config.ts はこの fixture を import する規約に従う。

import { test as base, expect, type Page } from '@playwright/test';

const NOISE_NETWORK_PATTERNS: (string | RegExp)[] = [/* injected from runtime_config.test_runner.noise_filter.network_abort */];
const NOISE_CONSOLE_PATTERN: RegExp | null = /* injected from runtime_config.test_runner.noise_filter.console_suppress_pattern (null if empty) */;

export const test = base.extend<{ pgeFixtures: void }>({
  pgeFixtures: [
    async ({ page }, use) => {
      // network noise を fixture 層で abort
      for (const pattern of NOISE_NETWORK_PATTERNS) {
        await page.route(pattern, (route) => route.abort());
      }

      // console noise を fixture 層で suppress (page-level listener として記録するが
      // suppressed pattern に該当する message は artifact 内 assertion に到達しない)
      if (NOISE_CONSOLE_PATTERN) {
        page.on('console', (msg) => {
          if (NOISE_CONSOLE_PATTERN.test(msg.text())) {
            return;  // 完全に無視
          }
        });
      }

      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
```

### 注入規約 (orchestrator 側)

`/pge-sprint-cycle` workflow が `runtime_config.test_runner.noise_filter` を Read して以下のように literal 置換:

| placeholder | 注入内容 |
|---|---|
| `NOISE_NETWORK_PATTERNS` の右辺 | `noise_filter.network_abort[]` を TS array literal に展開 (各 entry は `'<pattern>'` の文字列、または `/<regex>/` の RegExp literal として出力) |
| `NOISE_CONSOLE_PATTERN` の右辺 | `noise_filter.console_suppress_pattern` が非空なら `/<pattern>/`、空文字なら `null` |

LLM 推論で置換しない (workflow JS の deterministic string replace で完結)。

## 4. PJ-level `playwright.config.ts` の規約

PJ owner が管理する `<SUT root>/playwright.config.ts` は以下を満たす必要がある (`sut-precheck` が機械検証する):

1. **`use:` block 内に `trace: 'on-first-retry'` を含む** (Step 10 retry で trace bundle を LLM input 化するための必須設定)
2. **`use:` block 内に `screenshot: 'only-on-failure'` を含む** (失敗診断補助)
3. (PJ 任意) `.pge-fixtures.ts` を test file 側で import する形を許容する設定 (`testMatch` 等が `e2e/` 配下を拾うこと)

PJ owner はこの 3 条件を満たしていれば fixture 統合は自動。条件不一致は `sut-precheck` が halt させる (Phase Z3+ 追加 check)。

## 5. artifact 側 (spec.ts) の import 規約

`evaluator-per-ac` が生成する `e2e/sprint-N/AC-K.spec.ts` は冒頭で以下を import 必須:

```ts
import { test, expect } from '<SUT root への相対パス>/.pge-fixtures';
```

import path は SUT root からの artifact 配置位置に応じた相対パス (例: `e2e/sprint-N/` から SUT root は `../..` → `'../../.pge-fixtures'`)。

artifact 内の `test()` block では `pgeFixtures` の auto:true により noise filter が自動適用される (test 個別 setup 不要)。

## 6. 制約事項

- fragment template に **PJ 固有 noise pattern を hardcode しない** (favicon / HMR / vite 等の universal pattern も `noise_filter` の declared field 経由で渡す・template 自体は値 free に保つ)
- fragment の TypeScript syntax は **Playwright 公式 `test.extend` API に従う** (独自 API 拡張禁止)
- orchestrator は per-sprint で 1 回 generate (per-iteration / per-AC で再生成しない・runtime_config 不変なら fragment 不変)
- fragment は **PJ owner が手で編集してはならない** (次回 sprint で上書きされる旨を fragment 先頭 comment で明示)

## 7. 関連ファイル

- `.claude/references/pge-runtime-config-spec.md` `test_runner.noise_filter` schema
- `.claude/skills/pge-runtime-survey/SKILL.md` noise_filter declare 経路 (PJ owner との対話)
- `.claude/scripts/sut-precheck/check-test-runner-deps.sh` PJ playwright.config.ts 規約検査
- `.claude/agents/evaluator-per-ac.md` artifact import 規約
- `.claude/references/evaluator-test-capabilities.md` `F-playwright-ts` template (fixture import を template に組み込む側)
- `.claude/workflows/pge-sprint-cycle.js` `Test-Fixture-Setup` phase (fragment 生成側)
