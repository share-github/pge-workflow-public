#!/usr/bin/env node
/**
 * playwright-smoke.cjs — evaluator-pre-smoke の UI smoke (Bash + Playwright Node.js)
 *
 * Phase M 設計: Custom subagent teammate には MCP が継承されない (#13898) ため、
 * Playwright Node.js library を Bash 経由で直接呼んでブラウザエンジン経由の health
 * check を実行。MCP browser_navigate と同等の結果を生成。
 *
 * Usage:
 *   node .claude/scripts/playwright-smoke.cjs <url>
 *
 * stdout (JSON):
 *   { "success": true, "url": "...", "status_code": 200, "title": "...", "error": null }
 *   または
 *   { "success": false, "url": "...", "status_code": null, "title": null, "error": "..." }
 *
 * 終了コード:
 *   0: success
 *   1: 失敗 (page.goto エラー or タイムアウト or HTTP 5xx 等)
 */

const { chromium } = require('playwright');

const URL = process.argv[2];
if (!URL) {
  console.error(JSON.stringify({ success: false, error: 'usage: playwright-smoke.cjs <url>' }));
  process.exit(1);
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const response = await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    const statusCode = response ? response.status() : null;
    const title = await page.title();
    await page.close();

    const result = {
      success: statusCode !== null && statusCode < 500,
      url: URL,
      status_code: statusCode,
      title,
      error: statusCode === null ? 'no response' : statusCode >= 500 ? `HTTP ${statusCode}` : null,
    };
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({
      success: false,
      url: URL,
      status_code: null,
      title: null,
      error: String(e.message || e),
    }));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
