// app.js — ربط كل الوحدات بواجهة المستخدم

import { createMemoryStore, MEMORY_CATEGORIES } from './memory.js';
import { createTaskStore } from './tasks.js';
import { createToolRegistry, CODE_RUNNER_WORKER_SOURCE } from './tools.js';
import { createAgent, detectIntent } from './agent.js';
import { createSpeech } from './speech.js';
import { createSettings, CONNECTIONS } from './settings.js';
import { createLLM } from './llm.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = createSettings();
const memory = createMemoryStore();
const tasks = createTaskStore();
const tools = createToolRegistry();
const llm = createLLM({ settings });

// ---------- سياق تنفيذ الأدوات (متصفح فقط) ----------

function fetchJson(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function download(fileName, content, mime) {
  const blob = new Blob(['﻿' + content], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function openTab(url) {
  window.open(url, '_blank', 'noopener');
}

function runCode(code, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let worker;
    try {
      const blob = new Blob([CODE_RUNNER_WORKER_SOURCE], { type: 'text/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (e) {
      resolve({ ok: false, error: 'تعذّر إنشاء بيئة التشغيل: ' + e.message, logs: [] });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: 'انتهت مهلة التشغيل (5 ثوانٍ) — الكود يحتوي حلقة لا نهائية غالبًا', logs: [] });
    }, timeoutMs);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, error: e.message || 'خطأ غير معروف', logs: [] });
    };
    worker.postMessage({ code });
  });
}

// ---------- الوكيل ----------

const agent = createAgent({
  tools,
  memory,
  tasks,
  llm,
  onEvent: handleAgentEvent,
  getPrefs: () => ({ shareMemory: settings.getAll().llmShareMemory === true }),
});

agent.setContext({ memory, tasks, llm, download, openTab, fetchJson, runCode });

// ---------- الصوت ----------

const speech = createSpeech({
  settings,
  onState: (s) => {
    if (s.listening !== undefined) setStatus(s.listening ? 'listening' : 'idle');
    if (s.speaking !== undefined && s.speaking) setStatus('speaking');
  },
});
speech.warmUp();

// ---------- حالة الواجهة ----------

function setStatus(state) {
  const pill = $('#status-pill');
  const labels = {
    idle: 'جاهز',
    listening: 'أستمع…',
    thinking: 'أفكر…',
    executing: 'أنفّذ…',
    speaking: 'أتكلم…',
    error: 'خطأ',
  };
  pill.textContent = labels[state] || state;
  pill.dataset.state = state;
  $('#mic-btn').classList.toggle('active', state === 'listening');
}

function addMessage(role, text, { images = [] } = {}) {
  const log = $('#chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  div.appendChild(body);
  for (const src of images) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'msg-image';
    img.alt = 'صورة مولّدة';
    img.loading = 'lazy';
    div.appendChild(img);
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function renderCodePreviews(task) {
  for (const step of (task && task.steps) || []) {
    const r = step.result;
    if (step.status === 'done' && r && r.needsConfirm && r.code) {
      const card = document.createElement('div');
      card.className = 'msg assistant';
      const pre = document.createElement('pre');
      pre.className = 'code-preview';
      pre.textContent = r.code;
      const btn = document.createElement('button');
      btn.className = 'btn small primary-inline';
      btn.textContent = '▶ تشغيل الكود';
      const out = document.createElement('div');
      out.className = 'code-output muted';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.textContent = 'جارٍ التنفيذ…';
        try {
          const res = await runCode(r.code, 5000);
          out.textContent = res.ok
            ? '✅ نجح التنفيذ.' + (res.result ? '\nالناتج: ' + res.result : '') + ((res.logs && res.logs.length) ? '\nالسجل:\n' + res.logs.join('\n') : '')
            : '❌ فشل التنفيذ: ' + res.error;
        } catch (e) {
          out.textContent = '❌ خطأ: ' + e.message;
        }
      });
      const body = document.createElement('div');
      body.className = 'msg-body';
      body.appendChild(pre);
      body.appendChild(btn);
      body.appendChild(out);
      card.appendChild(body);
      $('#chat-log').appendChild(card);
      $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
    }
  }
}

function extractImages(task) {
  const urls = [];
  for (const step of (task && task.steps) || []) {
    if (step.status === 'done' && step.result && step.result.imageUrl) {
      urls.push(step.result.imageUrl);
    }
  }
  return urls;
}

function handleAgentEvent(ev) {
  switch (ev.type) {
    case 'task-start':
      setStatus('executing');
      renderTasks();
      break;
    case 'step-retry':
      addMessage('system', `إعادة محاولة الخطوة «${ev.step.tool}» بعد خطأ: ${ev.error}`);
      break;
    case 'task-done': {
      setStatus('idle');
      const images = extractImages(ev.task);
      addMessage('assistant', ev.report, { images });
      renderCodePreviews(ev.task);
      const s = settings.getAll();
      if (s.ttsEnabled !== false) speech.speak(shortForSpeech(ev.report));
      renderTasks();
      break;
    }
    case 'notice':
      addMessage('system', ev.message);
      break;
  }
}

