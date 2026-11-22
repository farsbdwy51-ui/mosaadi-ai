// settings.js — إعدادات المساعد: المفاتيح، الصوت، اللغة، الخصوصية
// تُحفظ محليًا على جهاز المستخدم فقط (localStorage).

const KEY = 'mosaadi.settings.v1';

export const CONNECTIONS = [
  { id: 'web_speech', name: 'الصوت (استماع + نطق)', status: 'built-in', note: 'يعمل داخل المتصفح مباشرة — مجاني بدون مفتاح' },
  { id: 'wikipedia', name: 'البحث (ويكيبيديا)', status: 'built-in', note: 'مجاني بدون مفتاح' },
  { id: 'pollinations', name: 'توليد الصور (Pollinations)', status: 'built-in', note: 'مجاني بدون مفتاح' },
  { id: 'openrouter', name: 'النموذج الذكي (OpenRouter)', status: 'key', note: 'أضِف مفتاحك لتفعيل التخطيط الذكي وكتابة المحتوى' },
  { id: 'google', name: 'Google: بريد + تقويم + Drive + YouTube', status: 'external', note: 'يحتاج ربط حساب Google بصلاحيات — موضع الربط جاهز هنا عند توفره' },
  { id: 'video_gen', name: 'توليد الفيديو', status: 'external', note: 'يحتاج خدمة خارجية — لا توجد خدمة مجانية موثوقة حاليًا' },
  { id: 'phone_control', name: 'التحكم الكامل في الهاتف', status: 'external', note: 'غير ممكن من متصفح الويب — يحتاج تطبيق Android أصلي' },
];

export function createSettings() {
  function getAll() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  }

  function set(patch) {
    const next = { ...getAll(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function clearAll() {
    localStorage.removeItem(KEY);
  }

  function connectionStatus(id) {
    const s = getAll();
    if (id === 'openrouter') return s.openrouterKey ? 'connected' : 'missing-key';
    const c = CONNECTIONS.find((x) => x.id === id);
    if (!c) return 'unknown';
    if (c.status === 'built-in') return 'connected';
    return 'needs-service';
  }

  return { getAll, set, clearAll, connectionStatus };
}
