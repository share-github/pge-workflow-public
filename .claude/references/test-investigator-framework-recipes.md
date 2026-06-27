# Test-Investigator: Framework 別 Phase 2 解析 Recipe

`test-investigator.md` Phase 2「Static Code Analysis」4-A で framework を識別した後、**識別された framework の節を Read** すること。

未対応の framework に遭遇した場合は halt（`reason: "framework-recipe-missing"`）し、人間に recipe 追記を依頼する。本ファイルは正典として framework recipe を逐次追記する。

## Spring Boot

| 解析対象                                    | 抽出方法                                                                  | 成果物                            |
| ------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| Controller アノテーション                   | `@(RestController\|Controller\|GetMapping\|PostMapping\|...)` を Grep        | `route_map.json`                  |
| Service / Repository 呼び出し               | Controller メソッドから service / repository への呼び出しを Read + Grep    | `controller_action_map.json`      |
| API 契約（DTO・ResponseEntity）             | DTO クラスを Read してフィールド・型を抽出                                 | `api_contract_map.json`           |
| Validation（Bean Validation / 独自）        | `@(NotNull\|Size\|Pattern\|Valid\|...)` を Grep してフィールドにマッピング   | `validation_rule_map.json`        |
| Thymeleaf テンプレート構造                  | `*.html` を Read、`th:*` 属性を Grep                                       | `template_inventory.json`         |
| Thymeleaf イベントバインディング            | `th:onclick` 等と JS ファイル参照を Grep                                   | `event_binding_map.json`          |

## Next.js

| 解析対象                                    | 抽出方法                                                                  | 成果物                            |
| ------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| App Router / Pages Router 配下のルート      | `app/**/page.tsx` / `pages/**/*.tsx` を Glob                              | `route_map.json`                  |
| API Routes                                  | `app/**/route.ts` / `pages/api/**/*.ts` を Glob                           | `api_contract_map.json`           |
| `'use client'` 境界                         | Grep でディレクティブを抽出                                                | `controller_action_map.json`      |
| zod / yup / react-hook-form の validation   | スキーマ宣言を Read                                                        | `validation_rule_map.json`        |
| コンポーネントとイベントハンドラ            | `.tsx` を Read、`onClick` / `onSubmit` 等を Grep                          | `event_binding_map.json`          |

## View Engine Type 検出 token (framework 横断・Phase Z5+)

`_framework.json#view_engine_type` field は build manifest + source tree の token grep で機械決定する。各 token は **存在すれば 1 票** として扱い、最多得票の type を採用。複数 type 同点なら `"mixed"` を優先採用 (precision 不確実より explicit hybrid 表明)。

| view_engine_type | 検出 token (例) |
|---|---|
| **`"server-side-template"`** | Thymeleaf (`th:*` 属性 in `*.html`)・JSP (`*.jsp` 存在)・ERB (`*.erb` 存在)・Jinja2/Django (`templates/**/*.html` 内 `{% %}` / `{{ }}`)・Blade (`*.blade.php` 存在)・Razor (`*.cshtml` 存在)・Pug (`*.pug` 存在)・Mustache (`*.mustache` 存在)・Handlebars (`*.hbs` / `*.handlebars` 存在) |
| **`"spa"`** | `package.json` の dependencies に `react-dom` / `vue` / `@angular/core` / `svelte` / `solid-js` のいずれか + サーバ template token 不在 + entry HTML に空 shell pattern (`<div id="root"></div>` / `<div id="app"></div>`) |
| **`"mixed"`** | SSR framework (Next.js / Nuxt / SvelteKit / Remix / Astro) を build manifest dependency で検出 + `'use client'` directive または component-level CSR が混在 |
| **`"none"`** | HTML response を返さない pure REST API (Spring `@RestController` のみ・FastAPI のみ・etc.) / CLI tool / batch job・上記 token がいずれも不在 |

Spring Boot + Thymeleaf SUT は `*.html` に `th:` 属性が見つかる時点で `"server-side-template"` 確定。Next.js は App Router の `'use client'` directive 存在で `"mixed"` (Pages Router のみで全 page が server-rendered なら `"server-side-template"`)。

## その他の framework

未対応 framework に遭遇したら halt（`reason: "framework-recipe-missing"`）。人間が recipe を追記するまで該当 framework の調査は不能。
