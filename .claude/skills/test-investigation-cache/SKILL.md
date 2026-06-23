---
description: PGE Test-Investigation Cache (Step 4.25) の 2 層 cache (α workspace-local / β SUT-level cross-workspace) の schema 定義・bash one-liner template・troubleshooting catalog。investigator が Phase 2/3 成功時に .cache-key.json を出力する規約と orchestrator が β cache を hydrate/persist する規約を提供。catalog 専用 (behavioral rule は workflows/pge-sprint-cycle.js Step 4.25 inline)。
user-invocable: false
disable-model-invocation: true
---

# Skill: Test-Investigation Cache (Schema + Template Catalog)

PGE Step 4.25 で使う **2 層 cache** (α: workspace-local / β: SUT-level) の literal 引用元 catalog。

**本ファイルは catalog である (絶対ルール 11)**。behavioral rule (cache check / hydrate / persist をいつ・どこで実行するか) は **`pge-sprint-cycle.js` Step 4.25 本文** および investigator agent.md 本文に inline 記載される。本ファイルは schema 定義・bash one-liner・troubleshooting 表のみ提供する。

---

## 1. 2 層 cache の identity / location 表

| Layer | 名前 | 識別子 | 保存場所 | 投影タイミング | invalidation key |
|---|---|---|---|---|---|
| α | workspace-local | workspace (`plan/` 親) | `plan/test-investigation/phase{2,3}/.cache-key.json` | Phase 2/3 成功時 (investigator が `_summary.json` と同時に出力) | fingerprint files の sha256 (`<SUT root>/src/**` + build files + config) |
| β | SUT-level (cross-workspace) | SUT-id (`<SUT root>` absolute path sha256・先頭 16 char) | `.claude/cache/sut-<SUT-id>/phase2-stack/` | Loop 1 initial の Phase 2 成功時のみ (orchestrator が cp) | manifest content hash (`build.gradle.kts` / `pom.xml` / `package.json` 等の sha256) |

---

## 2. JSON schema

### 2-1. α: `plan/test-investigation/phase2/.cache-key.json`

```json
{
  "version": "1",
  "scope": "phase2",
  "computed_at": "ISO 8601 timestamp",
  "sut_root": "absolute path of SUT root",
  "fingerprint_files": [
    {"path": "relative path from SUT root", "sha256": "hex sha256"}
  ],
  "fingerprint_glob_patterns": [
    "<build manifest 例: build.gradle.kts / pom.xml / package.json / pyproject.toml / go.mod 等の SUT stack の依存マニフェスト>",
    "<source root 例: src/main/** (Maven/Gradle) / src/** (Node/Python) / app/** (Rails) / cmd/** + pkg/** (Go) 等の SUT stack convention>",
    "<config / template 例: *.yml / *.yaml / *.toml / *.properties (Spring Boot) / *.env 等>"
  ]
}
```

`fingerprint_glob_patterns` は **SUT stack に応じて investigator が dispatch** する (上記は schema 例)。実値の選定基準: Phase 2 の機械的事実 (route / validation / template / event / observation_means) は「ソース・テンプレート・設定」が変わらない限り変化しないため、stack の主要 source/manifest/config 群をすべて拾う pattern を渡す。Maven/Gradle Java project なら `src/main/**` 系、Node/Python project なら `src/**` / `app/**` / pyproject 等を渡す形でよい。

### 2-2. α: `plan/test-investigation/phase3/.cache-key.json`

```json
{
  "version": "1",
  "scope": "phase3",
  "computed_at": "ISO 8601 timestamp",
  "depends_on": ["phase1", "phase2"],
  "phase1_summary_sha256": "hex sha256 of phase1/_summary.json",
  "phase2_artifacts_sha256": "hex sha256 of concat of phase2/{_framework,route_map,validation_rule_map,template_inventory,event_binding_map,controller_action_map,api_contract_map,available_capabilities}.json"
}
```

### 2-3. β: `.claude/cache/sut-<SUT-id>/manifest.json`

```json
{
  "version": "1",
  "sut_root": "absolute path",
  "sut_id": "hex sha256 (16 char prefix)",
  "first_populated_at": "ISO 8601",
  "last_updated_at": "ISO 8601",
  "populated_from_workspace": "absolute path of workspace at populate time",
  "framework_signature": "string from _framework.json (human-readable)"
}
```

### 2-4. β: `.claude/cache/sut-<SUT-id>/phase2-stack.cache-key.json`

```json
{
  "version": "1",
  "scope": "phase2-stack",
  "computed_at": "ISO 8601",
  "manifest_files": [
    {"path": "relative path from SUT root", "sha256": "hex sha256"}
  ]
}
```

`manifest_files` 候補リスト (順次存在チェック・最初に見つかった set を採用):

