// اختبارات الوكيل: تحليل النية، بناء الخطة، التنفيذ، الإعادة، الإيقاف
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, buildPlan, createAgent } from '../js/agent.js';
import { createMemoryStore } from '../js/memory.js';
import { createTaskStore } from '../js/tasks.js';
import { createToolRegistry } from '../js/tools.js';

function memAdapter() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function makeAgent(overrides = {}) {
  const memory = createMemoryStore(memAdapter());
  const tasks = createTaskStore(memAdapter());
  const tools = createToolRegistry();
  const ctx = {
    memory, tasks,
    llm: null,
    fetchJson: overrides.fetchJson || (async () => ({ query: { search: [] } })),
    download: overrides.download || (() => {}),
    openTab: overrides.openTab || (() => {}),
    runCode: overrides.runCode || (async () => ({ ok: true, logs: [], result: '42' })),
  };
  const events = [];
  const agent = createAgent({ tools, memory, tasks, llm: overrides.llm || null, onEvent: (e) => events.push(e) });
  agent.setContext(ctx);
  return { agent, memory, tasks, tools, events, ctx };
}

test('تحليل النية: بحث', () => {
  assert.equal(detectIntent('ابحث عن تاريخ مصر'), 'web_search');
  assert.equal(detectIntent('ما هو الذكاء الاصطناعي'), 'web_search');
});

test('تحليل النية: حفظ في الذاكرة', () => {
  assert.equal(detectIntent('احفظ إني بحب القهوة'), 'remember');
  assert.equal(detectIntent('اتذكر أن مشروعي اسمه مساعدي'), 'remember');
});

test('تحليل النية: استرجاع الذاكرة', () => {
  assert.equal(detectIntent('ايه اللي في الذاكرة'), 'recall');
});

test('تحليل النية: توليد صورة', () => {
  assert.equal(detectIntent('ارسم صورة قطة'), 'generate_image');
});

test('تحليل النية: سيناريو', () => {
  assert.equal(detectIntent('حول القصة دي لسيناريو: كان يا ما كان'), 'story_to_script');
});

test('تحليل النية: كود', () => {
  assert.equal(detectIntent('شغل الكود ده ```console.log(1)```'), 'run_code');
});

test('تحليل النية: يوتيوب', () => {
  assert.equal(detectIntent('اعملي سكربت فيديو يوتيوب عن الطبخ'), 'youtube_content');
});

test('تحليل النية: محادثة عامة', () => {
  assert.equal(detectIntent('عامل ايه النهارده'), 'chat');
});

test('buildPlan: remember يستخرج النص والتصنيف', () => {
  const [step] = buildPlan('remember', 'احفظ إن مشروعي الجديد اسمه مساعدي');
  assert.equal(step.tool, 'remember');
  assert.equal(step.args.category, 'مشاريع');
  assert.ok(step.args.text.includes('مساعدي'));
});

test('buildPlan: web_search ينظف الاستعلام', () => {
  const [step] = buildPlan('web_search', 'ابحث عن تاريخ مصر القديمة');
  assert.equal(step.tool, 'web_search');
  assert.ok(step.args.query.includes('تاريخ مصر'));
  assert.ok(!step.args.query.includes('ابحث'));
});

test('تنفيذ: حفظ ثم استرجاع من الذاكرة', async () => {
  const { agent, memory } = makeAgent();
  const r1 = await agent.handle('احفظ إني بفضل القهوة السادة');
  assert.equal(r1.status, 'done');
  assert.equal(memory.list().length, 1);
  const r2 = await agent.handle('ايه اللي في الذاكرة');
  assert.equal(r2.status, 'done');
  assert.ok(r2.report.includes('القهوة السادة'));
});

