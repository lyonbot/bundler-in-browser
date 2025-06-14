
/**
 * memoize a function, which will be called with the same arguments, will return the same result.
 * 
 * results may be cleared after a certain time.
 */
export function memoAsync<A extends any[], T>(fn: (...args: A) => Promise<T>, keyGetter?: (...args: A) => string) {
  const cache = new Map<string, [Promise<T>, clearAfter: number]>();
  const toCacheKey = keyGetter || ((...args: A) => JSON.stringify(args));
  const LIFETIME = 3000;

  let clearIntervalTimer: ReturnType<typeof setTimeout> | undefined;
  function clearIfNeeded() {
    let hasUnexpired = false;
    cache.forEach(([, t], k) => {
      if (t > Date.now()) { hasUnexpired = true; return; }
      cache.delete(k);
    })

    if (!hasUnexpired && clearIntervalTimer) {
      clearInterval(clearIntervalTimer);
      clearIntervalTimer = undefined;
    }
  }

  const memoFn = async (...args: A) => {
    let key = toCacheKey(...args);
    let cached = cache.get(key);
    if (cached) {
      cached[1] = Date.now() + LIFETIME;
      return cached[0];
    }

    if (!clearIntervalTimer) clearIntervalTimer = setInterval(clearIfNeeded, LIFETIME / 2);
    cached = [fn(...args), Date.now() + LIFETIME];
    cache.set(key, cached);

    return cached[0];
  }
  memoFn.remove = (...args: A) => {
    let key = toCacheKey(...args);
    cache.delete(key);
  }
  memoFn.clear = () => {
    cache.clear();
  }

  return memoFn;
}
