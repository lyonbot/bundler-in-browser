import dayjs from "dayjs";

export function promisify<T, ARGS extends any[]>(fn: (...args: [...ARGS, (err: any, result: T) => any]) => void) {
  return (...args: ARGS) => new Promise<T>((resolve, reject) => {
    fn(...args, (err: any, result: T) => {
      if (err) return reject(err);
      resolve(result);
    })
  })
}

export function toPairs<T>(obj: Record<string, T> | null | undefined) {
  if (!obj) return [];
  return Object.entries(obj) as [string, T][];
}

export function mapValues<T, V>(obj: Record<string, T>, fn: (v: T, k: string) => V) {
  return Object.fromEntries(toPairs(obj).map(([k, v]) => [k, fn(v, k)]));
}

export function pathToNpmPackage(fullPath: string): [packageName: string, importedPath: string] {
  let fullPathSplitted = fullPath.split('/', 2);
  let packageName = fullPath[0] === '@' ? fullPathSplitted.join('/') : fullPathSplitted[0];
  let importedPath = fullPath.slice(packageName.length + 1) // remove leading slash

  return [packageName, importedPath];
}

export function makeParallelTaskMgr() {
  const queue: (() => Promise<void>)[] = [];

  const push = (fn: () => Promise<void>) => {
    queue.push(fn);
  }
  const wait = async (concurrency: number = 5) => {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (queue.length) {
          const fn = queue.shift()!;
          await fn();
        }
      })
    )
  }

  return {
    push,
    wait,
  }
}

/** 
 * given a cjs module source, wrap it into a CallExpression, which returns `module.exports` 
 * 
 * beware `require` is not defined inside.
 */
export function wrapCommonJS(code: string) {
  return `((modules => ((exports=>{${code}\n})(modules.exports), modules.exports))({exports:{}}))`
}

export function decodeUTF8(buf: Uint8Array) {
  return new TextDecoder().decode(buf);
}

export function encodeUTF8(str: string) {
  return new TextEncoder().encode(str);
}

export function chunked<T>(arr: T[], size: number) {
  let res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

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

export function log(...args: any[]) {
  console.log(dayjs().format(), ...args);
}
