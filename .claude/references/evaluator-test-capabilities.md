# Evaluator Test Capability Catalog (Phase Z2)

evaluator per-ac mode が test artifact を生成する際の **literal 引用元 catalog**。

## 設計原則 (Phase Z2)

- **capability primitives (trigger + observation) を composition する** — category dispatch ではない
- **AC category tag (`[UI]`/`[CLI]`/`[API]`/...) は hint** であり source ではない。LLM は spec.md AC literal + investigator phase 2 から capability を導出する
- **catalog 専用** (絶対ルール 11)。behavioral rule (artifact 形式) は `evaluator.md` 本文を一次資料とし、本ファイルは literal 引用元としてのみ使用する
- **新規 capability 追加時は本 catalog に section を追加するだけ** — evaluator.md / orchestrator にコード変更を要しない
- **本 catalog の literal 例は generic placeholder で書く** — project 固有 URL / 固有 entity 名 / 固有 field 名は登場させない (Phase Z3: agnostic-auditor で検出される)。具体値は per-AC が `available_capabilities.json` + `route_map.json` + `aria_snapshot.yaml` から literal 取得する

---

## 1. Trigger Capabilities (test 発動側)

LLM は AC 文の動詞・operation 表現から trigger capability を選ぶ。「ユーザーが…する」「システムが…を起動する」「バッチが…を実行する」等の literal から導出する。

### T-browser-navigate

**用途**: UI ブラウザでの navigation + 入力 + click 等 interaction。

**literal 例 (Playwright TypeScript・generic placeholder)**:
```typescript
await page.goto(`${APP_BASE_URL}/<route from route_map.json>`);
await page.getByRole('textbox', { name: '<form field label from aria_snapshot.yaml>' }).fill(`${PREFIX}-<entity>`);
await page.getByRole('button', { name: '<submit button label from aria_snapshot.yaml>' }).click();
```

`APP_BASE_URL` は per-AC が `available_capabilities.json` / `route_map.json` から取得する base URL。`<form field label>` / `<submit button label>` は `phase1/<screen>/aria_snapshot.yaml` の literal を引用する (発明禁止)。

**SUT 前提**: HTTP UI (HTML form / SPA) が動作している。`investigator phase 2 available_capabilities.json#trigger` に `T-browser-navigate: available=true` で declared。

---

### T-http-request-playwright

**用途**: REST API endpoint への HTTP リクエスト (Playwright request mode)。

**literal 例 (generic placeholder)**:
```typescript
const response = await request.post(`${APP_BASE_URL}/<api route from route_map.json>`, {
  data: { <field1>: `${PREFIX}-<entity>`, <field2>: '<sample value>' },
});
```

field 名と value は per-AC が `api_contract_map.json` の request body schema から literal 引用する。

**SUT 前提**: REST endpoint (controller_action_map.json に該当 action あり)。Playwright が既に setup 済。

---

### T-http-request-curl

**用途**: REST API endpoint への HTTP リクエスト (curl 経由・bash)。

**literal 例 (bash・generic placeholder)**:
```bash
status=$(curl -s -o "/tmp/${PREFIX}-response.json" -w '%{http_code}' \
  -X POST "${APP_BASE_URL}/<api route from route_map.json>" \
  -H "Content-Type: application/json" \
  -d "{\"<field1>\":\"${PREFIX}-<entity>\",\"<field2>\":\"<sample value>\"}")
```

**SUT 前提**: REST endpoint + curl 利用可能 (universal)。Playwright を使わない CLI/Batch 系 AC で API 経由 trigger をしたい場合に選ぶ。

---

### T-shell-command

**用途**: CLI tool / executable / shell script の起動 (引数つき)。

**literal 例 (bash・generic placeholder)**:
```bash
output=$(timeout 60 "$SUT_ROOT/<bin path from _framework.json>" --input "/tmp/${PREFIX}-input.txt" --output "/tmp/${PREFIX}-output.txt" 2>&1)
exit_code=$?
```

CLI entry point path / 引数は `_framework.json` の `mainClass` / `bin/` / `scripts` 等から literal 引用する。

