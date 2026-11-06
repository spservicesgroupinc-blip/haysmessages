const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/polling.ts');

function clock() {
  let time = 0, id = 0, wake;
  const timers = new Map();
  const state = { visible: true, online: true };
  return {
    state, timers,
    environment: { now: () => time, visible: () => state.visible, online: () => state.online,
      schedule: (callback, delay) => { timers.set(++id, { callback, at: time + delay }); return id; },
      cancel: id => timers.delete(id), listen: listener => { wake = listener; return () => { wake = undefined; }; } },
    wake: () => wake?.(),
    async advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } await new Promise(resolve => setImmediate(resolve)); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('foreground polling accounts for request time and never overlaps slow requests or wake events', async () => {
  const { startPolling } = await loaded;
  const c = clock(); let calls = 0, finish;
  const stop = startPolling(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, { interval: 2000, hiddenInterval: 15000, environment: c.environment });
  assert.equal(calls, 1);
  await c.advance(1000); finish(); await c.settle();
  assert.equal([...c.timers.values()][0].at, 2000, 'request time counts toward the refresh window');
  await c.advance(1000); assert.equal(calls, 2);
  c.wake(); c.wake(); await c.advance(5000); assert.equal(calls, 2);
  finish(); await c.settle(); await c.advance(0); assert.equal(calls, 3);
  stop(); finish(); await c.settle();
  assert.equal(c.timers.size, 0);
});

test('failed requests back off, hidden tabs slow down, and reconnect wakes immediately', async () => {
  const { startPolling } = await loaded;
  const c = clock(); let calls = 0, success = false;
  const stop = startPolling(async () => { calls++; return success; }, { interval: 2000, hiddenInterval: 15000, environment: c.environment });
  await c.settle(); assert.equal([...c.timers.values()][0].at, 4000);
  await c.advance(4000); assert.equal([...c.timers.values()][0].at, 12000);
  success = true; c.state.visible = false; c.wake(); await c.settle();
  assert.equal([...c.timers.values()][0].at, 19000);
  c.state.online = false; c.wake(); const before = calls;
  await c.advance(15000); assert.equal(calls, before);
  c.state.online = true; c.state.visible = true; c.wake(); await c.settle();
  assert.equal(calls, before + 1);
  stop();
});

test('an initially offline workspace can load its saved data once without repeatedly polling', async () => {
  const { startPolling } = await loaded;
  const c = clock(); c.state.online = false; let calls = 0;
  const stop = startPolling(async () => { calls++; return false; }, { interval: 2000, hiddenInterval: 15000, environment: c.environment });
  await c.settle(); assert.equal(calls, 1);
  await c.advance(30000); assert.equal(calls, 1);
  stop();
});
