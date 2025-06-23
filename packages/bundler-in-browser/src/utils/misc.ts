export const toSortedArray = (set: Iterable<string>) => Array.from(set).sort()

export function isNil(obj: any): obj is null | undefined {
  return obj === null || obj === undefined;
}

export function isNotNil<T>(obj: T | null | undefined): obj is NonNullable<T> {
  return obj !== null && obj !== undefined;
}

export type Falsy = false | 0 | '' | null | undefined;

export function isNotEmpty<T extends object>(obj: T | null | undefined): obj is NonNullable<T> {
  if (!obj) return false;
  if (Array.isArray(obj)) return obj.length > 0;
  return Object.keys(obj).length > 0;
}

export function isEmpty<T extends object>(obj: T | null | undefined): obj is T & Falsy {
  return !isNotEmpty(obj);
}

export function toArray<T>(obj: Iterable<T>): NonNullable<T>[]
export function toArray<T>(obj: T): NonNullable<T>[]
export function toArray<T>(obj: Iterable<T> | T): NonNullable<T>[] {
  if (Array.isArray(obj)) return obj.filter(isNotNil) as NonNullable<T>[];
  if (isNil(obj)) return [];
  return [obj as NonNullable<T>];
}

export function pickBy<T extends Record<string, any>>(obj: T | null | undefined, fn: (value: T[keyof T], key: string & keyof T) => boolean): Partial<T> {
  if (!obj) return {};
  const result = {} as Partial<T>;
  for (const key in obj) {
    if (fn(obj[key], key)) result[key] = obj[key];
  }
  return result;
}

export function groupBy<T>(arr: Iterable<T> | undefined | null, keyFn: (x: T) => string) {
  const obj = {} as Record<string, T[]>;
  for (const item of arr || []) {
    const key = keyFn(item);
    (obj[key] ||= []).push(item);
  }
  return obj;
}

export function keyBy<T>(arr: Iterable<T> | undefined | null, keyFn: (x: T) => string) {
  const obj = {} as Record<string, T>;
  for (const item of arr || []) {
    const key = keyFn(item);
    obj[key] = item;
  }
  return obj;
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
 * add prefix to error message, and throw it
 */
export function rethrowWithPrefix(e: any, prefix: string): never {
  if (e instanceof Error) {
    e.message = `${prefix}: ${e.message}`;
    throw e;
  }
  throw new Error(`${prefix}: ${e?.message ?? e?.text ?? e}`, { cause: e });
}
