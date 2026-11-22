// tools.js — سجل الأدوات القابلة للتنفيذ من المتصفح
// كل أداة: { name, descAr, needsService?, run(args, ctx) }
// ctx يوفّر: memory, tasks, llm, speak, download, openTab, fetchText, confirmAction

// ---------- دوال نقية (قابلة للاختبار في Node) ----------

// تقسيم قصة إلى مشاهد مرقّمة (سيناريو)
export function splitIntoScenes(story, maxScenes = 8) {
  const text = String(story || '').trim();
  if (!text) return [];
  const parts = text
    .split(/(?<=[.!؟?\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= maxScenes) {
    return parts.map((p, i) => ({ scene: i + 1, text: p }));
  }
  const scenes = [];
  const per = Math.ceil(parts.length / maxScenes);
  for (let i = 0; i < parts.length; i += per) {
    scenes.push({ scene: scenes.length + 1, text: parts.slice(i, i + per).join(' ') });
  }
  return scenes;
}

// بناء رابط توليد صورة مجاني (pollinations.ai — بدون مفتاح)
export function buildImageUrl(prompt, { width = 768, height = 768 } = {}) {
  const p = encodeURIComponent(String(prompt || '').trim());
  return `https://image.pollinations.ai/prompt/${p}?width=${width}&height=${height}&nologo=true`;
}

// بناء رابط بحث ويكيبيديا
export function wikiApiUrl(query, lang = 'ar') {
  const q = encodeURIComponent(String(query || '').trim());
  return `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&origin=*&srlimit=3`;
}

// سكربت الـ Worker الذي يشغّل كود المستخدم بأمان نسبي داخل المتصفح
export const CODE_RUNNER_WORKER_SOURCE = `
self.onmessage = function (e) {
  const code = e.data && e.data.code;
  const logs = [];
  const fakeConsole = {
    log: (...a) => logs.push(a.map(stringify).join(' ')),
    error: (...a) => logs.push('خطأ: ' + a.map(stringify).join(' ')),
    warn: (...a) => logs.push('تنبيه: ' + a.map(stringify).join(' ')),
  };
  function stringify(v) {
    try { return typeof v === 'object' ? JSON.stringify(v) : String(v); }
    catch { return '[object]'; }
  }
  try {
    const fn = new Function('console', '"use strict";\\n' + code);
    const result = fn(fakeConsole);
    self.postMessage({ ok: true, logs, result: result === undefined ? null : stringify(result) });
  } catch (err) {
    self.postMessage({ ok: false, logs, error: String(err && err.message || err) });
  }
};
`;

// ---------- سجل الأدوات ----------

export function createToolRegistry() {
  const tools = new Map();

  function register(tool) {
    tools.set(tool.name, tool);
  }

  // 1) بحث في الإنترنت (ويكيبيديا مجانية عبر API، وبديل: فتح بحث جوجل)
  register({
    name: 'web_search',
    descAr: 'بحث في الإنترنت (ويكيبيديا) وفتح نتائج بحث عامة',
    run: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('لا يوجد نص للبحث');
      const out = { query, summaries: [], openedTab: false };
      try {
        const data = await ctx.fetchJson(wikiApiUrl(query, 'ar'));
        const hits = (data.query && data.query.search) || [];
        for (const h of hits) {
          out.summaries.push({
            title: h.title,
            snippet: String(h.snippet || '').replace(/<[^>]+>/g, ''),
            url: `https://ar.wikipedia.org/wiki/${encodeURIComponent(h.title)}`,
          });
        }
      } catch (e) {
        out.wikiError = String(e && e.message || e);
      }
      if (!out.summaries.length) {
        // لا نتائج عربية — جرّب الإنجليزية
        try {
          const data = await ctx.fetchJson(wikiApiUrl(query, 'en'));
          const hits = (data.query && data.query.search) || [];
          for (const h of hits) {
            out.summaries.push({
              title: h.title,
              snippet: String(h.snippet || '').replace(/<[^>]+>/g, ''),
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title)}`,
            });
          }
        } catch (e) {
          out.wikiError = out.wikiError || String(e && e.message || e);
        }
      }
      return out;
    },
  });

  // 2) فتح رابط أو تطبيق ويب في تبويب جديد
  register({
    name: 'open_url',
    descAr: 'فتح رابط في تبويب جديد',
    run: async (args, ctx) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('الرابط غير صالح: ' + url);
      ctx.openTab(url);
      return { opened: url };
    },
  });

  // 3) إنشاء مستند/ملف (نص / ماركداون / CSV) وتنزيله
  register({
    name: 'create_document',
    descAr: 'إنشاء ملف نصي أو جدول CSV وتنزيله',
    run: async (args, ctx) => {
      const title = String(args.title || 'مستند').trim();
      const content = String(args.content || '');
      if (!content.trim()) throw new Error('لا يوجد محتوى للملف');
      const format = ['md', 'txt', 'csv'].includes(args.format) ? args.format : 'md';
      const safeName = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || 'document';
      const mime = format === 'csv' ? 'text/csv' : format === 'txt' ? 'text/plain' : 'text/markdown';
      const fileName = `${safeName}.${format}`;
      ctx.download(fileName, content, mime);
      return { fileName, chars: content.length };
    },
  });

  // 4) تحويل قصة إلى سيناريو مشاهد
  register({
    name: 'story_to_script',
    descAr: 'تحويل قصة إلى سيناريو مقسّم إلى مشاهد',
    run: async (args) => {
      const scenes = splitIntoScenes(args.story, args.maxScenes || 8);
      if (!scenes.length) throw new Error('لا توجد قصة للتحويل');
      const script = scenes.map((s) => `المشهد ${s.scene}: ${s.text}`).join('\n\n');
      return { scenes: scenes.length, script };
    },
  });

  // 5) كتابة وتشغيل كود JavaScript داخل المتصفح واكتشاف الأخطاء
  register({
    name: 'run_code',
    descAr: 'تشغيل كود JavaScript واكتشاف الأخطاء',
    run: async (args, ctx) => {
      const code = String(args.code || '');
      if (!code.trim()) throw new Error('لا يوجد كود للتشغيل');
      return ctx.runCode(code, 5000);
    },
  });

  // 6) توليد صورة مجانًا (pollinations.ai)
  register({
    name: 'generate_image',
    descAr: 'توليد صورة من وصف نصي (خدمة مجانية)',
    run: async (args) => {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) throw new Error('لا يوجد وصف للصورة');
      return { prompt, imageUrl: buildImageUrl(prompt) };
    },
  });

  // 7) الذاكرة: حفظ معلومة
  register({
    name: 'remember',
    descAr: 'حفظ معلومة في الذاكرة',
    run: async (args, ctx) => {
      const item = ctx.memory.add(args.category || 'عام', args.text || '');
      if (!item) throw new Error('لا يوجد نص للحفظ');
      return { saved: item.text, category: item.category };
    },
  });

  // 8) الذاكرة: استرجاع
  register({
    name: 'recall',
    descAr: 'استرجاع ما هو محفوظ في الذاكرة',
    run: async (args, ctx) => {
      const items = ctx.memory.list();
      return { count: items.length, summary: ctx.memory.summary() };
    },
  });

  // 9) خطة متعددة الخطوات (المساعد نفسه ينفّذها)
  register({
    name: 'make_plan',
    descAr: 'إنشاء خطة خطوات وتنفيذها بالترتيب',
    run: async (args) => ({ steps: args.steps || [] }),
  });

  // 10) محتوى يوتيوب: أفكار/سكربت/وصف (نصي)
  register({
    name: 'youtube_content',
    descAr: 'إنشاء أفكار وسكربت ووصف لفيديو يوتيوب',
    run: async (args, ctx) => {
      const topic = String(args.topic || '').trim();
      if (!topic) throw new Error('لا يوجد موضوع');
      if (ctx.llm && ctx.llm.isAvailable()) {
        const text = await ctx.llm.complete(
          `اكتب لي 5 أفكار عناوين جذابة وسكربت قصير (مقدمة، 3 نقاط، خاتمة) ووصف يوتيوب عن: ${topic}. أجب بالعربية.`,
          { maxTokens: 900 }
        );
        return { topic, content: text };
      }
      // بديل بدون نموذج: قالب جاهز
      const content = [
        `أفكار عناوين عن «${topic}»:`,
        `1. ${topic} — الحقيقة الكاملة`,
        `2. 5 أشياء لا تعرفها عن ${topic}`,
        `3. جرّب ${topic} بطريقة مختلفة`,
        `4. ${topic} للمبتدئين خطوة بخطوة`,
        `5. لماذا الجميع يتحدث عن ${topic}؟`,
        '',
        `سكربت مقترح: مقدمة عن أهمية ${topic}، ثم 3 نقاط رئيسية، ثم خاتمة بدعوة للمشاهدة والاشتراك.`,
        `(أضِف مفتاح OpenRouter في الإعدادات لمحتوى أذكى)`,
      ].join('\n');
      return { topic, content };
    },
  });

  // أدوات تحتاج خدمة خارجية — مواضع جاهزة في الإعدادات
  const stubs = [
    ['generate_video', 'توليد فيديو', 'يحتاج خدمة خارجية مدفوعة أو نموذج محلي — غير متاح حاليًا في النسخة المجانية.'],
    ['email_calendar', 'البريد والتقويم', 'يحتاج ربط حساب Google بصلاحيات Gmail/Calendar — أضِف الربط من الإعدادات عند توفره.'],
    ['youtube_upload', 'رفع فيديوهات يوتيوب', 'يحتاج ربط قناة YouTube عبر Google API — موضع الربط جاهز في الإعدادات.'],
    ['cloud_storage', 'التخزين السحابي', 'يحتاج ربط Google Drive أو بديل مفتوح — موضع الربط جاهز في الإعدادات.'],
    ['phone_control', 'التحكم الكامل في الهاتف', 'غير ممكن من متصفح الويب لأسباب أمنية — يحتاج تطبيق Android أصلي بخدمات إمكانية الوصول.'],
  ];
  for (const [name, descAr, msg] of stubs) {
    register({
      name,
      descAr,
      needsService: msg,
      run: async () => ({ status: 'needs-service', message: msg }),
    });
  }

  return {
    register,
    get: (name) => tools.get(name),
    list: () => [...tools.values()],
    has: (name) => tools.has(name),
  };
}