**SUT 前提**: 実行可能 CLI entry point が存在 (investigator phase 2 で `mainClass` / `bin/` / `scripts` 等を検出)。

---

### T-sql-execution

**用途**: DB に SQL を直接実行 (fixture seeding / migration trigger / 直接 INSERT)。

**literal 例 (bash + psql・generic placeholder)**:
```bash
psql "$DB_URL" -v PREFIX="$PREFIX" -f "/tmp/${PREFIX}-seed.sql"
```

`DB_URL` は per-AC が `_framework.json` の `database.url` / `<datasource URL config key>` 等から取得する接続文字列。

**SUT 前提**: DB 接続情報が available (investigator phase 2 で `_framework.json#persistence` が DB 系を declared)。

---

### T-file-creation

**用途**: file 作成・編集 (file-driven trigger・batch job が watch している directory に置く等)。

**literal 例 (bash・generic placeholder)**:
```bash
printf '%s\n' "<header line>" "${PREFIX}-<entity>,<sample value>" > "/tmp/${PREFIX}-input.csv"
mv "/tmp/${PREFIX}-input.csv" "$SUT_ROOT/<watched directory from _framework.json>/"
```

watched directory path は `_framework.json` または phase 2 artifact から literal 引用する。

**SUT 前提**: watched directory / file-trigger mechanism が SUT に存在。

---

### T-message-publish (拡張・将来用)

**用途**: message queue (RabbitMQ / Kafka / SQS) への message publish。

**literal 例**: 省略 (SUT が AMQP / Kafka 等の available_capability を declared した時に詳述追記)。

---

## 2. Observation Capabilities (test 検証側)

LLM は AC の「期待される behavior」「成功条件」literal から observation capability を選ぶ。

### O-dom-content

**用途**: UI element の text / attribute 検証。

**literal 例 (Playwright・generic placeholder)**:
```typescript
await expect(page.getByRole('row', { name: PREFIX })).toBeVisible();
await expect(page.getByRole('cell', { name: '<expected cell text from spec.md>' })).toBeVisible();
```

assertion text は per-AC が spec.md AC literal または investigator artifact から literal 引用する (発明禁止)。

---

### O-dom-locator-visible

**用途**: UI element の visibility / disabled 状態検証。

**literal 例 (Playwright・generic placeholder)**:
```typescript
await expect(page.getByRole('button', { name: '<button label from aria_snapshot.yaml>' })).toBeEnabled();
await expect(page.locator('<css selector from locator_catalog.json>')).not.toBeVisible();
```

---

### O-aria-tree

**用途**: ページの ARIA tree snapshot 検証 (構造的検証)。

**literal 例 (Playwright・generic placeholder)**:
```typescript
const snapshot = await page.locator('body').ariaSnapshot();
expect(snapshot).toContain(`- row "${PREFIX}-<entity>"`);
```

---

### O-http-status

**用途**: HTTP response の status code 検証。

**literal 例 (Playwright)**:
```typescript
expect(response.status()).toBe(<expected status from api_contract_map.json>);
```

**literal 例 (bash + curl)**:
```bash
[ "$status" -eq <expected status> ] || { echo "FAIL: expected <expected status> got $status"; exit 1; }
```

---

### O-http-response-shape

**用途**: HTTP response body の JSON 構造 / 値検証。

**literal 例 (Playwright・generic placeholder)**:
```typescript
const body = await response.json();
expect(body).toMatchObject({ <field>: `${PREFIX}-<entity>` });
```

**literal 例 (bash + jq・generic placeholder)**:
```bash
jq -e ".<field> == \"${PREFIX}-<entity>\"" "/tmp/${PREFIX}-response.json" > /dev/null || { echo "FAIL: <field> mismatch"; exit 1; }
```

---

### O-exit-code

**用途**: shell command の exit code 検証。

**literal 例 (bash)**:
```bash
[ "$exit_code" -eq 0 ] || { echo "FAIL: TC-AC-K-S1: expected exit 0 got $exit_code"; exit 1; }
```

