// اختبارات سجل المهام
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStore } from '../js/tasks.js';

function adapter() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('إنشاء مهمة بخطوات معلّقة', () => {
  const s = createTaskStore(adapter());
  const t = s.create('ابحث عن كذا', [{ tool: 'web_search', args: { query: 'كذا' } }]);
  assert.equal(t.status, 'running');
  assert.equal(t.steps[0].status, 'pending');
  assert.equal(t.steps[0].tool, 'web_search');
});

test('تحديث حالة المهمة والخطوات', () => {
  const s = createTaskStore(adapter());
  const t = s.create('مهمة', [{ tool: 'a' }]);
  t.steps[0].status = 'done';
  s.update(t.id, { steps: t.steps, status: 'done', finishedAt: new Date().toISOString() });
  const [got] = s.list();
  assert.equal(got.status, 'done');
  assert.equal(got.steps[0].status, 'done');
  assert.ok(got.finishedAt);
});

test('حالة غير معروفة لا تُطبّق', () => {
  const s = createTaskStore(adapter());
  const t = s.create('مهمة', []);
  s.update(t.id, { status: 'خيالية' });
  assert.equal(s.list()[0].status, 'running');
});

test('الأحدث أولًا وحد القائمة', () => {
  const s = createTaskStore(adapter());
  s.create('أولى', []);
  s.create('ثانية', []);
  const all = s.list();
  assert.equal(all[0].text, 'ثانية');
  assert.equal(s.list(1).length, 1);
});

test('مسح السجل', () => {
  const s = createTaskStore(adapter());
  s.create('x', []);
  s.clear();
  assert.equal(s.list().length, 0);
});

test('الاستمرارية عبر المحوّل', () => {
  const shared = adapter();
  createTaskStore(shared).create('محفوظة', [{ tool: 't' }]);
  const s2 = createTaskStore(shared);
  assert.equal(s2.list()[0].text, 'محفوظة');
});
