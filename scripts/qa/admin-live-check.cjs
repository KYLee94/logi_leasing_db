const { chromium } = require('playwright');
const fs = require('fs');

const ADMIN_URL =
  process.env.ADMIN_URL ||
  'https://script.google.com/macros/s/AKfycbw-MNDdPW19QrdlKOtZ111UY037Ko3z9O9nYWsqCsXj6r8C814ZUzH6wz1UORE1jdwgNg/exec?page=admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

async function findFrameWithPassword(page) {
  for (const frame of page.frames()) {
    const count = await frame.locator('input[type="password"]').count().catch(() => 0);
    if (count > 0) return frame;
  }
  return page;
}

async function clickFirstAvailable(frame, selectors) {
  for (const selector of selectors) {
    const target = frame.locator(selector).first();
    if ((await target.count().catch(() => 0)) > 0) {
      await target.click();
      return true;
    }
  }
  return false;
}

(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROME_PATH ||
    [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const startedAt = Date.now();

  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const frame = await findFrameWithPassword(page);
  const hasPassword = (await frame.locator('input[type="password"]').count().catch(() => 0)) > 0;
  console.log(JSON.stringify({ phase: 'loaded', hasPassword, ms: Date.now() - startedAt }));

  if (hasPassword) {
    if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD env is required for admin live check.');
    await frame.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
    const clicked = await clickFirstAvailable(frame, [
      'button:has-text("로그인")',
      'button:has-text("확인")',
      'button:has-text("Admin")',
      'button[type="submit"]',
      'button',
    ]);
    if (!clicked) await frame.locator('input[type="password"]').press('Enter');
  }

  const adminStartedAt = Date.now();
  await frame.locator('text=히스토리 미연결').first().waitFor({ timeout: 90000 });
  const bodyText = await frame.locator('body').innerText({ timeout: 10000 });
  const expected = [
    '히스토리 미연결',
    '임대료 누락',
    '관리비 누락',
    'E.NOC 누락',
    '검토 필요',
    '오류 의심',
    'OPENDART 미연결',
    '건축물대장 미연결',
    '이슈 백로그',
  ];
  const missing = expected.filter((text) => !bodyText.includes(text));

  console.log(JSON.stringify({
    phase: 'admin-ready',
    ms: Date.now() - adminStartedAt,
    missing,
    excerpt: bodyText.slice(0, 1800),
  }));

  await browser.close();
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
