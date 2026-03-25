type Job<T> = () => Promise<T>;

const queues = new Map<string, Promise<unknown>>();

export function enqueueByKey<T>(key: string, job: Job<T>): Promise<T> {
  const prev = queues.get(key) || Promise.resolve();

  const next = prev
    .catch(() => undefined)
    .then(job)
    .finally(() => {
      if (queues.get(key) === next) {
        queues.delete(key);
      }
    });

  queues.set(key, next);
  return next as Promise<T>;
}
