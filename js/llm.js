// llm.js — موصّل OpenRouter (اختياري). المفتاح من الإعدادات فقط، لا يوجد أي مفتاح في الكود.

const SETTINGS_KEY = 'mosaadi.settings.v1';
const DEFAULT_MODEL = 'openrouter/free';

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
    const model = (s.openrouterModel && String(s.openrouterModel).trim()) || DEFAULT_MODEL;
    // Existing paid-model preferences migrate safely to the free router.
    return model === DEFAULT_MODEL || model.endsWith(':free') ? model : DEFAULT_MODEL;
  }

  async function complete(prompt, { maxTokens = 800, temperature = 0.4 } = {}) {
    const s = getSettings();
    const key = s.openrouterKey;
    if (!key) throw new Error('لا يوجد مفتاح OpenRouter — أضِفه من الإعدادات');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(45000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: getModel(),
        provider: { max_price: { prompt: 0, completion: 0 } },
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) {
      throw new Error('فشل طلب النموذج المجاني (' + res.status + '). راجع المفتاح أو حدود الخدمة.');
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