---

### O-stdout-pattern

**用途**: shell command の stdout 内容検証 (literal pattern 包含)。

**literal 例 (bash・generic placeholder)**:
```bash
echo "$output" | grep -qF "${PREFIX}-<entity>" || { echo "FAIL: stdout missing PREFIX"; exit 1; }
```

---

### O-stderr-pattern

**用途**: shell command の stderr 内容検証 (error message pattern 包含)。

**literal 例 (bash・generic placeholder)**:
```bash
echo "$stderr" | grep -qE "<expected error message pattern from spec.md>" || { echo "FAIL: expected error message missing"; exit 1; }
```

---

### O-sql-row-presence

**用途**: DB に特定 row が存在することを検証。

**literal 例 (bash + psql・generic placeholder)**:
```bash
count=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM <table> WHERE <pk or scoped column> LIKE '${PREFIX}%';" | tr -d ' ')
[ "$count" -ge 1 ] || { echo "FAIL: expected row missing for PREFIX=$PREFIX"; exit 1; }
```

table 名と column 名は per-AC が `_framework.json#persistence` / migration file 等から literal 引用する。

---

### O-sql-column-value

**用途**: DB 特定 row の column 値を検証。

**literal 例 (bash + psql・generic placeholder)**:
```bash
actual=$(psql "$DB_URL" -t -c "SELECT <field> FROM <table> WHERE <scoped column> = '${PREFIX}-<entity>';" | tr -d ' ')
[ "$actual" = "<expected value>" ] || { echo "FAIL: <field> mismatch: got $actual"; exit 1; }
```

---

### O-log-line-pattern

**用途**: log file 内に特定 pattern の行が出現することを検証。

**literal 例 (bash・generic placeholder)**:
```bash
grep -qE "<expected log marker>: ${PREFIX}" "$SUT_ROOT/<log path from _framework.json>" || { echo "FAIL: completion log missing"; exit 1; }
```

log file path は `_framework.json#logging` から literal 引用する。

---

### O-file-existence

**用途**: file の existence + content 検証。

**literal 例 (bash・generic placeholder)**:
```bash
[ -f "/tmp/${PREFIX}-output.txt" ] || { echo "FAIL: output file missing"; exit 1; }
grep -qF "<expected line from spec.md>" "/tmp/${PREFIX}-output.txt" || { echo "FAIL: file content mismatch"; exit 1; }
```

---

### O-file-content

**用途**: file content の特定値検証 (line count / diff / pattern)。

**literal 例 (bash)**:
```bash
line_count=$(wc -l < "/tmp/${PREFIX}-output.csv")
[ "$line_count" -ge 1 ] || { echo "FAIL: empty output"; exit 1; }
```

---

## 3. Artifact Framework Decision (機械的導出表)

evaluator per-ac は `design.trigger_capabilities[]` + `design.observation_capabilities[]` の組み合わせから **artifact_framework** を以下の表で機械的に決定する。LLM 推論ではなく **decision logic**:

```
使用 capability に Playwright 系 (T-browser-navigate / T-http-request-playwright /
                                 O-dom-* / O-aria-tree / Playwright の O-http-*) が
1 件でも含まれる
   → artifact_framework = "F-playwright-ts"

使用 capability に Playwright 系が含まれず・bash 系 capability のみ
   → artifact_framework = "F-bash-script"

使用 capability に T-sql-execution が含まれ・Playwright 系も含む
   → artifact_framework = "F-playwright-ts" (内部で psql を child_process / spawn で呼ぶ)

使用 capability に T-sql-execution が含まれ・Playwright 系が含まれない
   → artifact_framework = "F-bash-script" (内部で psql を直接呼ぶ)
```

---

## 4. Artifact Framework Templates

### F-playwright-ts (Playwright TypeScript test)

**出力ファイル**: `e2e/sprint-N/AC-K.spec.ts`

**runner_command**: `cd <SUT root> && npx playwright test e2e/sprint-N/AC-K.spec.ts --reporter=json --output evidence/acK/test-results` (acK = AC-K を lowercase+ハイフン除去。例: AC-3 → ac3)

