# Evaluator: e2e/sprint-final.spec.ts 生成詳細

⚠️ **Phase D 以降、生成主体は [`evaluator-aggregator.md`](../evaluator-aggregator.md) に移管済み**。本ファイルの規約 (単一ファイル制約・命名規約・保存先分離・implementation pattern) は依然有効だが、書き手は legacy Evaluator ではなく aggregator である。per-AC Evaluator は `e2e/sprint-N/AC-K.spec.ts` を生成するのみで `e2e/sprint-final.spec.ts` には書き込まない。詳細な結合アルゴリズムは [`evaluator-aggregator-output-spec.md`](evaluator-aggregator-output-spec.md) 「`e2e/sprint-final.spec.ts` 結合規約」を参照。

本ファイルは **final モード + 集約 `verdict == "pass"` 時のみ**適用される spec.ts 生成規約。

## 生成条件（必須・順に判定する）

1. **必須スキップ**: `mode == "intermediate"` の場合は生成しない。**例外なし**。
2. **必須スキップ**: `verdict == "fail"` の場合は生成しない（修正後の再評価で合格してから書く）。
3. **生成する**: `mode == "final"` かつ `verdict == "pass"` の場合のみ — `e2e/sprint-final.spec.ts` を**単一ファイル**で生成し、**spec.md の全 AC** を `test('TC-AC-N: ...')` 形式で並べる。

## intermediate モードでの扱い

中間スプリントでは spec.ts を生成しないため、JSON の `tests_run` は次のとおり扱う：

- 単体/統合テスト（unit test runner・`<unit test command>` のような form）の実行ログを `tests_run` に列挙する
- curl 検証ログ・MCP 対話検証ログを列挙する (Phase X2 以降、`evidence/_work/` は廃止。screenshot は Test Runner 経由で `<SUT root>/evidence/<test>/` に配置される・Phase X3)
- `tests_run` 自体は空配列にしない (intermediate でもテスト実行ログを残す規約・空配列は不合格扱い)

## ファイル単一性（最重要）

- **ファイル名は `e2e/sprint-final.spec.ts` 単一**。`-eval`、`-ac2`、`-retry`、`sprint-N.spec.ts`（N は数字）等のサフィックス・別名ファイル化を**禁止**。
- **過去の中間スプリントで spec.ts を生成しないため、`e2e/sprint-final.spec.ts` が唯一の e2e スクリプト**となる。
- **AC 単位で `test()` を並べる** — `test('TC-AC-1: <AC-1 概要>', ...)`、`test('TC-AC-2: <AC-2 概要>', ...)` のように **spec.md の全 AC を網羅**する。
- **追加テスト（リトライ・エッジケース）は同一ファイル内に `test('TC-AC-N-retry: ...')` を追記する**（後述「リトライ運用」を参照）。
- 過去に `e2e/sprint-N.spec.ts`（N は数字）といった旧フォーマットの成果物が残っていても**新規には作成しない**。

## 実装ルール

- **final モードかつ合格時のみ生成する** — 不合格の場合はスクリプトを生成しない
- **インタラクティブ操作を忠実にスクリプト化する** — Playwright MCP で実際に行った操作と検証をそのまま `@playwright/test` 形式に変換する
- **`baseURL` は使わず絶対 URL で書く** — per-AC が `available_capabilities.json` / `route_map.json` から取得した `${APP_BASE_URL}` (host + port literal) を artifact 内で直接 template literal として展開する
- **各アクションでキャプチャを保存する** — クリック・入力・遷移・送信・モーダル操作など、ユーザー操作 1 つごとに `page.screenshot()` を実行して保存する
- **実行順が分かる連番プレフィックスで保存する** — `001_` のように 3 桁ゼロ埋めの連番をファイル名の先頭に付け、時系列に確認できるようにする

## 保存先の規約 (Phase X3)

エビデンスは Test Runner が自動収集する **`<SUT root>/evidence/<test>/` ディレクトリ**を使う。aggregator は mv / cp / mkdir を行わず、`evidence/` をそのまま (SUT root 相対で) `evidence.attachments_dir` に書く。

| 保存先                                  | 用途                                                       | 出力主体                                |
| --------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `<SUT root>/evidence/<test>/`           | Test Runner 1 回ごとの自動収集 dir (screenshot/trace/video) | Test Runner が自動生成 (Phase X3)       |
| `<SUT root>/evidence/html/index.html`   | Test Runner HTML reporter (trace/video 含む一次資料)        | Test Runner が自動生成 (Phase X3)       |
| `<SUT root>/evidence/results.json`      | Test Runner JSON reporter                                    | Test Runner が自動生成 (Phase X3)       |