function shortForSpeech(text) {
  const clean = String(text).replace(/https?:\/\/\S+/g, 'الرابط').split('\n')[0];
  return clean.length > 220 ? clean.slice(0, 220) + '…' : clean;
}

// ---------- إرسال أمر ----------

let finalTranscript = '';

async function submitCommand(text) {
  const cmd = String(text || '').trim();
  if (!cmd) return;
  addMessage('user', cmd);
  $('#text-input').value = '';
  setStatus('thinking');
  speech.stopSpeaking(); // مقاطعة: أمر جديد يسكت المساعد
  try {
    await agent.handle(cmd);
  } catch (e) {
    setStatus('error');
    addMessage('system', 'خطأ: ' + e.message);
    setStatus('idle');
  }
}

// ---------- أزرار الصوت ----------

$('#mic-btn').addEventListener('click', () => {
  if (speech.isListening()) {
    speech.stopListening();
    if (finalTranscript.trim()) submitCommand(finalTranscript);
    finalTranscript = '';
    return;
  }
  speech.stopSpeaking();
  finalTranscript = '';
  const ok = speech.startListening({
    onResult: (final, interim) => {
      if (final) finalTranscript += final + ' ';
      $('#text-input').value = (finalTranscript + interim).trim();
    },
    onEnd: () => {
      if (finalTranscript.trim()) {
        const t = finalTranscript;
        finalTranscript = '';
        submitCommand(t);
      }
    },
    onError: (msg) => addMessage('system', msg),
  });
  if (!ok) setStatus('idle');
});

$('#stop-btn').addEventListener('click', () => {
  agent.stop();
  speech.stopAll();
  setStatus('idle');
  addMessage('system', '⏹ تم الإيقاف الفوري لكل شيء.');
});

$('#send-btn').addEventListener('click', () => submitCommand($('#text-input').value));
$('#text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCommand(e.target.value);
});

// اقتراحات سريعة
$$('.chip').forEach((chip) => {
  chip.addEventListener('click', () => submitCommand(chip.dataset.cmd));
});

// ---------- التبويبات ----------

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-page').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#page-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'tasks') renderTasks();
    if (btn.dataset.tab === 'memory') renderMemory();
    if (btn.dataset.tab === 'tools') renderTools();
    if (btn.dataset.tab === 'settings') renderSettings();
  });
});

// ---------- صفحة المهام ----------

function renderTasks() {
  const list = $('#tasks-list');
  const all = tasks.list();
  if (!all.length) {
    list.innerHTML = '<p class="empty">لا توجد مهام بعد.</p>';
    return;
  }
  const statusLabels = { running: 'جارية ⏳', done: 'منفّذة ✅', failed: 'فاشلة ❌', stopped: 'متوقفة ⏹' };
  list.innerHTML = '';
  for (const t of all) {
    const card = document.createElement('div');
    card.className = 'card task-card';
    const stepsHtml = t.steps.length
      ? '<ul class="steps">' + t.steps.map((s) =>
          `<li class="step-${s.status}">${escapeHtml(s.tool)} — ${s.status}${s.error ? ': ' + escapeHtml(s.error) : ''}</li>`
        ).join('') + '</ul>'
      : '<p class="muted">محادثة بدون أدوات</p>';
    card.innerHTML = `
      <div class="card-head">
        <strong>${escapeHtml(t.text.slice(0, 80))}</strong>
        <span class="badge badge-${t.status}">${statusLabels[t.status] || t.status}</span>
      </div>
      ${stepsHtml}
      ${t.report ? `<details><summary>التقرير</summary><p>${escapeHtml(t.report)}</p></details>` : ''}
      <time>${new Date(t.createdAt).toLocaleString('ar-EG')}</time>
    `;
    list.appendChild(card);
  }
}

$('#clear-tasks').addEventListener('click', () => {
  if (confirm('مسح كل سجل المهام؟')) {
    tasks.clear();
    renderTasks();
  }
});

// ---------- صفحة الذاكرة ----------

