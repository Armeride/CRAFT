/**
 * In-process operation counters for performance measurement (task 011).
 * Recording is a Map update per call. Counters are per thread: worker-thread work
 * is reported separately through the index manifest timings.
 */
export interface MetricTotals { calls: number; totalMs: number; units: number }

const totals = new Map<string, MetricTotals>();

function record(name: string, elapsedMs: number, units: number): void {
  const current = totals.get(name);
  if (current) { current.calls += 1; current.totalMs += elapsedMs; current.units += units; }
  else totals.set(name, { calls: 1, totalMs: elapsedMs, units });
}

/** Count an event without timing it, e.g. a refused lock. */
export function countMetric(name: string, units = 0): void { record(name, 0, units); }

/** Time an async operation. `units` measures its size (files, bytes) from the result. */
export async function measured<T>(name: string, action: () => Promise<T>, units?: (value: T) => number): Promise<T> {
  const started = performance.now();
  const value = await action();
  record(name, performance.now() - started, units ? units(value) : 0);
  return value;
}

export function measuredSync<T>(name: string, action: () => T, units?: (value: T) => number): T {
  const started = performance.now();
  const value = action();
  record(name, performance.now() - started, units ? units(value) : 0);
  return value;
}

export function metricsSnapshot(): Record<string, MetricTotals> {
  return Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, value]) => [name, { ...value }]));
}

export function resetMetrics(): void { totals.clear(); }
