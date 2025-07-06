import type { EffectScope, MaybeRefOrGetter } from "vue";
import { effectScope, onScopeDispose, shallowReactive, toValue, watchEffect } from "vue";

/**
 * observe array, if new item added, create a EffectScope and run `mapFn`; if item is removed, the scope will be disposed (aka stopped).
 * 
 * identified with `Object.is` logic. if item duplicates, the scope is created at the first time, and disposed when last item removed.
 * 
 * you can use `onScopeDispose()` in `effect` to do cleanup works, when the item is removed.
 * 
 * null and undefined items are ignored.
 */
export function observeItems<T>(
    arrayRef: MaybeRefOrGetter<Iterable<T | null | undefined>>,
    effect: (item: T) => void
) {
    let records = new Map<T, {
        scope: EffectScope
    }>();

    const watcher = watchEffect(() => {
        const newRecords: typeof records = new Map();
        for (const item of toValue(arrayRef)) {
            if (item === null || item === undefined) continue; // More explicit null check
            if (newRecords.has(item)) continue; // already seen

            let record = records.get(item);
            if (!record) {
                const scope = effectScope();
                scope.run(() => effect(item));
                record = { scope };
            }

            newRecords.set(item, record);
        }

        // Stop scopes for items that are no longer present
        for (const [it, record] of records) {
            if (!newRecords.has(it)) {
                record.scope.stop();
            }
        }
        records = newRecords;
    });

    onScopeDispose(() => {
        watcher.stop();
        for (const record of records.values()) record.scope.stop();
        records.clear();
    });
}

/**
 * create a reactive Map that containing `Set`s
 * 
 * if a Set is emptied, it will be removed from the map.
 */
export function reactiveMapOfSet<K, V>() {
    const map = shallowReactive(new Map<K, Set<V>>());
    return {
        get: (key: K) => Array.from(map.get(key) || []),
        has: (key: K, value: V) => !!map.get(key)?.has(value),
        add: (key: K, value: V) => {
            const set = map.get(key);
            if (set) set.add(value);
            else map.set(key, shallowReactive(new Set([value])));
        },
        delete: (key: K, value: V) => {
            const set = map.get(key);
            if (!set) return false
            const deleted = set.delete(value);
            if (!set.size) map.delete(key);
            return deleted;
        },
        clear: (key: K) => map.delete(key),
        clearAll: () => map.clear(),
        keys: () => map.keys(),
        values: (key: K): Iterable<V> => map.get(key)?.values() || [],
    }
}