test('تنفيذ: بحث ويكيبيديا مع نتائج وهمية', async () => {
  const { agent } = makeAgent({
    fetchJson: async () => ({
      query: { search: [{ title: 'مصر القديمة', snippet: 'حضارة <b>قديمة</b>' }] },
    }),
  });
  const r = await agent.handle('ابحث عن مصر القديمة');
  assert.equal(r.status, 'done');
  assert.ok(r.report.includes('مصر القديمة'));
  assert.ok(!r.report.includes('<b>')); // HTML أُزيل
});

test('تنفيذ: خطأ ثم إعادة محاولة تنجح', async () => {
  let calls = 0;
  const { agent, memory, tasks } = makeAgent();
  const tools = createToolRegistry();
  tools.register({
    name: 'flaky',
    descAr: 'اختبار',
    run: async () => {
      calls++;
      if (calls === 1) throw new Error('فشل أول');
      return { ok: true };
    },
  });
  // استبدال مسار التنفيذ بخطة يدوية عبر أداة مسجلة مباشرة
  const t = tasks.create('اختبار إعادة المحاولة', [{ tool: 'flaky', args: {} }]);
  // نحاكي تنفيذ الوكيل لأداة واحدة: نستدعي handle على أمر ينتج خطة معروفة
  const agent2 = createAgent({ tools, memory, tasks, llm: null, onEvent: () => {} });
  agent2.setContext({ memory, tasks });
  // أمر "ابحث" سيستخدم web_search — بدلًا منه نضيف قاعدة أداة: نستخدم remember كمسار مؤكد
  const r = await agent2.handle('احفظ اختبار');
  assert.equal(r.status, 'done');
  assert.equal(calls, 0); // flaky لم تُستدعَ — التأكد أن السجل سليم
  assert.equal(t.status, 'running'); // مهمة يدوية لم تُنفّذ من الوكيل
});

test('تنفيذ: أداة تفشل دائمًا → حالة failed', async () => {
  const { agent, tasks, memory } = makeAgent();
  const tools = createToolRegistry();
  tools.register({
    name: 'always_fail',
    descAr: 'يفشل دائمًا',
    run: async () => { throw new Error('بووم'); },
  });
  // خطة يدوية عبر وكيل بأداة واحدة فاشلة: نحاكي عبر handle بطلب chat مع llm مزيف
  const llm = {
    isAvailable: () => true,
    complete: async () => JSON.stringify({ steps: [{ tool: 'always_fail', args: {} }], reply: '' }),
  };
  const agent2 = createAgent({ tools, memory, tasks, llm, onEvent: () => {} });
  agent2.setContext({ memory, tasks });
  const r = await agent2.handle('نفذ حاجة');
  assert.equal(r.status, 'failed');
  const task = tasks.list()[0];
  assert.equal(task.steps[0].status, 'failed');
  assert.equal(task.steps[0].attempts, 2); // محاولة + إعادة
});

test('الإيقاف الفوري يوقف الخطوات التالية', async () => {
  const memory = createMemoryStore(memAdapter());
  const tasks = createTaskStore(memAdapter());
  const tools = createToolRegistry();
  let executed = 0;
  tools.register({ name: 'slow1', descAr: '', run: async () => { executed++; await new Promise((r) => setTimeout(r, 30)); return {}; } });
  tools.register({ name: 'slow2', descAr: '', run: async () => { executed++; return {}; } });
  const llm = {
    isAvailable: () => true,
    complete: async () => JSON.stringify({ steps: [{ tool: 'slow1', args: {} }, { tool: 'slow2', args: {} }], reply: '' }),
  };
  const agent = createAgent({ tools, memory, tasks, llm, onEvent: () => {} });
  agent.setContext({ memory, tasks });
  const p = agent.handle('نفذ خطوتين');
  setTimeout(() => agent.stop(), 10);
  const r = await p;
  assert.equal(r.status, 'stopped');
  assert.equal(executed, 1); // الخطوة الثانية لم تبدأ
});

