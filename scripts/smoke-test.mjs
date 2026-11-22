// scripts/smoke-test.mjs — فحص تفاعلي حقيقي للواجهة عبر Chrome headless
import puppeteer from '/tmp/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://localhost:8090';
const SHOT = '/downloads';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844', '--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));

// 1) أمر: حفظ في الذاكرة
await page.type('#text-input', 'احفظ إني بفضل القهوة السادة');
await page.click('#send-btn');
await new Promise((r) => setTimeout(r, 1200));
const afterRemember = await page.$eval('#chat-log', (el) => el.textContent);
console.log('remember ok:', afterRemember.includes('حفظت في الذاكرة'));

// 2) أمر: استرجاع الذاكرة
await page.type('#text-input', 'ايه اللي في الذاكرة');
await page.click('#send-btn');
await new Promise((r) => setTimeout(r, 1200));
const afterRecall = await page.$eval('#chat-log', (el) => el.textContent);
console.log('recall ok:', afterRecall.includes('القهوة السادة'));

// 3) أمر: توليد صورة (يظهر عنصر الصورة)
await page.type('#text-input', 'ارسم صورة قطة فضائية');
await page.click('#send-btn');
await new Promise((r) => setTimeout(r, 1500));
const hasImg = await page.$('.msg-image') !== null;
console.log('image ok:', hasImg);
await page.screenshot({ path: `${SHOT}/mosaadi-screenshot-2-chat.png` });

// 4) أمر: سيناريو
await page.type('#text-input', 'حول لسيناريو: كان يا ما كان تاجر صالح. سافر ابنه بحثا عن الرزق. عاد بالخير.');
await page.click('#send-btn');
await new Promise((r) => setTimeout(r, 1200));
const afterScript = await page.$eval('#chat-log', (el) => el.textContent);
console.log('script ok:', afterScript.includes('المشهد 1'));

// 5) صفحة المهام
await page.click('[data-tab="tasks"]');
await new Promise((r) => setTimeout(r, 400));
const tasksText = await page.$eval('#tasks-list', (el) => el.textContent);
console.log('tasks ok:', tasksText.includes('منفّذة') || tasksText.includes('✅'));
await page.screenshot({ path: `${SHOT}/mosaadi-screenshot-3-tasks.png` });

// 6) صفحة الذاكرة
await page.click('[data-tab="memory"]');
await new Promise((r) => setTimeout(r, 400));
const memText = await page.$eval('#memory-list', (el) => el.textContent);
console.log('memory page ok:', memText.includes('القهوة السادة'));
await page.screenshot({ path: `${SHOT}/mosaadi-screenshot-4-memory.png` });

// 7) صفحة الأدوات
await page.click('[data-tab="tools"]');
await new Promise((r) => setTimeout(r, 400));
const toolsText = await page.$eval('#tools-list', (el) => el.textContent);
console.log('tools ok:', toolsText.includes('web_search') && toolsText.includes('needs') === false || toolsText.includes('phone_control'));

// 8) صفحة الإعدادات
await page.click('[data-tab="settings"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${SHOT}/mosaadi-screenshot-5-settings.png` });
const connText = await page.$eval('#connections-list', (el) => el.textContent);
console.log('connections ok:', connText.includes('OpenRouter') && connText.includes('Google'));

// 9) زر الإيقاف
await page.click('[data-tab="chat"]');
await page.click('#stop-btn');
await new Promise((r) => setTimeout(r, 300));
const stopText = await page.$eval('#chat-log', (el) => el.textContent);
console.log('stop ok:', stopText.includes('الإيقاف الفوري'));

console.log('js errors:', errors.length ? errors : 'none');
await browser.close();
