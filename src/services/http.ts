/**
 * Mock transport layer.
 *
 * Every service in this folder speaks the same async shape a real backend
 * would, so swapping to `fetch` later is a one-file change. Nothing in the
 * UI reaches into `@/data` directly — pages/components consume services.
 */

export interface RequestOptions {
  /** Simulated network latency in ms. */
  delay?: number
  /** 0–1 chance of a simulated failure (used to demo error states). */
  failRate?: number
  /** AbortSignal lets callers cancel in-flight mock requests. */
  signal?: AbortSignal
}

export class ServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new ServiceError('ABORTED', 'Request was cancelled.'))
    })
  })
}

/** Resolves with a deep-ish clone so callers cannot mutate the mock store. */
export async function mockRequest<T>(
  resolver: () => T,
  { delay = 260, failRate = 0 }: RequestOptions = {},
): Promise<T> {
  await sleep(delay)
  if (failRate > 0 && Math.random() < failRate) {
    throw new ServiceError('NETWORK', 'Something went wrong. Please try again.')
  }
  const value = resolver()
  return (typeof structuredClone === 'function' ? structuredClone(value) : value) as T
}

export function notFound(entity: string, id: string): never {
  throw new ServiceError('NOT_FOUND', `${entity} “${id}” could not be found.`)
}
