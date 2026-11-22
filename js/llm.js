// llm.js — موصّل OpenRouter (اختياري). المفتاح من الإعدادات فقط، لا يوجد أي مفتاح في الكود.

const SETTINGS_KEY = 'mosaadi.settings.v1';
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

export function createLLM({ settings } = {}) {
  function getSettings() {
    if (settings) return settings.getAll();
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function isAvailable() {
    const s = getSettings();
    return Boolean(s.openrouterKey && String(s.openrouterKey).trim());
  }

  function getModel() {
    const s = getSettings();
    return (s.openrouterModel && String(s.openrouterModel).trim()) || DEFAULT_MODEL;
  }

  async function complete(prompt, { maxTokens = 800, temperature = 0.4 } = {}) {
    const s = getSettings();
    const key = s.openrouterKey;
    if (!key) throw new Error('لا يوجد مفتاح OpenRouter — أضِفه من الإعدادات');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('فشل طلب النموذج (' + res.status + '): ' + body.slice(0, 200));
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!text) throw new Error('رد النموذج فارغ');
    return text;
  }

  return { isAvailable, complete, getModel };
}
