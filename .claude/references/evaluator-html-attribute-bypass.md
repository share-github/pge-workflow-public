# Evaluator: HTML 属性が validation 検証を遮蔽するパターンへの対処

⚠️ **Phase Z1+Z4 以降は本ファイルの behavioral rule は `evaluator-per-ac.md` 本文 Step 0 / Step 7 self-check (validation_layer 軸) および `evaluator-aggregator.md` 本文 fix_target 補正 routing (A' 規約) に inline 化されている**。本ファイルは catalog (literal 引用元) として残置するが、**rule の正典は agent file 側**。新規対応時は該当 agent file を最初に読むこと (SKILL.md「PGE 内部の絶対ルール 11: References are catalogs, not rules」)。

`evaluator-per-ac.md` / `evaluator-aggregator.md` から参照される、フロント層のブラウザ制限を意図的に解除して**サーバ層 validation を到達検証する**ためのレシピ。

ブラウザ層（HTML 属性・JavaScript）でフロント側の制限が効いている場合、サーバ側のバリデーションが**そもそも到達せず検証できない**ことがある。AC が「サーバ層のバリデーション」を要求しているのにブラウザ層で遮蔽されている場合は、**フロント制限を意図的に解除して送信する**。

## 検証層の切り分け

AC を読むときに以下を確認する：

| AC の意図                         | 検証すべき層             | 推奨手段                                            |
| --------------------------------- | ------------------------ | --------------------------------------------------- |
| ユーザー入力時の体験（文字数制限） | ブラウザ層（HTML 属性）  | 通常の入力操作で属性が効いていることを確認          |
| 不正入力をサーバが弾くこと        | サーバ層（バックエンド） | フロント制限を解除してサーバまで送信し、応答を確認  |
| 両方                              | 両方                     | 通常入力 + フロント制限解除の 2 ケースを実施        |

## よくある遮蔽属性とバイパス例

| 属性                           | フロント挙動                       | バイパス手段（`page.evaluate()` 内）                                         |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------- |
| `maxlength="N"`                | 入力が N 文字で打ち切られる        | `el.removeAttribute('maxlength')`                                            |
| `pattern="..."`                | フォーム送信時にブラウザが弾く     | `el.removeAttribute('pattern')` または `form.noValidate = true`              |
| `min="X"`/`max="Y"`（数値）    | 範囲外で送信ブロック               | `el.removeAttribute('min'); el.removeAttribute('max')`                       |
| `required`                     | 空送信ブロック                     | `el.removeAttribute('required')` または `form.noValidate = true`             |
| `type="email"`/`type="number"` | 不正形式で送信ブロック             | `el.setAttribute('type', 'text')`                                            |
| `disabled`                     | 値が送信されない                   | `el.removeAttribute('disabled')`                                             |
| クライアント JS バリデーション | submit ハンドラで preventDefault   | `form.noValidate = true` または submit listener を `removeEventListener` で外す |

## 対処の標準パターン

```javascript
// MCP 操作内（または spec.ts 内）で page.evaluate() を使う
await page.evaluate(() => {
  const input = document.querySelector('input[name="<field>"]') as HTMLInputElement;
  if (input) {
    input.removeAttribute('maxlength');  // 該当属性を除去
  }
});

// 続けて通常入力 → submit → サーバ応答を確認
```

## 運用ルール

- **ブラウザ層の検証 AC（HTML 属性が効いていること）は、属性除去せずに通常操作で確認**する。属性が効かなければそれ自体が AC 失敗。
- **サーバ層の検証 AC（バリデーションメッセージ・HTTP ステータス）は、フロント制限を解除して必ずサーバまで到達させてから確認**する。
- **両方の AC が混在する場合は別テストに分ける**（同一 spec.ts 内で `TC-N-01: ブラウザ層`、`TC-N-01-server: サーバ層` のように並べる）。
- バイパス操作は **その意図がコメントから読み取れるように記述**する（例: `// maxlength を除去してサーバ側 @Size を検証`）。
- `curl` で HTTP リクエストを直接送る代替手段も有効（特にサーバ層検証のみが目的の場合）。ただしフォームの実際の送信フローを見たいときは MCP 経由で前述のバイパスを使う。