| Stack | candidate file path patterns (SUT root 相対) |
|---|---|
| Gradle (Kotlin DSL) | `build.gradle.kts`, `settings.gradle.kts` |
| Gradle (Groovy) | `build.gradle`, `settings.gradle` |
| Maven | `pom.xml` |
| Node (npm) | `package.json`, `package-lock.json` |
| Node (pnpm) | `package.json`, `pnpm-lock.yaml` |
| Node (yarn) | `package.json`, `yarn.lock` |
| Python (poetry) | `pyproject.toml`, `poetry.lock` |
| Python (pip) | `requirements.txt`, `Pipfile.lock` |
| Go | `go.mod`, `go.sum` |

---

## 3. Bash one-liner templates (literal 引用可)

### 3-1. SUT root の検出

```bash
detect_sut_root() {
  # progress.md 起動コマンドから `cd <path>` を抽出
  local from_progress=$(grep -oE 'cd [^ &;]+' plan/progress.md 2>/dev/null | head -1 | awk '{print $2}')
  if [ -n "$from_progress" ] && [ -d "$from_progress" ]; then
    realpath "$from_progress"
    return
  fi
  # fallback: Test Runner config を上方向に探索
  local from_config=$(find "${CLAUDE_PROJECT_DIR:-.}" -maxdepth 4 \( \
    -name "playwright.config.ts" -o -name "playwright.config.js" \
    -o -name "pytest.ini" -o -name "pom.xml" -o -name "build.gradle.kts" \
    -o -name "build.gradle" -o -name "package.json" \
    \) 2>/dev/null | head -1)
  [ -n "$from_config" ] && realpath "$(dirname "$from_config")"
}
```

### 3-2. SUT-id 計算

```bash
compute_sut_id() {
  local sut_root="$1"
  echo -n "$(realpath "$sut_root")" | sha256sum | awk '{print substr($1,1,16)}'
}
```

### 3-3. α: fingerprint hash 計算 (現在状態)

```bash
# 引数: SUT root, glob patterns (改行区切り)
# 出力: "path:sha\n..." 形式の文字列 (LC_ALL=C codepoint sorted)
# 重要: shell の sort は locale 依存・jq の sort は codepoint で固定。
# 突合するには両者を同じ codepoint sort で揃える必要がある (LC_ALL=C を強制)。
compute_alpha_hash() {
  local sut_root="$1"
  local patterns="$2"
  while IFS= read -r pattern; do
    [ -z "$pattern" ] && continue
    (cd "$sut_root" && command find . -path "./$pattern" -type f 2>/dev/null) | while read file; do
      rel="${file#./}"
      sha=$(sha256sum "$sut_root/$rel" | awk '{print $1}')
      echo "$rel:$sha"
    done
  done <<< "$patterns" | LC_ALL=C sort
}
```

### 3-4. α: cache key と現在状態を突合

```bash
# 戻り値: 0 = hit, 1 = miss
# 比較は md5sum 経由 (trailing newline で string 比較が false-miss する事故を排除)
check_alpha_cache() {
  local key_file="$1"
  local sut_root="$2"
  [ -f "$key_file" ] || return 1
  local expected=$(jq -r '.fingerprint_files[] | .path + ":" + .sha256' "$key_file" 2>/dev/null | LC_ALL=C sort)
  [ -z "$expected" ] && return 1
  local patterns=$(jq -r '.fingerprint_glob_patterns[]?' "$key_file" 2>/dev/null)
  local current=$(compute_alpha_hash "$sut_root" "$patterns")
  local e_hash=$(echo "$expected" | md5sum | awk '{print $1}')
  local c_hash=$(echo "$current" | md5sum | awk '{print $1}')
  [ "$e_hash" = "$c_hash" ]
}
```

### 3-5. β: cache hit 判定

```bash
# 戻り値: 0 = hit, 1 = miss
check_beta_cache() {
  local cache_dir="$1"  # .claude/cache/sut-<id>
  local sut_root="$2"
  local key_file="$cache_dir/phase2-stack.cache-key.json"
  [ -f "$key_file" ] || return 1
  local expected=$(jq -r '.manifest_files[] | .path + ":" + .sha256' "$key_file" 2>/dev/null | LC_ALL=C sort)
  [ -z "$expected" ] && return 1
  local current=$(jq -r '.manifest_files[] | .path' "$key_file" 2>/dev/null | while read path; do
    sha=$(sha256sum "$sut_root/$path" 2>/dev/null | awk '{print $1}')
    [ -n "$sha" ] && echo "$path:$sha"
  done | LC_ALL=C sort)
  local e_hash=$(echo "$expected" | md5sum | awk '{print $1}')
  local c_hash=$(echo "$current" | md5sum | awk '{print $1}')
  [ "$e_hash" = "$c_hash" ]
}
```

### 3-6. β: hydrate (cache → workspace)

```bash
hydrate_beta_cache() {
  local cache_dir="$1"
  mkdir -p plan/test-investigation/phase2
  cp "$cache_dir/phase2-stack/_framework.json" plan/test-investigation/phase2/ 2>/dev/null || return 1
  cp "$cache_dir/phase2-stack/available_capabilities.json" plan/test-investigation/phase2/ 2>/dev/null || return 1
  return 0
}
```

