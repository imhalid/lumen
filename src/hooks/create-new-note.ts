import { useLocation, useMatch, useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useCallback } from "react"
import { globalStateMachineAtom, virtualFoldersAtom } from "../global-state"
import { generateNoteId, isValidNoteId } from "../utils/note-id"
import { parseQuery } from "../utils/search"

/** Slugify a single segment (lowercase, spaces to dashes, collapse dashes) */
function slugifySegment(segment: string): string {
  return segment
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Build path-aware slug from user input (e.g. "Projects / Foo" -> "projects/foo") */
function toSlug(trimmed: string): string {
  const slugSegments = trimmed
    .split("/")
    .map(slugifySegment)
    .filter(Boolean)
  return slugSegments.join("/")
}

function useTagsFromRoute() {
  const tags = new Set<string>()

  const tagMatch = useMatch({ from: "/_appRoot/tags_/$", shouldThrow: false })
  if (tagMatch?.params._splat) {
    tags.add(tagMatch.params._splat)
  }

  const location = useLocation()
  const query = location.search.query ?? ""
  const tagFilters = parseQuery(query).filters.filter((q) => q.key === "tag" && !q.exclude)

  tagFilters.forEach((filter) => {
    filter.values.forEach((tag) => tags.add(tag))
  })

  return Array.from(tags)
}

export function useCreateNewNote() {
  const navigate = useNavigate()
  const location = useLocation()
  const tags = useTagsFromRoute()

  const currentFolder =
    typeof (location.search as { folder?: string })?.folder === "string"
      ? (location.search as { folder: string }).folder
      : undefined

  return useCallback(() => {
    const userInput = window.prompt("New note name")

    if (userInput === null) {
      return
    }

    const trimmed = userInput.trim()

    if (!trimmed) {
      return
    }

    const slug = toSlug(trimmed)

    const baseId = slug || generateNoteId()
    const noteId = currentFolder ? `${currentFolder}/${baseId}` : baseId

    // Validate the resulting note ID against the existing constraints
    if (!isValidNoteId(noteId)) {
      window.alert(`"${noteId}" is not a valid note name.`)
      return
    }

    // Build initial frontmatter for the new note
    const frontmatterLines: string[] = []

    // Use the original trimmed input as the title, JSON-stringified to ensure valid YAML
    frontmatterLines.push(`title: ${JSON.stringify(trimmed)}`)
    frontmatterLines.push("isPrivate: false")

    if (tags.length > 0) {
      frontmatterLines.push(`tags: [${tags.join(", ")}]`)
    }

    const content = `---\n${frontmatterLines.join("\n")}\n---\n\n`

    navigate({
      to: "/notes/$",
      params: { _splat: noteId },
      search: {
        mode: "write",
        query: undefined,
        view: "grid",
        content,
      },
    })
  }, [currentFolder, navigate, tags])
}

/** Creates a new folder in state only (no file/push). Folder appears in UI until a note is created inside it. */
export function useCreateNewFolder(currentFolder?: string) {
  const setVirtualFolders = useSetAtom(virtualFoldersAtom)
  const navigate = useNavigate()

  return useCallback(() => {
    const userInput = window.prompt("New folder name")

    if (userInput === null) return

    const trimmed = userInput.trim()
    if (!trimmed) return

    const slug = toSlug(trimmed)
    if (!slug) return

    const folderPath = currentFolder ? `${currentFolder}/${slug}` : slug

    if (!isValidNoteId(folderPath)) {
      window.alert(`"${folderPath}" is not a valid folder name.`)
      return
    }

    setVirtualFolders((prev) =>
      prev.includes(folderPath) ? prev : [...prev, folderPath].sort((a, b) => a.localeCompare(b)),
    )

    navigate({
      to: "/",
      search: { query: undefined, view: "grid", folder: folderPath },
    })
  }, [currentFolder, navigate, setVirtualFolders])
}
