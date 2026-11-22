// اختبارات مخزن الذاكرة
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, MEMORY_CATEGORIES } from '../js/memory.js';

function adapter() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('إضافة واسترجاع', () => {
  const s = createMemoryStore(adapter());
  const item = s.add('مشاريع', 'مشروع مساعدي AI');
  assert.ok(item.id);
  assert.equal(s.list().length, 1);
  assert.equal(s.list('مشاريع').length, 1);
  assert.equal(s.list('مهام').length, 0);
});

test('تصنيف غير معروف يتحول إلى عام', () => {
  const s = createMemoryStore(adapter());
  const item = s.add('تصنيف-غريب', 'نص');
  assert.equal(item.category, 'عام');
});

test('نص فارغ لا يُحفظ', () => {
  const s = createMemoryStore(adapter());
  assert.equal(s.add('عام', '   '), null);
  assert.equal(s.list().length, 0);
});

test('تعديل نص وتصنيف', () => {
  const s = createMemoryStore(adapter());
  const item = s.add('عام', 'قديم');
  s.update(item.id, { text: 'جديد', category: 'مهام' });
  const [got] = s.list();
  assert.equal(got.text, 'جديد');
  assert.equal(got.category, 'مهام');
});

test('حذف عنصر', () => {
  const s = createMemoryStore(adapter());
  const item = s.add('عام', 'x');
  assert.equal(s.remove(item.id), true);
  assert.equal(s.remove('غير-موجود'), false);
  assert.equal(s.list().length, 0);
});

test('مسح الكل', () => {
  const s = createMemoryStore(adapter());
  s.add('عام', 'a');
  s.add('عام', 'b');
  s.clear();
  assert.equal(s.list().length, 0);
});

test('الاستمرارية عبر المحوّل (محاكاة إعادة فتح التطبيق)', () => {
  const shared = adapter();
  const s1 = createMemoryStore(shared);
  s1.add('عام', 'دائمة');
  const s2 = createMemoryStore(shared);
  assert.equal(s2.list().length, 1);
  assert.equal(s2.list()[0].text, 'دائمة');
});

test('summary ينتج ملخصًا نصيًا', () => {
  const s = createMemoryStore(adapter());
  assert.equal(s.summary(), '');
  s.add('أسلوب الكلام', 'بالعربي');
  assert.ok(s.summary().includes('[أسلوب الكلام]'));
  assert.ok(s.summary().includes('بالعربي'));
});

test('التصنيفات الافتراضية موجودة', () => {
  assert.ok(MEMORY_CATEGORIES.includes('أسلوب الكلام'));
  assert.ok(MEMORY_CATEGORIES.includes('مشاريع'));
  assert.ok(MEMORY_CATEGORIES.includes('مهام'));
  assert.ok(MEMORY_CATEGORIES.includes('أدوات ومشاكل'));
  assert.ok(MEMORY_CATEGORIES.includes('عام'));
});