**構造テンプレ**:

```typescript
import { test as base, expect, request } from '@playwright/test';

// Universal Invariant I1: per-AC PREFIX (cross-AC isolation)
const PREFIX = `e2e-ac-K-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Universal Invariant I3: design.expected_failures[] literal 引用 (発明禁止)
const expectedFailures: { urlPattern: RegExp; status: number }[] = [
  // 例: { urlPattern: /favicon\.ico$/, status: 404 },
];

// negative observation fixture (silent failure 検出)
const test = base.extend<{ negativeObservation: void }>({
  negativeObservation: [async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const networkFailures: { url: string; status: number }[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });
    page.on('response', res => {
      const status = res.status();
      if (status >= 400) {
        const url = res.url();
        const isExpected = expectedFailures.some(
          ef => ef.urlPattern.test(url) && ef.status === status
        );
        if (!isExpected) networkFailures.push({ url, status });
      }
    });

    await use();

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(networkFailures, `unexpected 4xx/5xx: ${networkFailures.map(f => `${f.status} ${f.url}`).join(' | ')}`).toEqual([]);
  }, { auto: true }],
});

// Universal Invariant I2: design.scenarios[].tc_id 各々を独立 test() ブロックとして 1:1 実装
test('TC-AC-K-S1: <design.scenarios[0].title 引用>', async ({ page }, testInfo) => {
  let stepNo = 0;
  const shot = async (label: string) => {  // ⚠️ arrow function 必須 (D-1 規約)
    stepNo++;
    const num = String(stepNo).padStart(3, '0');
    await page.screenshot({
      path: testInfo.outputPath(`${num}_${label}.png`),
      fullPage: false,
    });
  };

  // ac_operations[] の各 step に対応する Playwright 操作 + await shot(label) を順に配置
  // 使用 capability に応じて T-browser-navigate / T-http-request-playwright / O-dom-content 等を inline
});

test('TC-AC-K-S2: <negative scenario>', async ({ page }, testInfo) => { /* ... */ });
```

**Playwright 専用規約**:
- `shot()` は **arrow function 形式** (`const shot = async (...) =>`) 必須 (D-1 規約・auditor grep 誤検出回避)
- screenshot 出力は `testInfo.outputPath()` 経由のみ (Phase X2 規約・`e2e/artifacts/` 等への独立書き込み禁止)
- `label` は ASCII 推奨 (`form-loaded` / `after-submit` 等・日本語は cross-platform 問題)・日本語サマリは `ac_operations[].summary` に書く
- shot 呼び出し回数 == `max(ac_operations[].step)` (mechanical check)

---

### F-bash-script (Bash shell script test)

**出力ファイル**: `e2e/sprint-N/AC-K.test.sh`

**runner_command**: `cd <SUT root> && bash e2e/sprint-N/AC-K.test.sh`

**構造テンプレ**:

```bash
#!/usr/bin/env bash
set -e  # fail-fast (assertion 失敗で即時 exit)

# Universal Invariant I1: per-AC PREFIX (cross-AC isolation)
PREFIX="e2e-ac-K-$(date +%s)-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom 2>/dev/null | head -c 6 || echo "rnd$$")"
SUT_ROOT="${SUT_ROOT:-$(pwd)}"

# Universal Invariant I3: design.expected_failures[] literal (発明禁止)
# 例: EXPECTED_FAILURES=("<route from spec.md> <status>" ...)

# Universal Invariant I4: TC-id 別に function を切り分ける
test_TC_AC_K_S1() {  # 関数名は `test_<TC-id を underscore 化>` で統一
  echo "# TC-AC-K-S1: <design.scenarios[0].title 引用>"

  # ac_operations[] の各 step に対応する trigger + observation を順に inline
  # 例: T-shell-command + O-exit-code
  output=$(timeout 60 "$SUT_ROOT/<bin path from _framework.json>" --prefix "$PREFIX" 2>&1)
  exit_code=$?
  [ "$exit_code" -eq 0 ] || { echo "FAIL TC-AC-K-S1: expected exit 0 got $exit_code"; return 1; }

  # 例: O-stdout-pattern
  echo "$output" | grep -qF "$PREFIX" || { echo "FAIL TC-AC-K-S1: stdout missing PREFIX"; return 1; }

  echo "PASS TC-AC-K-S1"
}

