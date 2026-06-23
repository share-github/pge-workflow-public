#!/usr/bin/env node
/**
 * playwright-capture.cjs — TI Phase 1 Runtime UI Capture (Bash + Playwright Node.js)
 *
 * Phase M 設計: Custom subagent teammate には MCP が継承されない (#13898) ため、
 * Playwright Node.js library を Bash 経由で直接呼んでブラウザエンジン経由の本物の
 * capture を取得する。MCP browser_navigate / browser_snapshot / browser_evaluate /
 * browser_take_screenshot と同等の結果を生成。
 *
 * Usage:
 *   node .claude/scripts/playwright-capture.cjs <targets_json_path> <output_base_dir>
 *
 *   targets_json_path: 対象 URL リストの JSON ファイル (TI Phase 1 で生成済みの
 *                       _targets.json と同形式: {"targets": [{"url", "slug", ...}, ...]})
 *   output_base_dir:   /plan/test-investigation/phase1/ 等のベース dir
 *
 * 各 URL に対し以下を生成 (output_base_dir/<slug>/ 配下):
 *   - ui_shell.json       (url / title / statusCode / hasDialog / hasIframe / hasToast)
 *   - aria_snapshot.yaml  (locator('body').ariaSnapshot() を YAML 形式で)
 *   - dom_snapshot.html   (page.content())
 *   - visible_text.txt    (document.body.innerText)
 *   - page_screenshot.png (page.screenshot fullPage:false)
 *
 * 終了コード:
 *   0: 全 URL 成功
 *   1: 致命的エラー (Playwright init 失敗・全 URL 失敗等)
 *   2: 一部 URL 失敗 (続行・stdout に失敗 URL 情報を JSON で出力)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGETS_PATH = process.argv[2];
const BASE_DIR = process.argv[3];

if (!TARGETS_PATH || !BASE_DIR) {
  console.error('Usage: node playwright-capture.cjs <targets_json_path> <output_base_dir>');
  process.exit(1);
}

const targetsData = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8'));
const targets = targetsData.targets || targetsData;

const failed = [];
const captured = [];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    for (const t of targets) {
      const { url, slug } = t;
      const outDir = path.join(BASE_DIR, slug);
      try {
        fs.mkdirSync(outDir, { recursive: true });

        const page = await browser.newPage();
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        // ui_shell.json
        const uiShell = {
          url,
          title: await page.title(),
          statusCode: response ? response.status() : null,
          hasDialog: (await page.locator('dialog, [role="dialog"]').count()) > 0,
          hasIframe: (await page.locator('iframe').count()) > 0,
          hasToast: (await page.locator('[role="alert"], .toast, [role="status"]').count()) > 0,
        };
        fs.writeFileSync(path.join(outDir, 'ui_shell.json'), JSON.stringify(uiShell, null, 2));

        // aria_snapshot.yaml — Playwright 1.46+ uses locator.ariaSnapshot()
        // page.accessibility (deprecated) was removed in Playwright 1.49+
        const ariaText = await page.locator('body').ariaSnapshot();
        const yamlHeader = `# ARIA Snapshot - ${url}\n# Captured: ${new Date().toISOString()}\n# Method: Playwright page.locator('body').ariaSnapshot() via Bash + Node.js (Phase M)\n# Source: chromium browser engine (real accessibility tree, not DOM-parser inference)\n\n`;
        fs.writeFileSync(path.join(outDir, 'aria_snapshot.yaml'), yamlHeader + ariaText);

        // dom_snapshot.html (rendered DOM after JS execution)
        fs.writeFileSync(path.join(outDir, 'dom_snapshot.html'), await page.content());

        // visible_text.txt (body.innerText is browser-rendered visible text)
        const visibleText = await page.evaluate(() => document.body.innerText);
        fs.writeFileSync(path.join(outDir, 'visible_text.txt'), visibleText);

        // page_screenshot.png
        await page.screenshot({
          path: path.join(outDir, 'page_screenshot.png'),
          fullPage: false,
        });

        await page.close();
        captured.push({ url, slug, statusCode: uiShell.statusCode });
      } catch (err) {
        failed.push({ url, slug, error: String(err.message || err) });
      }
    }
  } finally {
    await browser.close();
  }

  const result = { captured, failed };
  console.log(JSON.stringify(result, null, 2));

  if (failed.length > 0 && captured.length === 0) process.exit(1);
  if (failed.length > 0) process.exit(2);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message || e);
  process.exit(1);
});
