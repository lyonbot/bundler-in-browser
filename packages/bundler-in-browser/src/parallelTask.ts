export class ParallelTasksError extends Error {
  cause!: any[];

  constructor(public errors: any[]) {
    const message = errors.length > 1 ? `Parallel tasks met ${errors.length} errors` : errors[0]?.message;
    super(message || 'Parallel task error', { cause: errors });
  }
}

/**
 * queue tasks then run them under limited concurrency.
 * 
 * during running, you can push more tasks to the queue.
 * 
 * errors will be collected and thrown when all tasks finished.
 */
export function makeParallelTaskMgr() {
  const queue: (() => Promise<void>)[] = [];

  let maxConcurrency = 0;
  let currentCurrency = 0;
  let onLastWorkerExit: undefined | (() => void); // undefined means not running
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

  /** push a task to the queue. can be called while `run()` too. */
  const push = (fn: () => Promise<void>) => {
    queue.push(fn);
    if (onLastWorkerExit) fillUpWorker();
  };

  /** run and wait for all tasks. may throw `ParallelTasksError` if errors found */
  const run = async (concurrency: number = 5) => {
    if (onLastWorkerExit) throw new Error("Already running");
    if (!queue.length) return;

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
  };

  return {
    push,
    run,
  };
}
