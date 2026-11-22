// scripts/sw-upgrade-test.mjs — يحاكي متصفحًا قديمًا مخزّن v1 ثم يتحقق من التحديث
// 1) يخدم نسخة v1 (من git) ويفتحها → يثبّت SW القديم ويكتب ذاكرة وإعدادات
// 2) يبدّل الخادم إلى النسخة الحالية (نفس البورت) ويعيد التحميل
// 3) يتحقق: الواجهة الجديدة ظهرت + الذاكرة والإعدادات باقية + الكاش القديم أُزيل
import puppeteer from '/tmp/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = 8093;
const BASE = `http://localhost:${PORT}`;
const REPO = '/downloads/mosaadi-ai';
const V1_DIR = '/tmp/mosaadi-v1';

// استخراج نسخة v1 من git
execSync(`rm -rf ${V1_DIR} && mkdir -p ${V1_DIR}/js ${V1_DIR}/css`);
const files = execSync(`git -C ${REPO} ls-tree -r --name-only ce79587`).toString().trim().split('\n');
for (const f of files) {
  if (f.startsWith('tests/') || f.startsWith('scripts/')) continue;
  const content = execSync(`git -C ${REPO} show ce79587:${f}`);
  mkdirSync(`${V1_DIR}/${f.split('/').slice(0, -1).join('/')}`, { recursive: true });
  writeFileSync(`${V1_DIR}/${f}`, content);
}
// server.js يحدد جذره من مسار ملفه نفسه — انسخه داخل كل دليل يُخدَّم
const { copyFileSync } = await import('node:fs');
copyFileSync(`${REPO}/server.js`, `${V1_DIR}/server.js`);
console.log('v1 extracted:', files.length, 'files');

function serve(dir) {
  const root = dir === 'repo' ? REPO : V1_DIR;
  return spawn('node', [`${root}/server.js`], {
    env: { ...process.env, PORT: String(PORT) },
    cwd: root,
    stdio: 'ignore',
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// المرحلة 1: المتصفح القديم على v1
let srv = serve(V1_DIR);
await wait(800);
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });

// انتظار تثبيت SW وتفعيله
await page.waitForFunction(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg && reg.active;
}, { timeout: 15000 });

// كتابة ذاكرة وإعدادات كأنها بيانات مستخدم قديم
await page.evaluate(() => {
  localStorage.setItem('mosaadi.memory.v1', JSON.stringify([
    { id: 'mem-test1', category: 'عام', text: 'ذاكرة يجب أن تبقى', createdAt: new Date().toISOString() },
  ]));
  localStorage.setItem('mosaadi.settings.v1', JSON.stringify({ language: 'ar-SA', voiceRate: 1.3 }));
});
await page.reload({ waitUntil: 'networkidle2' });
const v1CacheNames = await page.evaluate(() => caches.keys());
console.log('v1 caches:', v1CacheNames);
console.log('v1 served:', await page.$eval('title', (el) => el.textContent.includes('مساعدي')));

// المرحلة 2: نشر النسخة الجديدة (نفس الأصل/البورت) وإعادة التحميل
srv.kill();
await wait(500);
srv = serve('repo');
await wait(800);

await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
// انتظار تحديث الـ SW إلى النسخة الجديدة
const upgraded = await page.waitForFunction(async () => {
  const keys = await caches.keys();
  return keys.includes('mosaadi-ai-v2');
}, { timeout: 20000 }).then(() => true).catch(() => false);
console.log('upgraded to v2 cache:', upgraded);

// قد يحتاج التحميل الجديد جولة أخرى ليسيطر الـ SW الجديد
await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });

const hasNewToggle = await page.$('#set-share-memory') !== null;
const oldCacheGone = await page.evaluate(() => caches.keys().then((k) => !k.includes('mosaadi-ai-v1')));
const memoryKept = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('mosaadi.memory.v1') || '[]');
  return m.length === 1 && m[0].text === 'ذاكرة يجب أن تبقى';
});
const settingsKept = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('mosaadi.settings.v1') || '{}');
  return s.language === 'ar-SA' && s.voiceRate === 1.3;
});
const swVersion = await page.evaluate(async () => {
  const res = await fetch('./sw.js');
  const txt = await res.text();
  const m = txt.match(/CACHE_VERSION = (\d+)/);
  return m ? Number(m[1]) : 0;
});

console.log('new UI (share-memory toggle):', hasNewToggle);
console.log('old cache retired:', oldCacheGone);
console.log('memory preserved:', memoryKept);
console.log('settings preserved:', settingsKept);
console.log('served sw.js version:', swVersion);

await browser.close();
srv.kill();

const ok = upgraded && hasNewToggle && oldCacheGone && memoryKept && settingsKept && swVersion >= 2;
console.log(ok ? 'SW UPGRADE TEST: PASS' : 'SW UPGRADE TEST: FAIL');
process.exit(ok ? 0 : 1);
