export function escapeRegExp(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

export function cloneDeep<T>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(cloneDeep) as any;
  if (obj instanceof Set) return new Set(Array.from(obj).map(cloneDeep)) as any;
  return { ...obj }
}

export function toPairs<T>(obj: Record<string, T> | null | undefined) {
  if (!obj) return [];
  return Object.entries(obj) as [string, T][];
}

/**
 * given full path like `@lyonbot/bundler-in-browser/foo/bar.js`, 
 * 
 * return `['@lyonbot/bundler-in-browser', 'foo/bar.js']`
 */
export function pathToNpmPackage(fullPath: string): [packageName: string, importedPath: string] {
  let fullPathSplitted = fullPath.split('/', 2);
  let packageName = fullPath[0] === '@' ? fullPathSplitted.join('/') : fullPathSplitted[0];
  let importedPath = fullPath.slice(packageName.length + 1) // remove leading slash

  return [packageName, importedPath];
}

export class ParallelTasksError extends Error {
  constructor(public errors: any[]) {
    const message = errors.length > 1 ? `Parallel tasks met ${errors.length} errors` : errors[0]?.message;
    super(message || 'Parallel task error', { cause: errors });
  }
}

/**
 * make a parallel task manager
 * 
 * it run tasks in limited concurrency. during running, you can push more tasks to the queue.
 */
export function makeParallelTaskMgr() {
  const queue: (() => Promise<void>)[] = [];

  let maxConcurrency = 0;
  let currentCurrency = 0;
  let onLastWorkerExit: undefined | (() => void);  // undefined means not running
  let errors: any[] = [];

  function fillUpWorker() {
    while (currentCurrency < maxConcurrency && queue.length) {
      currentCurrency++;
      (async () => {
        while (queue.length) {
          let fn = queue.shift();
          if (!fn) break;

          await Promise.resolve().then(fn).catch(e => errors.push(e));
        }

        currentCurrency--;
        if (currentCurrency === 0 && onLastWorkerExit) onLastWorkerExit();
      })();
    }
  }

  const push = (fn: () => Promise<void>) => {
    queue.push(fn);
    if (onLastWorkerExit) fillUpWorker();
  }
  const run = async (concurrency: number = 5) => {
    if (onLastWorkerExit) throw new Error("Already running");
    maxConcurrency = concurrency;

    const promise = new Promise<void>((resolve, reject) => {
      onLastWorkerExit = () => {
        onLastWorkerExit = undefined;
        if (errors.length) {
          reject(new ParallelTasksError(errors));
        } else {
          resolve();
        }
      };
    });

    fillUpWorker();
    await promise;
  }

  return {
    push,
    run,
  }
}

/** 
 * given a cjs module source, wrap it into a IIFE (like `(()=>{...}())` wrapped in bracket), whose value is `module.exports`
 * 
 * beware `require` is not defined inside.
 */
export function wrapCommonJS(code: string) {
  return `((modules => ((exports=>{${code}\n})(modules.exports), modules.exports))({exports:{}}))`
}

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

  return memoFn;
}

/**
 * add prefix to error message, and throw it
 */
export function rethrowWithPrefix(e: any, prefix: string): never {
  if (e instanceof Error) {
    e.message = `${prefix}: ${e.message}`;
    throw e;
  }
  throw new Error(`${prefix}: ${e?.message ?? e?.text ?? e}`, { cause: e });
}
