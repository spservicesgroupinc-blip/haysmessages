interface PollEnvironment {
  now: () => number; visible: () => boolean; online: () => boolean;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
  listen: (wake: () => void) => () => void;
}

function browserEnvironment(): PollEnvironment {
  return {
    now: Date.now, visible: () => document.visibilityState === 'visible', online: () => navigator.onLine,
    schedule: (callback, delay) => window.setTimeout(callback, delay), cancel: timer => window.clearTimeout(timer),
    listen(wake) {
      window.addEventListener('focus', wake); window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', wake);
      return () => { window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
    },
  };
}

// One request at a time. Count request latency toward the refresh interval,
// slow down hidden tabs, and back off when the backend cannot keep up.
export function startPolling(task: () => Promise<boolean | void>, options: { interval: number; hiddenInterval: number; environment?: PollEnvironment }) {
  const env = options.environment || browserEnvironment();
  let stopped = false, running = false, queued = false, failures = 0, initialized = false;
  let timer: number | undefined;
  function schedule(delay: number) {
    if (timer !== undefined) env.cancel(timer);
    if (!stopped) timer = env.schedule(() => { timer = undefined; void run(); }, delay);
  }
  async function run() {
    if (stopped || running) return;
    if (!env.online() && initialized) { schedule(options.hiddenInterval); return; }
    initialized = true;
    running = true;
    const started = env.now();
    try { failures = await task() === false ? Math.min(failures + 1, 5) : 0; }
    catch { failures = Math.min(failures + 1, 5); }
    finally {
      running = false;
      if (!stopped) {
        const interval = Math.min(30000, (env.visible() ? options.interval : options.hiddenInterval) * 2 ** failures);
        schedule(queued && env.online() && env.visible() ? 0 : Math.max(250, interval - (env.now() - started)));
        queued = false;
      }
    }
  }
  const unlisten = env.listen(() => {
    if (running) queued = true;
    else { if (timer !== undefined) env.cancel(timer); void run(); }
  });
  void run();
  return () => { stopped = true; if (timer !== undefined) env.cancel(timer); unlisten(); };
}