- **spec.ts 内で `evidence/by-ac/...` / `evidence/_work/...` / `e2e/artifacts/...` / `test-results/...` を参照することは禁止** (Phase X2/X3 で全て廃止)
- spec.ts は **`testInfo.outputPath(...)` 経由**で screenshot を書く (Playwright 標準 API・Test Runner の `outputDir` (Phase X3: `<SUT root>/evidence/`) 配下に自動配置される)
- spec.ts のヘルパー関数例:

```typescript
test('TC-AC-1-S1: ...', async ({ page }, testInfo) => {
  let stepNo = 0;
  const shot = async (label: string) => {
    stepNo++;
    const num = String(stepNo).padStart(3, '0');
    await page.screenshot({
      path: testInfo.outputPath(`${num}_${label}.png`),
      fullPage: false,
    });
  };
  // ...
});
```

- `package.json` と `playwright.config.ts` が存在しない場合は SUT root 直下に作成する。`playwright.config.ts` の `outputDir` は `./evidence` を指し、reporter は `html: {outputFolder: './evidence/html'}` + `json: {outputFile: './evidence/results.json'}` を設定する (Phase X3 規約)。

## キャプチャ命名

- **形式**: `testInfo.outputPath('001_<short_label>.png')` (Test Runner が `<SUT root>/evidence/<test>/001_<short_label>.png` に配置・Phase X3)
- **short_label** は英小文字・数字・ハイフン中心で短く（空白は使わない）
- 固定パス定数 (`const ARTIFACTS_DIR = '...'` 等) を使わない (Phase X2 で deprecated)

## 実装パターン

- 連番はテスト内で `let stepNo = 0;` を持ち、`const shot = async (label: string) => { ... }` のようなヘルパーで `stepNo++` と 3 桁ゼロ埋めを行う
- `test.step()` で「操作 → キャプチャ」を 1 まとまりにし、失敗時にログとキャプチャが対応するようにする
- **原則**: 「操作の直後」に撮る（必要なら重要な `expect` の直後にも追加で撮る）

## スクリプトの構造 (Phase X2 規約)

```typescript
import { test as base, expect } from '@playwright/test';

// Phase Y: negative observation fixture (per-AC と同じ規約で auto 注入)
const test = base.extend<{ negativeObservation: void }>({
  negativeObservation: [async ({ page }, use) => {
    // (fixture 本体・詳細は evaluator-spec-ts-template.md 参照)
    await use();
  }, { auto: true }],
});

test.describe('Final: 全 AC 網羅', () => {
  test('TC-AC-1-S1: [AC-1 の説明]', async ({ page }, testInfo) => {
    let stepNo = 0;
    const shot = async (label: string) => {
      stepNo++;
      const num = String(stepNo).padStart(3, '0');
      await page.screenshot({
        path: testInfo.outputPath(`${num}_${label}.png`),
        fullPage: false,
      });
    };
    // per-AC subagent が e2e/sprint-N/AC-1.spec.ts に書いた本体をここに移植
  });
  test('TC-AC-1-S2: [AC-1 S2 の説明]', async ({ page }, testInfo) => {
    // 同上 (testInfo を引数で受け取る)
  });
  test('TC-AC-2-S1: [AC-2 の説明]', async ({ page }, testInfo) => {
    // ...
  });
});
```

**重要**: test 名は per-AC spec.ts と 1:1 で揃える (`TC-AC-K-S1` / `TC-AC-K-S2`)。suffix 省略 (`TC-AC-1` 単独) や複数 scenario の merge は **禁止** (auditor mode の検査対象・H1)。

## リトライ運用（同一ファイル内追記の徹底）

検証中に「最初のシナリオでは AC を満たせなかったが、別アプローチで満たせた」ケース（典型例: HTML `maxlength` 属性によるブラウザ層の制限を JS で除去してサーバ層を確認）の対処：

- **別ファイル化禁止**: `sprint-final-ac2.spec.ts` のような派生ファイルを作らない。
- **同一 `e2e/sprint-final.spec.ts` 内に `test('TC-AC-K-Sn-retry: ...')` を追記**: テスト名サフィックス `-retry` または `-bypass-<attr>` で意図を明示する。
- **エビデンスの連番**: リトライ用の screenshot は **`testInfo.outputPath()` 経由で test 内連番を継続** (Test Runner が `<SUT root>/evidence/<test>/` 配下に自動配置・Phase X3)。固定パスへの直接書き込み禁止。

## 回帰テストとしての利用

final 評価実施時または再実行時に、`e2e/sprint-final.spec.ts` を実行して全 AC の回帰を確認する：

```bash
npx playwright test e2e/sprint-final.spec.ts  # 全 AC 網羅の回帰確認
```
