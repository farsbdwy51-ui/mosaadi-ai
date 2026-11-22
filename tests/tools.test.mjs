// اختبارات الأدوات: الدوال النقية والسجل
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitIntoScenes,
  buildImageUrl,
  wikiApiUrl,
  createToolRegistry,
} from '../js/tools.js';

test('splitIntoScenes: قصة قصيرة تصبح مشاهد مفردة', () => {
  const scenes = splitIntoScenes('جملة أولى. جملة ثانية! جملة ثالثة؟');
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].scene, 1);
  assert.equal(scenes[0].text, 'جملة أولى.');
});

test('splitIntoScenes: قصة طويلة تُضغط إلى الحد الأقصى', () => {
  const long = Array.from({ length: 20 }, (_, i) => `جملة رقم ${i + 1}.`).join(' ');
  const scenes = splitIntoScenes(long, 5);
  assert.equal(scenes.length, 5);
  assert.ok(scenes[4].text.includes('جملة'));
});

test('splitIntoScenes: فارغ → فارغ', () => {
  assert.deepEqual(splitIntoScenes(''), []);
  assert.deepEqual(splitIntoScenes(null), []);
});

test('buildImageUrl: يرمّز الوصف العربي', () => {
  const url = buildImageUrl('قطة فضائية');
  assert.ok(url.startsWith('https://image.pollinations.ai/prompt/'));
  assert.ok(url.includes(encodeURIComponent('قطة فضائية')));
  assert.ok(url.includes('nologo=true'));
});

test('wikiApiUrl: يبني رابط API صحيحًا', () => {
  const url = wikiApiUrl('مصر', 'ar');
  assert.ok(url.startsWith('https://ar.wikipedia.org/w/api.php'));
  assert.ok(url.includes('origin=*'));
  assert.ok(url.includes(encodeURIComponent('مصر')));
});

test('السجل: الأدوات الأساسية موجودة', () => {
  const reg = createToolRegistry();
  for (const name of ['web_search', 'open_url', 'create_document', 'story_to_script', 'run_code', 'generate_image', 'remember', 'recall', 'make_plan', 'youtube_content']) {
    assert.ok(reg.has(name), name + ' مفقود');
  }
});

test('السجل: أدوات الخدمات الخارجية موسومة بوضوح', () => {
  const reg = createToolRegistry();
  for (const name of ['generate_video', 'email_calendar', 'youtube_upload', 'cloud_storage', 'phone_control']) {
    const t = reg.get(name);
    assert.ok(t, name + ' مفقود');
    assert.ok(t.needsService, name + ' بلا وسم needsService');
  }
});

test('أداة خارجية تُعيد needs-service بدل الادعاء بالتنفيذ', async () => {
  const reg = createToolRegistry();
  const r = await reg.get('phone_control').run({}, {});
  assert.equal(r.status, 'needs-service');
  assert.ok(r.message.length > 10);
});

test('generate_image يرفض وصفًا فارغًا', async () => {
  const reg = createToolRegistry();
  await assert.rejects(() => reg.get('generate_image').run({ prompt: ' ' }, {}));
});

test('story_to_script تنتج نصًا مرقمًا', async () => {
  const reg = createToolRegistry();
  const r = await reg.get('story_to_script').run({ story: 'كان يا ما كان. عاش ملك.' }, {});
  assert.equal(r.scenes, 2);
  assert.ok(r.script.includes('المشهد 1'));
});

test('remember و recall يعملان عبر سياق حقيقي', async () => {
  const { createMemoryStore } = await import('../js/memory.js');
  const map = new Map();
  const memory = createMemoryStore({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  });
  const reg = createToolRegistry();
  await reg.get('remember').run({ text: 'أحب القهوة', category: 'عام' }, { memory });
  const r = await reg.get('recall').run({}, { memory });
  assert.equal(r.count, 1);
  assert.ok(r.summary.includes('أحب القهوة'));
});
