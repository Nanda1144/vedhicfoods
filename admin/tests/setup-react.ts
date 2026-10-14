import { act } from 'react'
import { afterEach, beforeEach } from 'vitest'

/**
 * Shared jsdom setup.
 *
 * React refuses to run `act()` unless `IS_REACT_ACT_ENVIRONMENT` is set, and logs
 * a console error for every call otherwise. Component tests set this once here
 * instead of repeating it.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export { act, beforeEach, afterEach }