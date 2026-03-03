/** Slugify a single path segment (lowercase, spaces to dashes, collapse dashes). */
export function slugifySegment(segment: string): string {
  return segment
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Build path-aware slug from user input (e.g. "Projects / Foo" -> "projects/foo"). */
export function toSlugPath(input: string): string {
  const slugSegments = input
    .trim()
    .split("/")
    .map(slugifySegment)
    .filter(Boolean)
  return slugSegments.join("/")
}
