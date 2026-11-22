// agent.js — حلقة الوكيل: فهم الطلب → خطة → تنفيذ → تحقق → تقرير
// نقي وقابل للاختبار في Node (لا يعتمد على DOM).

const MAX_RETRIES_PER_STEP = 1; // إعادة محاولة واحدة ضمن حدود آمنة

// ---------- تحليل النية من النص العربي/الإنجليزي ----------

const INTENT_RULES = [
  {
    intent: 'remember',
    patterns: [/^(اتذكر|احفظ|خزن|افتكر)(?:\s|$)/],
  },
  {
    intent: 'recall',
    patterns: [/^(ايه اللي (في )?الذاكرة|فكرني|ماذا تتذكر|إيه المحفوظ|عرض الذاكرة|what do you remember)/],
  },
  {
    intent: 'generate_image',
    patterns: [/(ارسم|اعمل|ولد|ولّد|أنشئ).*(صور|رسم)|^(صورة|رسمة) /],
  },
  {
    intent: 'youtube_content',
    patterns: [/(يوتيوب|youtube)/i],
  },
  {
    intent: 'story_to_script',
    patterns: [/(سيناريو|مشاهد|سكربت فيديو|حول.*قصة)/],
  },
  {
    intent: 'run_code',
    patterns: [/(اكتب|شغل|نفذ).*(كود|برنامج|سكربت|دالة|function)/, /```/],
  },
  {
    intent: 'create_document',
    patterns: [/(اعمل|أنشئ|اكتب|جهز).*(ملف|مستند|جدول|csv|تقرير|ملاحظات)/],
  },
  {
    intent: 'generate_video',
    patterns: [/(فيديو|video).*(ولد|ولّد|اعمل|أنشئ|اصنع)/, /(ولد|ولّد|اعمل|أنشئ|اصنع).*(فيديو|video)/i],
  },
  {
    intent: 'web_search',
    patterns: [/(ابحث|دور|دوّر|سرش|search|ابحثي|هات معلومات)/i, /^(مين|من هو|من هي|ما هو|ما هي|ايه|إيه|what is|who is)(?:\s|$)/i],
  },
  {
    intent: 'open_url',
    patterns: [/^(افتح|open)\s+(http|\w+\.(com|net|org|io|dev|ai))/i],
  },
  {
    intent: 'make_plan',
    patterns: [/(اعمل خطة|خطة|plan|خطط)/i],
  },
  {
    intent: 'help',
    patterns: [/^(مساعدة|help|ايه اللي تقدر|ماذا تستطيع|قدراتك|الأدوات)/i],
  },
];

export function detectIntent(text) {
  const t = String(text || '').trim();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.intent;
  }
  return 'chat'; // محادثة عامة → LLM إن وُجد، وإلا رد افتراضي
}

// ---------- بناء خطة تنفيذ من النية والنص ----------

export function buildPlan(intent, text, deps = {}) {
  const t = String(text || '').trim();
  switch (intent) {
    case 'remember': {
      const body = t.replace(/^(اتذكر|احفظ|خزن|افتكر)\s+(?:(?:أن|إن|انه|ان)\s+)?/, '').trim();
      const category = /(أسلوب|كلام|اسلوب)/.test(t) ? 'أسلوب الكلام'
        : /(مشروع|مشاريع)/.test(t) ? 'مشاريع'
        : /(مهمة|مهام|مطلوب)/.test(t) ? 'مهام'
        : /(أداة|اداة|مشكلة|مشاكل|خطأ)/.test(t) ? 'أدوات ومشاكل'
        : 'عام';
      return [{ tool: 'remember', args: { text: body, category } }];
    }
    case 'recall':
      return [{ tool: 'recall', args: {} }];
    case 'generate_image': {
      const prompt = t.replace(/(ارسم|اعمل|ولد|ولّد|أنشئ|صورة|رسمة|لي|عن|ل)/g, ' ').replace(/\s+/g, ' ').trim() || t;
      return [{ tool: 'generate_image', args: { prompt } }];
    }
    case 'story_to_script': {
      const story = t.replace(/.*?(سيناريو|مشاهد|سكربت فيديو|حول)[^\n]*[:：]?\s*/s, '').trim() || t;
      return [{ tool: 'story_to_script', args: { story } }];
    }
    case 'run_code': {
      const m = t.match(/```(?:js|javascript)?\n?([\s\S]*?)```/);
      if (m) return [{ tool: 'run_code', args: { code: m[1] } }];
      // طلب كتابة كود بدون كود جاهز → يحتاج LLM
      return [{ tool: 'chat_compose_code', args: { request: t } }];
    }
    case 'create_document':
      return [{ tool: 'chat_compose_document', args: { request: t } }];
    case 'youtube_content':
      return [{ tool: 'youtube_content', args: { topic: t.replace(/(يوتيوب|youtube)/gi, '').trim() || t } }];
    case 'generate_video':
      return [{ tool: 'generate_video', args: { prompt: t } }];
    case 'web_search': {
      const q = t.replace(/(ابحث|دور|دوّر|سرش|search|ابحثي|هات معلومات|عن|على|في الانترنت|في النت)/gi, ' ').replace(/\s+/g, ' ').trim() || t;
      return [{ tool: 'web_search', args: { query: q } }];
    }
    case 'open_url': {
      const m = t.match(/(https?:\/\/\S+|\b[\w-]+\.(?:com|net|org|io|dev|ai)\b)/i);
      const url = m ? (m[1].startsWith('http') ? m[1] : 'https://' + m[1]) : null;
      return [{ tool: 'open_url', args: { url } }];
    }
    case 'make_plan':
      return [{ tool: 'make_plan', args: { steps: [] } }];
    default:
      return []; // chat
  }
}

// ---------- الوكيل ----------

export function createAgent({ tools, memory, tasks, llm = null, onEvent = () => {}, getPrefs = () => ({}) }) {
  let aborted = false;
  let running = false;

  function stop() {
    aborted = true;
  }

  function isRunning() {
    return running;
  }

  // أدوات لا يجوز للنموذج اختيارها تلقائيًا (تتطلب موافقة المستخدم الصريحة)
  const MODEL_FORBIDDEN_TOOLS = new Set(['run_code']);

  async function llmPlan(text) {
    // يطلب من النموذج خطة JSON مقيّدة بالأدوات المتاحة
    const toolList = tools.list()
      .filter((t) => !MODEL_FORBIDDEN_TOOLS.has(t.name))
      .map((t) => `${t.name}: ${t.descAr}`).join('\n');
    // الخصوصية: لا تُرسل الذاكرة المحفوظة إلى الخدمة الخارجية إلا بموافقة صريحة من الإعدادات
    const shareMemory = Boolean(getPrefs().shareMemory);
    const memSummary = shareMemory ? memory.summary() : '';
    const sys = [
      'أنت مساعد شخصي ينفّذ مهام عبر أدوات. أجب بخطة JSON فقط بهذا الشكل:',
      '{"steps":[{"tool":"اسم_الأداة","args":{...}}],"reply":"رد قصير بالعربية"}',
      'الأدوات المتاحة:\n' + toolList,
      'إن لم تناسب أي أداة الطلب أجب بخطوات فارغة ورد محادثة.',
      memSummary ? 'من ذاكرة المستخدم:\n' + memSummary : '',
    ].join('\n');
    const raw = await llm.complete(sys + '\n\nطلب المستخدم: ' + text, { maxTokens: 800 });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('رد النموذج ليس JSON');
    const parsed = JSON.parse(m[0]);
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    // تجاهل أدوات غير موجودة أو محظورة على النموذج
    const safe = steps.filter((s) => s && tools.has(s.tool) && !MODEL_FORBIDDEN_TOOLS.has(s.tool));
    return { steps: safe, reply: typeof parsed.reply === 'string' ? parsed.reply : '' };
  }

  async function executeStep(step) {
    // أدوات مركبة افتراضية (ليست في السجل): توليد محتوى بالنموذج
    if (step.tool === 'chat_compose_code') {
      if (!llm || !llm.isAvailable()) {
        throw new Error('كتابة الكود تحتاج مفتاح OpenRouter — أضِفه من الإعدادات');
      }
      const code = await llm.complete(
        'اكتب كود JavaScript فقط بدون شرح لتنفيذ: ' + step.args.request,
        { maxTokens: 1200 }
      );
      const clean = code.replace(/```(?:js|javascript)?/g, '').trim();
      // لا تنفيذ تلقائي لكود يولّده النموذج — معاينة فقط، والتشغيل بزر من المستخدم
      return { status: 'preview', needsConfirm: true, code: clean };
    }
    if (step.tool === 'chat_compose_document') {
      if (!llm || !llm.isAvailable()) {
        throw new Error('إنشاء المستندات يحتاج مفتاح OpenRouter — أضِفه من الإعدادات');
      }
      const content = await llm.complete(
        'أنشئ المحتوى المطلوب بتنسيق Markdown مناسب: ' + step.args.request,
        { maxTokens: 2000 }
      );
      const docTool = tools.get('create_document');
      const title = (step.args.request.match(/(?:ملف|مستند|تقرير|جدول)\s+(\S+)/) || [])[1] || 'مستند';
      return docTool.run({ title, content, format: 'md' }, ctx);
    }
    const tool = tools.get(step.tool);
    if (!tool) throw new Error('أداة غير معروفة: ' + step.tool);
    return tool.run(step.args || {}, ctx);
  }

  // ctx يُحقن من app.js في المتصفح؛ في الاختبارات تمرّر أدوات وهمية
  let ctx = {};
  function setContext(c) {
    ctx = c || {};
  }

  async function handle(text) {
    if (running) throw new Error('يوجد تنفيذ جارٍ — اضغط إيقاف أولًا');
    running = true;
    aborted = false;

    const intent = detectIntent(text);
    let plan = buildPlan(intent, text);
    let llmReply = '';

    // إن لم توجد خطة قواعد وكان LLM متاحًا → خطة من النموذج
    if ((!plan.length || intent === 'chat') && llm && llm.isAvailable()) {
      try {
        const p = await llmPlan(text);
        plan = p.steps;
        llmReply = p.reply;
      } catch (e) {
        onEvent({ type: 'notice', message: 'تعذّر تخطيط النموذج — سأستخدم القواعد المدمجة' });
      }
    }

    const task = tasks.create(text, plan);
    onEvent({ type: 'task-start', task, intent });

    const results = [];
    let failed = false;

    for (const step of task.steps) {
      if (aborted) {
        step.status = 'skipped';
        continue;
      }
      step.status = 'running';
      step.attempts += 1;
      onEvent({ type: 'step-start', task, step });
      let lastError = null;
      for (let attempt = 0; attempt <= MAX_RETRIES_PER_STEP; attempt++) {
        if (aborted) break;
        try {
          const result = await executeStep(step);
          step.status = 'done';
          step.result = result;
          results.push({ tool: step.tool, ok: true, result });
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (attempt < MAX_RETRIES_PER_STEP) {
            step.attempts += 1;
            onEvent({ type: 'step-retry', task, step, error: String(e && e.message || e) });
          }
        }
      }
      if (lastError) {
        step.status = 'failed';
        step.error = String(lastError && lastError.message || lastError);
        results.push({ tool: step.tool, ok: false, error: step.error });
        failed = true;
      }
      onEvent({ type: 'step-done', task, step });
      tasks.update(task.id, { steps: task.steps });
    }

    const status = aborted ? 'stopped' : failed ? 'failed' : 'done';
    const report = buildReport(intent, results, status, llmReply, plan.length === 0);
    tasks.update(task.id, { steps: task.steps, status, finishedAt: new Date().toISOString(), report });
    onEvent({ type: 'task-done', task, status, report });
    running = false;
    return { task, status, report, results };
  }

  function buildReport(intent, results, status, llmReply, noTools) {
    if (status === 'stopped') return 'تم إيقاف التنفيذ فورًا بطلبك.';
    if (noTools) {
      return llmReply ||
        'فهمت طلبك كمحادثة عامة. أضِف مفتاح OpenRouter من الإعدادات لأجيب بذكاء، أو جرّب أمرًا مثل: ابحث عن…، اعمل ملف…، ارسم صورة…';
    }
    const lines = [];
    if (llmReply) lines.push(llmReply);
    for (const r of results) {
      if (r.ok) lines.push('✅ ' + summarizeResult(r.tool, r.result));
      else lines.push('❌ ' + r.tool + ': ' + r.error);
    }
    return lines.join('\n');
  }

  function summarizeResult(tool, result) {
    if (!result || typeof result !== 'object') return String(result ?? tool);
    switch (tool) {
      case 'web_search': {
        if (result.summaries && result.summaries.length) {
          const top = result.summaries[0];
          return `نتائج البحث عن «${result.query}»: ${top.title} — ${top.snippet.slice(0, 200)}… (${top.url})`;
        }
        return `لم أجد نتائج ويكيبيديا عن «${result.query}». يمكنني فتح بحث جوجل في تبويب جديد.`;
      }
      case 'open_url': return 'فتحت الرابط في تبويب جديد: ' + result.opened;
      case 'create_document': return `أنشأت الملف «${result.fileName}» (${result.chars} حرف) وبدأ تنزيله.`;
      case 'story_to_script': return `حوّلت القصة إلى ${result.scenes} مشهدًا:\n${result.script}`;
      case 'run_code': {
        if (result.ok) {
          const logs = (result.logs || []).join('\n');
          return `الكود اشتغل بنجاح.${result.result ? '\nالناتج: ' + result.result : ''}${logs ? '\nالسجل:\n' + logs : ''}`;
        }
        return 'الكود فشل: ' + result.error;
      }
      case 'generate_image': return `جهّزت رابط توليد الصورة عن «${result.prompt}»: ${result.imageUrl}`;
      case 'remember': return `حفظت في الذاكرة [${result.category}]: ${result.saved}`;
      case 'recall': return result.count ? 'المحفوظ في الذاكرة:\n' + result.summary : 'الذاكرة فارغة حاليًا.';
      case 'youtube_content': return result.content;
      case 'make_plan': return 'الخطة جاهزة.';
      case 'chat_compose_code':
        if (result.status === 'preview') {
          return 'كتبت الكود المطلوب — راجعه بالأسفل واضغط «تشغيل» إذا أردت تنفيذه (كود من نموذج خارجي لا يُنفَّذ تلقائيًا).';
        }
        return 'تم.';
      default:
        if (result.status === 'needs-service') return result.message;
        return JSON.stringify(result);
    }
  }

  return { handle, stop, isRunning, setContext };
}
