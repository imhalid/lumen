import { Link, useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import React, { useCallback, useMemo, useState } from "react"
import { useInView } from "react-intersection-observer"
import { useDebounce } from "use-debounce"
import { notesAtom, virtualFoldersAtom } from "../global-state"
import { useMoveNotesToFolder } from "../hooks/note"
import { useSearchNotes } from "../hooks/search-notes"
import { parseQuery } from "../utils/search"
import { formatNumber, pluralize } from "../utils/pluralize"
import { Button } from "./button"
import { Checkbox } from "./checkbox"
import { DropdownMenu } from "./dropdown-menu"
import { IconButton } from "./icon-button"
import {
  CheckIcon16,
  ChevronRightIcon16,
  FolderIcon16,
  GlobeIcon16,
  PinFillIcon12,
  TagFillIcon12,
  TagIcon12,
  TagIcon16,
  XIcon12,
} from "./icons"
import { LinkHighlightProvider } from "./link-highlight-provider"
import { NewFolderButton } from "./new-folder-button"
import { NoteFavicon } from "./note-favicon"
import { NotePreviewCard } from "./note-preview-card"
import { PillButton } from "./pill-button"
import { SearchInput } from "./search-input"

type NoteListProps = {
  baseQuery?: string
  folder?: string
  query: string
  onFolderChange?: (folder: string | undefined) => void
  onQueryChange: (query: string) => void
}

const initialVisibleItems = 10

/** Direct children of current folder: note ids that start with folder/ and have no further slash */
function isDirectChildNote(id: string, currentFolder: string): boolean {
  if (!currentFolder) return !id.includes("/")
  if (!id.startsWith(currentFolder + "/")) return false
  const rest = id.slice(currentFolder.length + 1)
  return !rest.includes("/")
}

/** Unique immediate subfolder names under current folder (from note paths) */
function getChildFolderNamesFromNotes(
  notes: Map<string, { id: string }>,
  currentFolder: string,
): string[] {
  const names = new Set<string>()
  for (const id of notes.keys()) {
    if (!currentFolder) {
      if (id.includes("/")) names.add(id.split("/")[0])
    } else {
      if (!id.startsWith(currentFolder + "/")) continue
      const rest = id.slice(currentFolder.length + 1)
      if (rest.includes("/")) names.add(rest.split("/")[0])
    }
  }
  return [...names]
}

/** Direct child folder names from virtual folders list (no files yet) */
function getChildFolderNamesFromVirtual(
  virtualFolders: string[],
  currentFolder: string,
): string[] {
  const names = new Set<string>()
  for (const path of virtualFolders) {
    if (!currentFolder) {
      names.add(path.split("/")[0])
    } else {
      if (!path.startsWith(currentFolder + "/")) continue
      const rest = path.slice(currentFolder.length + 1)
      names.add(rest.split("/")[0])
    }
  }
  return [...names]
}

/** All folder paths (for move picker): prefixes from note ids + virtual folders, sorted. "" = root. */
function getAllFolderPaths(notes: Map<string, { id: string }>, virtualFolders: string[]): string[] {
  const paths = new Set<string>()
  for (const id of notes.keys()) {
    const parts = id.split("/")
    for (let i = 1; i < parts.length; i += 1) {
      paths.add(parts.slice(0, i).join("/"))
    }
  }
  for (const path of virtualFolders) {
    paths.add(path)
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

export function NoteList({
  baseQuery = "",
  folder,
  query,
  onFolderChange = () => {},
  onQueryChange,
}: NoteListProps) {
  const searchNotes = useSearchNotes()
  const notes = useAtomValue(notesAtom)
  const virtualFolders = useAtomValue(virtualFoldersAtom)
  const navigate = useNavigate()
  const moveNotesToFolder = useMoveNotesToFolder()

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<Set<string>>(new Set())

  const [deferredQuery] = useDebounce(query, 150)

  const noteResults = useMemo(() => {
    return searchNotes(`${baseQuery} ${deferredQuery}`)
  }, [searchNotes, baseQuery, deferredQuery])

  const isFolderView = folder !== undefined

  const childFolderNames = useMemo(() => {
    if (!isFolderView) return []
    const fromNotes = getChildFolderNamesFromNotes(notes, folder)
    const fromVirtual = getChildFolderNamesFromVirtual(virtualFolders, folder)
    return [...new Set([...fromNotes, ...fromVirtual])].sort((a, b) => a.localeCompare(b))
  }, [isFolderView, notes, folder, virtualFolders])

  const childNotes = useMemo(() => {
    if (!isFolderView) return noteResults
    return noteResults.filter((note) => isDirectChildNote(note.id, folder))
  }, [noteResults, folder, isFolderView])

  const [numVisibleItems, setNumVisibleItems] = useState(initialVisibleItems)

  const allFolderPaths = useMemo(
    () => getAllFolderPaths(notes, virtualFolders),
    [notes, virtualFolders],
  )

  const toggleNoteSelection = useCallback((id: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleFolderSelection = useCallback((path: string) => {
    setSelectedFolderPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const selectAllVisible = useCallback(() => {
    setSelectedNoteIds(
      new Set(childNotes.slice(0, numVisibleItems).map((n) => n.id)),
    )
  }, [childNotes, numVisibleItems])

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false)
    setSelectedNoteIds(new Set())
    setSelectedFolderPaths(new Set())
  }, [])

  const handleMoveToFolder = useCallback(
    (targetFolder: string) => {
      const idsToMove = new Set<string>()

      // Explicitly selected notes
      for (const id of selectedNoteIds) {
        idsToMove.add(id)
      }

      // All notes under selected folders (including nested)
      for (const folderPath of selectedFolderPaths) {
        for (const id of notes.keys()) {
          if (id === folderPath || id.startsWith(folderPath + "/")) {
            idsToMove.add(id)
          }
        }
      }

      if (idsToMove.size === 0) return

      const result = moveNotesToFolder([...idsToMove], targetFolder)
      if (result.success && result.moved > 0) exitSelectMode()
    },
    [moveNotesToFolder, selectedNoteIds, selectedFolderPaths, notes, exitSelectMode],
  )

  const handleDragStart = useCallback(
    (noteId: string, event: React.DragEvent<HTMLDivElement>) => {
      const idsToMove = new Set<string>()

      // If note is already part of selection, move all selected notes; otherwise just this note
      if (selectedNoteIds.size > 0 && selectedNoteIds.has(noteId)) {
        for (const id of selectedNoteIds) idsToMove.add(id)
      } else {
        idsToMove.add(noteId)
      }

      // Include all notes under selected folders
      for (const folderPath of selectedFolderPaths) {
        for (const id of notes.keys()) {
          if (id === folderPath || id.startsWith(folderPath + "/")) {
            idsToMove.add(id)
          }
        }
      }

      event.dataTransfer.setData(
        "application/x-note-ids",
        JSON.stringify([...idsToMove]),
      )
      event.dataTransfer.effectAllowed = "move"
    },
    [selectedNoteIds, selectedFolderPaths, notes],
  )

  const handleDragOverFolder = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer.types.includes("application/x-note-ids")) {
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
    }
  }, [])

  const handleDropOnFolder = useCallback(
    (targetFolder: string, event: React.DragEvent<HTMLElement>) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData("application/x-note-ids")
      if (!raw) return
      let ids: string[]
      try {
        ids = JSON.parse(raw) as string[]
      } catch {
        return
      }
      const result = moveNotesToFolder(ids, targetFolder)
      if (result.success && result.moved > 0) exitSelectMode()
    },
    [moveNotesToFolder, exitSelectMode],
  )

  const [bottomRef, bottomInView] = useInView()

  const loadMore = React.useCallback(() => {
    setNumVisibleItems((num) => Math.min(num + 10, childNotes.length))
  }, [childNotes.length])

  React.useEffect(() => {
    if (bottomInView) {
      loadMore()
    }
  }, [bottomInView, loadMore])

  const numVisibleTags = 4

  const sortedTagFrequencies = React.useMemo(() => {
    const frequencyMap = new Map<string, number>()

    const tags = childNotes.flatMap((result) => result.tags)

    for (const tag of tags) {
      frequencyMap.set(tag, (frequencyMap.get(tag) ?? 0) + 1)
    }

    const frequencyEntries = [...frequencyMap.entries()]

    return (
      frequencyEntries
        .filter(([, frequency]) => frequency < childNotes.length)
        // Filter out parent tags if the all the childs tag has the same frequency
        .filter(([tag, frequency]) => {
          const childTags = frequencyEntries.filter(
            ([otherTag]) => otherTag !== tag && otherTag.startsWith(tag),
          )

          if (childTags.length === 0) return true

          return !childTags.every(([, otherFrequency]) => otherFrequency === frequency)
        })
        .sort((a, b) => {
          return b[1] - a[1]
        })
    )
  }, [childNotes])

  const filters = React.useMemo(() => {
    return parseQuery(query).filters
  }, [query])

  const tagFilters = React.useMemo(() => {
    return filters.filter((filter) => filter.key === "tag")
  }, [filters])

  const highlightPaths = React.useMemo(() => {
    return filters
      .filter((filter) => !filter.exclude)
      .flatMap((filter) => {
        switch (filter.key) {
          case "tag":
            return filter.values.map((value) => `/tags/${value}`)
          case "link":
            return filter.values.map((value) => `/${value}`)
          case "date":
            return filter.values.map((value) => `/${value}`)
          default:
            return []
        }
      })
  }, [filters])

  const folderSegments =
    isFolderView && folder !== "" ? folder.split("/").filter(Boolean) : []

  return (
    <LinkHighlightProvider href={highlightPaths}>
      <div>
        <div className="flex flex-col gap-4">
          {folderSegments.length > 0 ? (
            <nav
              aria-label="Folder breadcrumb"
              className="flex flex-wrap items-center gap-1 text-sm text-text-secondary"
            >
              <button
                type="button"
                onClick={() => onFolderChange(undefined)}
                className="rounded px-1.5 py-0.5 hover:bg-bg-hover hover:text-text focus-ring"
              >
                Notes
              </button>
              {folderSegments.map((segment, index) => {
                const pathUpToHere = folderSegments.slice(0, index + 1).join("/")
                return (
                  <span key={pathUpToHere} className="flex items-center gap-1">
                    <ChevronRightIcon16 className="shrink-0 text-text-tertiary" />
                    <button
                      type="button"
                      onClick={() => onFolderChange(pathUpToHere)}
                      className="rounded px-1.5 py-0.5 hover:bg-bg-hover hover:text-text focus-ring"
                    >
                      {segment}
                    </button>
                  </span>
                )
              })}
            </nav>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {isSelectMode ? (
              <>
                <Button variant="secondary" size="small" onClick={exitSelectMode} className="shrink-0">
                  <XIcon12 className="mr-1.5" />
                  Cancel
                </Button>
                <span className="text-sm text-text-secondary shrink-0">
                  {selectedNoteIds.size + selectedFolderPaths.size} selected
                </span>
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    render={
                      <Button
                        variant="primary"
                        size="small"
                        disabled={selectedNoteIds.size + selectedFolderPaths.size === 0}
                        className="shrink-0"
                      >
                        <FolderIcon16 className="mr-1.5" />
                        Move to folder
                      </Button>
                    }
                  />
                  <DropdownMenu.Content align="start" width={220}>
                    <DropdownMenu.Item
                      icon={<FolderIcon16 />}
                      onClick={() => handleMoveToFolder("")}
                    >
                      Root
                    </DropdownMenu.Item>
                    {allFolderPaths.map((path) => (
                      <DropdownMenu.Item
                        key={path}
                        icon={<FolderIcon16 />}
                        onClick={() => handleMoveToFolder(path)}
                      >
                        {path}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu>
                {childNotes.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={selectAllVisible}
                    className="shrink-0"
                  >
                    Select all
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <SearchInput
                  placeholder={`Search ${pluralize(childNotes.length, "note")}…`}
                  value={query}
                  autoCapitalize="off"
                  spellCheck="false"
                  onChange={(value) => {
                    onQueryChange(value)
                    setNumVisibleItems(initialVisibleItems)
                  }}
                />
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setIsSelectMode(true)}
                  className="shrink-0"
                  aria-label="Select notes to move"
                >
                  <CheckIcon16 className="mr-1.5" />
                  Select
                </Button>
              </>
            )}
          </div>
          {sortedTagFrequencies.length > 0 || tagFilters.length > 0 || deferredQuery ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 empty:hidden">
                {sortedTagFrequencies.length > 0 || tagFilters.length > 0 ? (
                  <>
                    {tagFilters.map((filter) => (
                      <PillButton
                        key={filter.values.join(",")}
                        data-tag={filter.values.join(",")}
                        variant="primary"
                        onClick={() => {
                          const text = `${filter.exclude ? "-" : ""}tag:${filter.values.join(",")}`

                          const index = query.indexOf(text)

                          if (index === -1) return

                          const newQuery =
                            query.slice(0, index) + query.slice(index + text.length).trimStart()

                          // Remove the tag qualifier from the query
                          onQueryChange(newQuery.trim())

                          // TODO: Move focus
                        }}
                      >
                        <TagFillIcon12 />
                        {filter.exclude ? <span className="italic">not</span> : null}
                        {filter.values.map((value, index) => (
                          <React.Fragment key={value}>
                            {index > 0 ? <span>or</span> : null}
                            <span key={value}>{value}</span>
                          </React.Fragment>
                        ))}
                        <XIcon12 className="-mr-0.5" />
                      </PillButton>
                    ))}
                    {sortedTagFrequencies.slice(0, numVisibleTags).map(([tag, frequency]) => (
                      <PillButton
                        key={tag}
                        data-tag={tag}
                        onClick={(event) => {
                          const qualifier = `${event.shiftKey ? "-" : ""}tag:${tag}`

                          onQueryChange(query ? `${query} ${qualifier}` : qualifier)

                          // Move focus
                          setTimeout(() => {
                            document.querySelector<HTMLElement>(`[data-tag="${tag}"]`)?.focus()
                          })
                        }}
                      >
                        <TagIcon12 className="text-text-secondary" />
                        {tag}
                        <span className="text-text-secondary">{formatNumber(frequency)}</span>
                      </PillButton>
                    ))}
                    {sortedTagFrequencies.length > numVisibleTags ? (
                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          render={
                            <PillButton variant="dashed" className="data-[popup-open]:bg-bg-hover">
                              More…
                            </PillButton>
                          }
                        />
                        <DropdownMenu.Content width={300}>
                          {sortedTagFrequencies.slice(numVisibleTags).map(([tag, frequency]) => (
                            <DropdownMenu.Item
                              key={tag}
                              icon={<TagIcon16 />}
                              trailingVisual={
                                <span className="text-text-secondary epaper:text-current">
                                  {frequency}
                                </span>
                              }
                              onClick={(event) => {
                                const qualifier = `${event.shiftKey ? "-" : ""}tag:${tag}`
                                onQueryChange(query ? `${query} ${qualifier}` : qualifier)
                              }}
                            >
                              {tag}
                            </DropdownMenu.Item>
                          ))}
                        </DropdownMenu.Content>
                      </DropdownMenu>
                    ) : null}
                  </>
                ) : null}
              </div>
              {deferredQuery ? (
                <div className="text-sm text-text-secondary leading-4">
                  {pluralize(childNotes.length, "result")}
                </div>
              ) : null}
            </div>
          ) : null}
          {true ? (
            <ul className="grid grid-cols-1 @[768px]:grid-cols-2 @[1024px]:grid-cols-3 gap-0.5">
              {childFolderNames.map((name) => {
                const folderPath = folder ? `${folder}/${name}` : name
                const isFolderSelected = selectedFolderPaths.has(folderPath)
                return (
                  <li key={folderPath}>
                    {isSelectMode ? (
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(event) => handleDragStart(folderPath, event as any)}
                        onClick={() => toggleFolderSelection(folderPath)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            toggleFolderSelection(folderPath)
                          }
                        }}
                        onDragOver={handleDragOverFolder}
                        onDrop={(event) => handleDropOnFolder(folderPath, event)}
                        className="focus-ring flex h-10 cursor-pointer items-center rounded-lg px-3 hover:bg-bg-hover coarse:h-12 coarse:p-4"
                      >
                        <Checkbox
                          checked={isFolderSelected}
                          onCheckedChange={() => toggleFolderSelection(folderPath)}
                          onClick={(e) => e.stopPropagation()}
                          className="mr-3 coarse:mr-4"
                        />
                        <FolderIcon16 className="mr-3 shrink-0 text-text-secondary coarse:mr-4" />
                        <span className="truncate text-text">{name}</span>
                        <ChevronRightIcon16 className="ml-auto shrink-0 text-text-tertiary" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) =>
                          handleDragStart(folderPath, event as unknown as React.DragEvent<HTMLDivElement>)
                        }
                        onClick={() => onFolderChange(folderPath)}
                        onDragOver={handleDragOverFolder}
                        onDrop={(event) => handleDropOnFolder(folderPath, event)}
                        className="focus-ring flex h-10 w-full items-center rounded-lg px-3 text-left hover:bg-bg-hover coarse:h-12 coarse:p-4"
                      >
                        <FolderIcon16 className="mr-3 shrink-0 text-text-secondary coarse:mr-4" />
                        <span className="truncate text-text">{name}</span>
                        <ChevronRightIcon16 className="ml-auto shrink-0 text-text-tertiary" />
                      </button>
                    )}
                  </li>
                )
              })}
              {childNotes.slice(0, numVisibleItems).map((note) => {
                if (isSelectMode) {
                  return (
                    <li key={note.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(event) => handleDragStart(note.id, event)}
                        onClick={() => toggleNoteSelection(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            toggleNoteSelection(note.id)
                          }
                        }}
                        className="focus-ring flex h-10 cursor-pointer items-center rounded-lg px-3 hover:bg-bg-hover coarse:h-12 coarse:p-4"
                      >
                        <Checkbox
                          checked={selectedNoteIds.has(note.id)}
                          onCheckedChange={() => toggleNoteSelection(note.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mr-3 coarse:mr-4"
                        />
                        <NoteFavicon note={note} className="mr-3 coarse:mr-4" />
                        {note.pinned ? (
                          <PinFillIcon12 className="mr-2 coarse:mr-3 shrink-0 text-text-pinned" />
                        ) : null}
                        {note?.frontmatter?.gist_id ? (
                          <GlobeIcon16 className="mr-2 coarse:mr-3 shrink-0 text-border-focus" />
                        ) : null}
                        <span className="truncate text-text-secondary">
                          <span className="text-text">{note.displayName}</span>
                        </span>
                      </div>
                    </li>
                  )
                }
                return (
                  <li key={note.id}>
                    <Link
                      to="/notes/$"
                      params={{ _splat: note.id }}
                      search={{
                        mode: "read",
                        query: undefined,
                        view: "grid",
                      }}
                      className="focus-ring flex h-10 items-center rounded-lg px-3 hover:bg-bg-hover coarse:h-12 coarse:p-4"
                    >
                      <NoteFavicon note={note} className="mr-3 coarse:mr-4" />
                      {note.pinned ? (
                        <PinFillIcon12 className="mr-2 coarse:mr-3 shrink-0 text-text-pinned" />
                      ) : null}
                      {note?.frontmatter?.gist_id ? (
                        <GlobeIcon16 className="mr-2 coarse:mr-3 shrink-0 text-border-focus" />
                      ) : null}
                      <span className="truncate text-text-secondary">
                        <span className="text-text">{note.displayName}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        {childNotes.length > numVisibleItems ? (
          <Button ref={bottomRef} className="mt-4 w-full" onClick={loadMore}>
            Load more
          </Button>
        ) : null}
      </div>
    </LinkHighlightProvider>
  )
}
