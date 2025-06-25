const enum WorkerSerializeType {
  Value = 0,  // regular primitive value and object, handled by structuredClone
  Undefined,
  Object,
  Array,
  Error, // error, might contains message, code, errno, syscall
  Function,  // not really supported
  ArrayBuffer,
  Uint8Array,
}

export function workerSerialize(input: any) {
  const transferable = [] as Transferable[];
  function handleValue(val: any): [t: WorkerSerializeType, ...v: any] {
    if (val === undefined) return [WorkerSerializeType.Undefined];
    if (val === null || typeof val !== 'object') return [WorkerSerializeType.Value, val];
    if (val instanceof Error) return [WorkerSerializeType.Error, { ...val, message: val.message, stack: val.stack }];
    if (typeof val === 'function') return [WorkerSerializeType.Function];
    if (val instanceof ArrayBuffer) return transferable.push(val), [WorkerSerializeType.ArrayBuffer, val];
    if (val instanceof Uint8Array) return transferable.push(val.buffer), [WorkerSerializeType.Uint8Array, { buffer: val.buffer, byteOffset: val.byteOffset, byteLength: val.byteLength }];
    if (Array.isArray(val)) return [WorkerSerializeType.Array, val.map(handleValue)];
    return [WorkerSerializeType.Object, Object.keys(val).map((k) => [k, handleValue(val[k])])];
  }

  return {
    transferable,
    value: handleValue(input),
  }
}

export function workerDeserialize(serializedValue: any) {
  function handleValue([t, v]: [WorkerSerializeType, ...any[]]): any {
    switch (t) {
      case WorkerSerializeType.Value: return v; // assuming already structuredCloned by postMessage
      case WorkerSerializeType.Undefined: return undefined;
      case WorkerSerializeType.Object: return Object.fromEntries(v.map((arr: [string, any]) => [arr[0], handleValue(arr[1])]));
      case WorkerSerializeType.Array: return v.map(handleValue);
      case WorkerSerializeType.Error: return Object.assign(new Error(v.message), v);
      case WorkerSerializeType.Function: return function () { throw new Error('Function not supported') };
      case WorkerSerializeType.ArrayBuffer: return v
      case WorkerSerializeType.Uint8Array: return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
  }
  return handleValue(serializedValue);
}

export async function handleCommand(fn: (...args: any[]) => any, payload: PayloadType) {
  const { args, transferable: originalTransferable, port } = payload;

  const transferable = [...originalTransferable];
  let ans: [boolean, any];

  try {
    const result = await fn(...workerDeserialize(args));
    const serializedResult = workerSerialize(result);
    transferable.push(...serializedResult.transferable);
    ans = [true, serializedResult.value];
  } catch (e) {
    const serializedError = workerSerialize(e);
    transferable.push(...serializedError.transferable);
    ans = [false, serializedError.value];
  }

  port.postMessage(ans, [...new Set(transferable)]);
  port.close();
}

export async function sendCommandAndExecute<Args = any[], Ret = any>(
  postMessage: (data: any, transferable: Transferable[]) => void,
  args: Args,
) {
  const serializedArgs = workerSerialize(args);
  const ch = new MessageChannel();

  const resultPromise = new Promise<Ret>((resolve, reject) => {
    ch.port1.onmessage = function (e) {
      const [isSuccess, raw] = e.data;
      const res = workerDeserialize(raw);
      if (!isSuccess) reject(res);
      else resolve(res);
    }
    ch.port1.start();
  })

  const transferable = [...new Set(serializedArgs.transferable)]
  const payload: PayloadType = { args: serializedArgs.value, transferable, port: ch.port2 };
  postMessage(payload, [
    ch.port2,
    ...transferable,
  ])

  return await resultPromise;
}

type PayloadType = {
  args: any;  // `.value` from workerSerialize
  transferable: Transferable[]; // transferable objects that need to return ownership
  port: MessagePort; // send result via this, format: [isSuccess, resOrErr]
}


export type PickMethods<T> = { [K in keyof T]: AsycifyMethod<T[K]> }
type AsycifyMethod<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
