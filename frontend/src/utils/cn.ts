export type ClassValue = string | number | false | null | undefined

/** Tiny classname joiner — no dependency, tree-shakeable. */
export function cn(...values: ClassValue[]): string {
  let out = ''
  for (const value of values) {
    if (!value) continue
    out = out ? `${out} ${value}` : String(value)
  }
  return out
}

/** Creates a BEM-ish class helper scoped to a block. */
export function block(base: string) {
  return (element?: string, modifier?: string | false) => {
    let cls = base
    if (element) cls += `__${element}`
    if (modifier) cls += `--${modifier}`
    return cls
  }
}
