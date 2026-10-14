import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServiceError } from '@/services/http'

interface AsyncOptions<T> {
  /** Skip the request on mount. */
  lazy?: boolean
  onSuccess?: (data: T) => void
  onError?: (error: ServiceError) => void
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  options: AsyncOptions<T> = {},
) {
  const { lazy = false, onSuccess, onError } = options
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ServiceError | null>(null)
  const [loading, setLoading] = useState(!lazy)
  const mounted = useRef(true)

  const run = useCallback(
    async (...args: Parameters<typeof fn>) => {
      setLoading(true)
      setError(null)
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const result = await fn(...(args as []))
        if (mounted.current) {
          setData(result)
          setLoading(false)
          onSuccess?.(result)
        }
        return result
      } catch (caught) {
        const err = caught as ServiceError
        if (mounted.current) {
          setError(err)
          setLoading(false)
          onError?.(err)
        }
        throw caught
      }
    },
    [fn, onSuccess, onError],
  )

  useEffect(() => {
    mounted.current = true
    if (!lazy) void run()
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, run }
}