test_TC_AC_K_S2() {  # negative scenario
  echo "# TC-AC-K-S2: <design.scenarios[1].title 引用>"
  # ...
}

# Universal Invariant I2: design.scenarios[].tc_id 各々を独立 test_* 関数として 1:1 実装
test_TC_AC_K_S1
test_TC_AC_K_S2

echo "ALL PASS AC-K"
```

**Bash 専用規約**:
- 各 TC-id を **独立 function** (`test_TC_AC_K_Sn`) で実装・TC-id 1:1 対応
- 各 TC-id function の先頭に `# TC-AC-K-Sn:` コメント (mechanical grep 用)
- 失敗時は `echo "FAIL TC-AC-K-Sn: ..."; return 1` で明示・成功時は `echo "PASS TC-AC-K-Sn"`
- 最終 echo `"ALL PASS AC-K"` で全 TC-id 通過を declare
- `set -e` で fail-fast (1 つでも失敗したら以降の TC-id を skip して non-zero exit)

---

### F-sql-with-bash-wrapper (DB-heavy AC・Playwright 系を含まない)

F-bash-script の variant。fixture seeding に `.sql` file を併用する場合の構造:

**出力ファイル**:
- `e2e/sprint-N/AC-K.test.sh` (main runner)
- `e2e/sprint-N/AC-K.seed.sql` (fixture seed)
- `e2e/sprint-N/AC-K.cleanup.sql` (cleanup)

**runner_command**: `cd <SUT root> && bash e2e/sprint-N/AC-K.test.sh`

**`.test.sh` 構造**:
```bash
#!/usr/bin/env bash
set -e
PREFIX="..."
SUT_ROOT="..."
DB_URL="${DB_URL:-<connection string from _framework.json>}"

# fixture seed (T-sql-execution)
envsubst < "e2e/sprint-N/AC-K.seed.sql" | psql "$DB_URL"

# TC-id functions と同じ pattern
test_TC_AC_K_S1() { /* ... */ }

# Cleanup
trap 'envsubst < "e2e/sprint-N/AC-K.cleanup.sql" | psql "$DB_URL"' EXIT

test_TC_AC_K_S1
echo "ALL PASS AC-K"
```

---

## 5. Runner Allowlist (security)

orchestrator Step 5-B-5 は per-AC JSON の `runner_command` を **以下の regex pattern allowlist で filter** してから bash 実行する。LLM が出力した command の injection 防御。