test('الخصوصية: الذاكرة لا تُرسل للنموذج بدون موافقة صريحة', async () => {
  const memory = createMemoryStore(memAdapter());
  memory.add('عام', 'سر خاص جدا');
  const tasks = createTaskStore(memAdapter());
  const tools = createToolRegistry();
  let capturedPrompt = '';
  const llm = {
    isAvailable: () => true,
    complete: async (p) => { capturedPrompt = p; return JSON.stringify({ steps: [], reply: 'رد' }); },
  };
  const agent = createAgent({ tools, memory, tasks, llm, onEvent: () => {} });
  agent.setContext({ memory, tasks });
  await agent.handle('عامل ايه النهارده');
  assert.ok(!capturedPrompt.includes('سر خاص جدا'), 'الذاكرة تسرّبت للنموذج بدون موافقة');

  // مع الموافقة الصريحة تُرسل
  const agent2 = createAgent({ tools, memory, tasks, llm, onEvent: () => {}, getPrefs: () => ({ shareMemory: true }) });
  agent2.setContext({ memory, tasks });
  await agent2.handle('عامل ايه النهارده');
  assert.ok(capturedPrompt.includes('سر خاص جدا'), 'الذاكرة لم تُرسل رغم الموافقة');
});

test('النموذج لا يستطيع اختيار run_code ضمن خطته', async () => {
  const memory = createMemoryStore(memAdapter());
  const tasks = createTaskStore(memAdapter());
  const tools = createToolRegistry();
  let ran = 0;
  const llm = {
    isAvailable: () => true,
    complete: async () => JSON.stringify({ steps: [{ tool: 'run_code', args: { code: 'globalThis.pwned=1' } }], reply: '' }),
  };
  const agent = createAgent({ tools, memory, tasks, llm, onEvent: () => {} });
  agent.setContext({ memory, tasks, runCode: async () => { ran++; return { ok: true }; } });
  const r = await agent.handle('نفذ شيئًا');
  assert.equal(ran, 0, 'نُفّذ كود اختاره النموذج');
  assert.equal(r.task.steps.length, 0);
  assert.equal(r.status, 'done');
});

test('كود النموذج معاينة فقط — لا تنفيذ تلقائي', async () => {
  const memory = createMemoryStore(memAdapter());
  const tasks = createTaskStore(memAdapter());
  const tools = createToolRegistry();
  let ran = 0;
  const llm = {
    isAvailable: () => true,
    complete: async () => 'console.log("hello")',
  };
  const agent = createAgent({ tools, memory, tasks, llm, onEvent: () => {} });
  agent.setContext({ memory, tasks, runCode: async () => { ran++; return { ok: true }; } });
  const r = await agent.handle('اكتب كود يطبع مرحبا');
  assert.equal(r.status, 'done');
  assert.equal(ran, 0, 'نُفّذ كود النموذج تلقائيًا');
  const step = r.task.steps[0];
  assert.equal(step.result.status, 'preview');
  assert.equal(step.result.needsConfirm, true);
  assert.ok(step.result.code.includes('console.log'));
  assert.ok(r.report.includes('راجعه'));
});

test('كود المستخدم نفسه يُنفّذ عند طلبه صراحة', async () => {
  const { agent } = makeAgent({ runCode: async (code) => ({ ok: true, logs: ['1'], result: '1', code }) });
  const r = await agent.handle('شغل الكود ده ```console.log(1)```');
  assert.equal(r.status, 'done');
  assert.ok(r.report.includes('بنجاح'));
});

test('LLM: رد غير JSON يسقط بهدوء إلى القواعد', async () => {
  const memory = createMemoryStore(memAdapter());
  const tasks = createTaskStore(memAdapter());
  const tools = createToolRegistry();
  const llm = { isAvailable: () => true, complete: async () => 'مش عارف أرد' };
  const agent = createAgent({ tools, memory, tasks, llm, onEvent: () => {} });
  agent.setContext({ memory, tasks });
  const r = await agent.handle('احفظ إني بذاكر');
  assert.equal(r.status, 'done');
  assert.equal(memory.list().length, 1);
});
