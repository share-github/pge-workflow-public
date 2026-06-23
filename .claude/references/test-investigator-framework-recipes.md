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

## その他の framework

未対応 framework に遭遇したら halt（`reason: "framework-recipe-missing"`）。人間が recipe を追記するまで該当 framework の調査は不能。
