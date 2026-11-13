// Loads the built site in headless Chrome and fails if it doesn't render
// or throws errors. Usage: node smoke-test.mjs <base-url>
// Needs `playwright-core` installed and Google Chrome on the machine
// (GitHub's ubuntu-latest runners ship with Chrome).
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4173';
const pages = [
  { name: 'Network Map', path: '/' },
  { name: 'Simulator', path: '/#sim' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const problems = [];

for (const { name, path } of pages) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));

  try {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30_000 });
    // React must have rendered something into #root.
    await page.waitForFunction(
      () => document.querySelector('#root')?.children.length > 0,
      null,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(2_000); // let the simulator tick a few times
  } catch (e) {
    errors.push(`did not render: ${e.message.split('\n')[0]}`);
  }

  if (errors.length) {
    problems.push(`${name} (${path}):\n  - ${errors.join('\n  - ')}`);
    console.log(`FAIL ${name}`);
  } else {
    console.log(`ok   ${name}`);
  }
  await page.close();
}

await browser.close();

if (problems.length) {
  console.error('\n' + problems.join('\n'));
  process.exit(1);
}