```
^cd [^;&|<>$`]+ && (npx playwright test [^;&|<>$`]+ --reporter=json( --output [^;&|<>$`]+)?|bash [^;&|<>$`]+|psql [^;&|<>$`]+ -f [^;&|<>$`]+)$
```

許可される pattern (3 種):
- `cd <SUT root> && npx playwright test <file> --reporter=json [--output <dir>]` (F-playwright-ts・`--output` は省略可だが Phase Z5 では `evidence/acK/test-results` 必須付与)
- `cd <SUT root> && bash <file>` (F-bash-script / F-sql-with-bash-wrapper)
- `cd <SUT root> && psql <args> -f <file>` (将来用・現状非推奨・bash wrapper 経由を推奨)

**禁止する metacharacter**: `;` `&&` (2 個目以降) `||` `|` `>` `<` `$(...)` `` `...` `` (内部の `&&` は 1 個のみ許可・複合 command 禁止)。

allowlist 違反時は orchestrator が halt: `runner-not-allowlisted: <command>`。

新規 runner 追加時は本 catalog の allowlist regex を拡張 (例: ユニットテスト runner 等を追加するなら artifact_framework に対応する F-* を追加 → allowlist にも 1 行追加)。

---

## 6. Universal Invariants (全 artifact 共通)

evaluator per-ac mode は artifact 生成時に以下を必ず実装する。違反は self-check で検出 → 6 に戻って再生成:

### I1: PREFIX (cross-AC isolation)

artifact の冒頭で `e2e-ac-K-<timestamp>-<random>` 形式の PREFIX literal を必ず宣言。

- F-playwright-ts: `const PREFIX = \`e2e-ac-K-${Date.now()}-${Math.random().toString(36).slice(2, 8)}\`;`
- F-bash-script: `PREFIX="e2e-ac-K-$(date +%s)-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom 2>/dev/null | head -c 6 || echo "rnd$$")"`

**mechanical check**: `grep -qE "e2e-ac-K-" <file>` (全 artifact)・AC_ID が file 名と一致するかも検証 (cross-AC collision 防止)。

### I2: TC-id 1:1 (design.scenarios[].tc_id 各々が artifact 内で identifiable)

`design.scenarios[].tc_id` の各 TC-id (例: `TC-AC-K-S1`, `TC-AC-K-S2`) が artifact 内で **独立した実行単位** として存在する。

- F-playwright-ts: 各 `test('TC-AC-K-Sn:', ...)` block (1:1)
- F-bash-script: 各 `test_TC_AC_K_Sn()` function + `# TC-AC-K-Sn:` comment marker

**mechanical check (artifact_framework 別)**:
- F-playwright-ts: `grep -c "^test('TC-AC-K-" <file>` == `design.scenarios | length`
- F-bash-script: `grep -c "^test_TC_AC_K_" <file>` == `design.scenarios | length` AND `grep -c "^# TC-AC-K-" <file>` >= `design.scenarios | length`

### I3: Failure literal (design.expected_failures[] が artifact に literal で含まれる)

`design.expected_failures[]` の各 entry (urlPattern / status / stderr pattern / exit code 等) が artifact 内で literal に含まれる。発明禁止・水増し禁止 (silent failure 検出の趣旨)。

**mechanical check**:
- F-playwright-ts: spec.ts 内の `expectedFailures[]` 配列が design.expected_failures[] と byte-for-byte 一致 (Y3-5 favicon drift 防止)
- F-bash-script: design.expected_failures[].literal_value が artifact に含まれる (grep -qF check)

### I4: Self-assertion (artifact 内の mechanical assertion)

artifact 末尾 / 各 TC-id block 末尾に **明示的 failure exit** が存在する (silent pass 防止)。

- F-playwright-ts: `expect(...).toBe(...)` 等 Playwright assertion API
- F-bash-script: `|| { echo "FAIL"; exit 1; }` / `return 1` パターン

**mechanical check**:
- F-playwright-ts: `grep -c "expect(" <file>` >= 1 per TC-id
- F-bash-script: `grep -c "FAIL TC-AC-" <file>` >= 1 per TC-id

---

## 7. Mechanical Check Templates (artifact_framework 別)

evaluator per-ac self-check は artifact_framework に応じて以下を **Bash で実行** (CWD は project root 前提・絶対 path 不使用):

### F-playwright-ts 用 self-check

```bash
file="e2e/sprint-N/AC-K.spec.ts"
ac_json="plan/feedback/sprint-N/AC-K.json"

# I1 PREFIX
grep -qE "e2e-ac-K-" "$file" || { echo "I1-violation: PREFIX missing"; exit 1; }

# I2 TC-id 1:1
expected_count=$(jq '.design.scenarios | length' "$ac_json")
actual_count=$(grep -c "^test('TC-AC-K-" "$file")
[ "$expected_count" = "$actual_count" ] || { echo "I2-violation: TC-id count mismatch (expected=$expected_count actual=$actual_count)"; exit 1; }

# I3 expected_failures literal
jq -r '.design.expected_failures[]?.urlPattern // empty' "$ac_json" | while read pat; do
  grep -qF "$pat" "$file" || { echo "I3-violation: expected_failure pattern /$pat/ missing"; exit 1; }
done

# I4 self-assertion (expect() per TC-id)
for tc in $(jq -r '.design.scenarios[].tc_id' "$ac_json"); do
  awk "/^test\('$tc:/,/^}\);/" "$file" | grep -q "expect(" || { echo "I4-violation: no expect() in $tc"; exit 1; }
done

# Playwright-specific: shot count
shot_count=$(grep -c "await shot(" "$file")
max_step=$(jq '[.ac_operations[]?.step] | max // 0' "$ac_json")
[ "$shot_count" = "$max_step" ] || { echo "shot-count-mismatch: expected=$max_step actual=$shot_count"; exit 1; }
```

### F-bash-script 用 self-check

```bash
file="e2e/sprint-N/AC-K.test.sh"
ac_json="plan/feedback/sprint-N/AC-K.json"

# I1 PREFIX
grep -qE 'PREFIX="e2e-ac-K-' "$file" || { echo "I1-violation: PREFIX missing"; exit 1; }

# I2 TC-id 1:1 (function declarations)
expected_count=$(jq '.design.scenarios | length' "$ac_json")
fn_count=$(grep -cE "^test_TC_AC_K_S[0-9]+\(\)" "$file")
[ "$expected_count" = "$fn_count" ] || { echo "I2-violation: test_* function count mismatch (expected=$expected_count actual=$fn_count)"; exit 1; }

# I2 TC-id 1:1 (comment markers)
for tc in $(jq -r '.design.scenarios[].tc_id' "$ac_json"); do
  grep -qE "^# $tc:" "$file" || { echo "I2-violation: comment marker for $tc missing"; exit 1; }
done

# I3 expected_failures literal
jq -r '.design.expected_failures[]?.literal_value // empty' "$ac_json" | while read pat; do
  grep -qF "$pat" "$file" || { echo "I3-violation: expected_failure literal '$pat' missing"; exit 1; }
done

# I4 self-assertion (FAIL message per TC-id)
for tc in $(jq -r '.design.scenarios[].tc_id' "$ac_json"); do
  grep -qE "FAIL $tc:" "$file" || { echo "I4-violation: no FAIL exit in $tc"; exit 1; }
done

# Bash-specific: shebang + set -e
head -1 "$file" | grep -q "^#!/.*bash" || { echo "shebang-missing"; exit 1; }
grep -qE "^set -e" "$file" || { echo "set-e-missing"; exit 1; }
```

---

## 8. 禁止事項

- catalog 内で AC category tag (`[UI]`/`[CLI]`/`[API]`/...) を case 文の dispatcher として使わない (capability composition で導出する)
- 新規 capability 追加時に evaluator.md / orchestrator にコード変更を加えない (本 catalog に section 追加だけで済むことが汎用性の証明)
- runner_command allowlist の regex を緩める (`;` / `|` / `&&` 2 個目以降 / `$(...)` 等の metacharacter を許容しない)
- artifact_framework の決定を LLM 推論に委ねる (capability から機械的に導出・decision table 通り)
- Universal Invariants I1-I4 のいずれかを skip する (silent failure 検出の趣旨が消える)
- **catalog の literal 例に project 固有値 (固有 URL / 固有 entity 名 / 固有 field label / 固有 sample value) を書かない (Phase Z3)** — agnostic-auditor が検出する。具体値は per-AC が investigator artifact / spec.md から literal 引用する

## 9. 関連ファイル

- `.claude/agents/evaluator-per-ac.md` 本文 (artifact 生成 Step 0/6/7 の behavioral rule・Phase Z4 で `evaluator.md` から独立)
- `.claude/references/evaluator-per-ac-feedback-schema.md` (per-AC JSON の design.* / test_artifact field schema)
- `.claude/references/evaluator-html-attribute-bypass.md` (form validation bypass の literal catalog)
- `.claude/workflows/pge-sprint-cycle.js` Step 5-B-4 (per-AC が runner_command を Bash で self-execute する経路・Phase Z5+・旧 Step 5-B-5 (orchestrator batch 実行) は廃止) + allowlist filter
- `.claude/agents/investigator.md` phase 2 (`available_capabilities.json` 生成)
