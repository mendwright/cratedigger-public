// Plex normalizes a collection's TAG casing independently of its title: a
// crate titled "classic country" tags its member albums "Classic country".
// Any title↔tag comparison must therefore be case-insensitive, or every
// lowercase-titled crate filters to zero albums (bit us 2026-09-14).
export function sameCrateTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function hasCrateTag(tags: readonly string[] | null | undefined, title: string): boolean {
  return (tags ?? []).some((t) => sameCrateTag(t, title))
}
