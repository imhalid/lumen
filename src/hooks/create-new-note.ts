import { useLocation, useMatch } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useCallback } from "react"
import { createEntityDialogAtom } from "../global-state"
import { parseQuery } from "../utils/search"

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
  const location = useLocation()
  const tags = useTagsFromRoute()
  const setDialog = useSetAtom(createEntityDialogAtom)

  const currentFolder =
    typeof (location.search as { folder?: string })?.folder === "string"
      ? (location.search as { folder: string }).folder
      : undefined

  return useCallback(() => {
    setDialog({ open: true, kind: "note", currentFolder, tags })
  }, [currentFolder, setDialog, tags])
}

/** Creates a new folder in state only (no file/push). Folder appears in UI until a note is created inside it. */
export function useCreateNewFolder(currentFolder?: string) {
  const setDialog = useSetAtom(createEntityDialogAtom)

  return useCallback(() => {
    setDialog({ open: true, kind: "folder", currentFolder })
  }, [currentFolder, setDialog])
}