function renderMemory() {
  const list = $('#memory-list');
  const items = memory.list();
  if (!items.length) {
    list.innerHTML = '<p class="empty">الذاكرة فارغة. قل «احفظ إن…» لأضيف أول معلومة.</p>';
    return;
  }
  list.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card memory-card';
    card.innerHTML = `
      <span class="badge">${escapeHtml(item.category)}</span>
      <p class="mem-text">${escapeHtml(item.text)}</p>
      <div class="card-actions">
        <button class="btn small" data-act="edit">تعديل</button>
        <button class="btn small danger" data-act="del">حذف</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener('click', () => {
      const next = prompt('عدّل النص:', item.text);
      if (next != null && next.trim()) {
        memory.update(item.id, { text: next });
        renderMemory();
      }
    });
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (confirm('حذف هذه المعلومة من الذاكرة؟')) {
        memory.remove(item.id);
        renderMemory();
      }
    });
    list.appendChild(card);
  }
}

$('#add-memory').addEventListener('click', () => {
  const text = $('#new-memory-text').value.trim();
  const category = $('#new-memory-cat').value;
  if (!text) return;
  memory.add(category, text);
  $('#new-memory-text').value = '';
  renderMemory();
});

$('#clear-memory').addEventListener('click', () => {
  if (confirm('مسح كل الذاكرة؟ لا يمكن التراجع.')) {
    memory.clear();
    renderMemory();
  }
});

// تعبئة تصنيفات الذاكرة
const catSelect = $('#new-memory-cat');
for (const c of MEMORY_CATEGORIES) {
  const opt = document.createElement('option');
  opt.value = c;
  opt.textContent = c;
  catSelect.appendChild(opt);
}

// ---------- صفحة الأدوات ----------

function renderTools() {
  const list = $('#tools-list');
  list.innerHTML = '';
  for (const t of tools.list()) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <strong>${escapeHtml(t.name)}</strong>
      <p>${escapeHtml(t.descAr)}</p>
      ${t.needsService ? `<p class="muted">🔌 ${escapeHtml(t.needsService)}</p>` : '<p class="ok">✓ تعمل محليًا</p>'}
    `;
    list.appendChild(card);
  }
}

// ---------- صفحة الإعدادات ----------

function renderSettings() {
  const s = settings.getAll();
  $('#set-openrouter-key').value = s.openrouterKey || '';
  $('#set-openrouter-model').value = s.openrouterModel || '';
  $('#set-language').value = s.language || 'ar-EG';
  $('#set-voice-rate').value = s.voiceRate || 1;
  $('#set-tts').checked = s.ttsEnabled !== false;
  $('#set-share-memory').checked = s.llmShareMemory === true;
}

$('#save-settings').addEventListener('click', () => {
  settings.set({
    openrouterKey: $('#set-openrouter-key').value.trim(),
    openrouterModel: $('#set-openrouter-model').value.trim(),
    language: $('#set-language').value,
    voiceRate: Number($('#set-voice-rate').value) || 1,
    ttsEnabled: $('#set-tts').checked,
    llmShareMemory: $('#set-share-memory').checked === true,
  });
  renderConnections();
  addMessage('system', 'تم حفظ الإعدادات ✓');
});

// قائمة الاتصالات في الإعدادات
function renderConnections() {
  const connList = $('#connections-list');
  connList.innerHTML = '';
  const icons = { connected: '🟢', 'missing-key': '🟡', 'needs-service': '⚪' };
  for (const c of CONNECTIONS) {
    const row = document.createElement('div');
    row.className = 'conn-row';
    const st = settings.connectionStatus(c.id);
    row.innerHTML = `
      <span class="conn-icon">${icons[st] || '⚪'}</span>
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <p class="muted">${escapeHtml(c.note)}</p>
      </div>
    `;
    connList.appendChild(row);
  }
}
renderConnections();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// ---------- معالجة الأخطاء العامة ----------

window.addEventListener('error', (e) => {
  addMessage('system', 'خطأ غير متوقع: ' + (e.message || 'غير معروف'));
  setStatus('error');
});
window.addEventListener('unhandledrejection', (e) => {
  addMessage('system', 'خطأ في عملية: ' + (e.reason && e.reason.message || e.reason || 'غير معروف'));
});

// ---------- ترحيب ----------

addMessage('assistant',
  'أهلًا! أنا مساعدي AI. اضغط الميكروفون وتكلم، أو اكتب أمرك.\n' +
  'أقدر: أبحث في ويكيبيديا، أرسم صورًا، أحوّل قصة لسيناريو، أكتب وأشغّل كود، أنشئ ملفات، وأحفظ معلومات في ذاكرتي.\n' +
  (speech.sttSupported ? '' : '⚠ متصفحك لا يدعم الاستماع الصوتي — استخدم Chrome على Android.\n') +
  (llm.isAvailable() ? '' : '💡 أضِف مفتاح OpenRouter من الإعدادات لعقل أذكى.')
);

// تسجيل الـ Service Worker (PWA) — يتجاهل الفشل بهدوء على file://
// updateViaCache:'none' حتى يتحقق المتصفح من وجود نسخة أحدث في كل زيارة
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
}
