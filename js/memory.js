// memory.js — مخزن الذاكرة المحلية (يعمل في المتصفح وفي Node للاختبار)
// يعتمد على محوّل تخزين: localStorage في المتصفح، أو Map في الاختبارات.

export const MEMORY_CATEGORIES = [
  'أسلوب الكلام',
  'مشاريع',
  'مهام',
  'أدوات ومشاكل',
  'عام',
];

const KEY = 'mosaadi.memory.v1';

function makeAdapter() {
  if (typeof localStorage !== 'undefined') return localStorage;
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export function createMemoryStore(adapter = makeAdapter()) {
  let items = load();

  function load() {
    try {
      const raw = adapter.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function persist() {
    adapter.setItem(KEY, JSON.stringify(items));
  }

  function add(category, text) {
    const cleanCategory = MEMORY_CATEGORIES.includes(category) ? category : 'عام';
    const item = {
      id: 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      category: cleanCategory,
      text: String(text).trim(),
      createdAt: new Date().toISOString(),
    };
    if (!item.text) return null;
    items.push(item);
    persist();
    return item;
  }

  function update(id, patch) {
    const it = items.find((x) => x.id === id);
    if (!it) return null;
    if (patch.text != null) it.text = String(patch.text).trim();
    if (patch.category != null && MEMORY_CATEGORIES.includes(patch.category)) {
      it.category = patch.category;
    }
    persist();
    return it;
  }

  function remove(id) {
    const before = items.length;
    items = items.filter((x) => x.id !== id);
    persist();
    return items.length < before;
  }

  function list(category) {
    if (!category) return [...items];
    return items.filter((x) => x.category === category);
  }

  function clear() {
    items = [];
    persist();
  }

  function summary() {
    if (!items.length) return '';
    return items.map((x) => `- [${x.category}] ${x.text}`).join('\n');
  }

  return { add, update, remove, list, clear, summary };
}