### 3-7. β: persist (workspace → cache)

```bash
persist_beta_cache() {
  local sut_root="$1"
  local cache_dir="$2"
  mkdir -p "$cache_dir/phase2-stack"
  cp plan/test-investigation/phase2/_framework.json "$cache_dir/phase2-stack/"
  cp plan/test-investigation/phase2/available_capabilities.json "$cache_dir/phase2-stack/"
  # cache key 生成
  local now=$(date -Iseconds)
  # framework_signature は human-readable な debug 用 (invalidation には使われない)
  # _framework.json の schema が agent / バージョンで揺れるため、複数 key を試して fallback
  local fw_sig=$(jq -r '
    [
      (.framework_summary // empty),
      (.framework // empty),
      ((.web_framework // empty), (.template_engine // empty), (.validation // empty) | select(. != "")) ] |
    map(select(. != null and . != "")) | join(" + ")
  ' plan/test-investigation/phase2/_framework.json 2>/dev/null)
  [ -z "$fw_sig" ] && fw_sig="unknown"
  # manifest_files の sha 計算 (Gradle/Maven/Node/Python/Go 順)
  local manifest_files_json=$(detect_manifest_files "$sut_root")
  jq -n --arg ts "$now" --argjson files "$manifest_files_json" '{
    version: "1",
    scope: "phase2-stack",
    computed_at: $ts,
    manifest_files: $files
  }' > "$cache_dir/phase2-stack.cache-key.json"
  # manifest.json 更新
  local sut_id=$(compute_sut_id "$sut_root")
  local first=$(jq -r '.first_populated_at // empty' "$cache_dir/manifest.json" 2>/dev/null)
  [ -z "$first" ] && first="$now"
  jq -n --arg sut "$sut_root" --arg id "$sut_id" --arg first "$first" --arg last "$now" --arg ws "$PWD" --arg fw "$fw_sig" '{
    version: "1",
    sut_root: $sut,
    sut_id: $id,
    first_populated_at: $first,
    last_updated_at: $last,
    populated_from_workspace: $ws,
    framework_signature: $fw
  }' > "$cache_dir/manifest.json"
}

detect_manifest_files() {
  local sut_root="$1"
  local found="[]"
  for path in build.gradle.kts settings.gradle.kts build.gradle pom.xml package.json package-lock.json pnpm-lock.yaml yarn.lock pyproject.toml requirements.txt Pipfile.lock go.mod go.sum; do
    if [ -f "$sut_root/$path" ]; then
      local sha=$(sha256sum "$sut_root/$path" | awk '{print $1}')
      found=$(echo "$found" | jq --arg p "$path" --arg s "$sha" '. + [{path: $p, sha256: $s}]')
    fi
  done
  echo "$found"
}
```

---

## 4. Troubleshooting

| 症状 | 原因候補 | 対処 |
|---|---|---|
| α cache hit したのに output が古いように見える | fingerprint scope に含まれない file が semantic に影響している | `fingerprint_glob_patterns` を拡張・該当 file を `phase2/.cache-key.json` の `fingerprint_files` に追加して再走 |
| β cache が別 project に流出 | symbolic link で SUT root path が揺れている | SUT root を `realpath` で正規化してから sha 計算 (3-2 に既に組み込み済み) |
| `.claude/cache/` を消したい | invalidation を強制したい / debug | `rm -rf .claude/cache/sut-<SUT-id>` (該当 SUT のみ) または `rm -rf .claude/cache/` (全体) |
| α cache を消したい | 同 workspace 内で強制 re-run | `rm plan/test-investigation/phase2/.cache-key.json plan/test-investigation/phase3/.cache-key.json` |
| Phase 3 が常に miss する | Phase 1+2 のどちらかが必ず re-run されている | `_summary.json` の mtime や sha256 と cache key を突合・depends_on chain を確認 |

---

## 5. 禁止事項 (safety net・behavioral rule の inline と二重保険)

- ❌ mtime ベース invalidation (touch / git checkout で false-hit)
- ❌ 「明らかに stack-common」「明らかに feature-affected」を LLM 推論で振り分け
- ❌ β cache に feature-affected な artifact (route_map / validation_rule_map / template_inventory 等) を含める
- ❌ cache hit のとき Phase 1 も skip (Phase 1 は実 UI capture で feature-affected・常に再走)
- ❌ partial match で cache hit 判定 (fingerprint files の subset 一致だけで hit 不可・全件一致必須)
- ❌ jq の `sort` と shell の `sort` を混在 (locale 不一致で常に false-MISS する silent functional failure 源)。**両者を必ず `LC_ALL=C sort` に統一する**
- ❌ shell string 比較 `[ "$a" = "$b" ]` で hash 突合 (trailing newline 1 個で false-MISS する)。`md5sum` 経由で比較する
