// tasks.js — سجل المهام (منفّذة / فاشلة / جارية / متوقفة)
// محوّل تخزين مثل memory.js حتى يعمل في المتصفح والاختبارات.

export const TASK_STATUS = ['running', 'done', 'failed', 'stopped'];

const KEY = 'mosaadi.tasks.v1';
const MAX_TASKS = 100;

function makeAdapter() {
  if (typeof localStorage !== 'undefined') return localStorage;
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export function createTaskStore(adapter = makeAdapter()) {
  let tasks = load();

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
    adapter.setItem(KEY, JSON.stringify(tasks.slice(0, MAX_TASKS)));
  }

  function create(text, steps) {
    const task = {
      id: 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      text: String(text).trim(),
      steps: (steps || []).map((s) => ({
        tool: s.tool,
        args: s.args || {},
        status: 'pending', // pending | running | done | failed | skipped
        result: null,
        error: null,
        attempts: 0,
      })),
      status: 'running',
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    tasks.unshift(task);
    persist();
    return task;
  }

  function update(id, patch) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    if (patch.steps) t.steps = patch.steps;
    if (patch.status && TASK_STATUS.includes(patch.status)) t.status = patch.status;
    if (patch.finishedAt !== undefined) t.finishedAt = patch.finishedAt;
    if (patch.report !== undefined) t.report = patch.report;
    persist();
    return t;
  }

  function list(limit = 50) {
    return tasks.slice(0, limit);
  }

  function clear() {
    tasks = [];
    persist();
  }

  return { create, update, list, clear };
}
