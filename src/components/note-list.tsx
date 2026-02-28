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
import { Dice } from "./dice"
import { DropdownMenu } from "./dropdown-menu"
import { IconButton } from "./icon-button"
import {
  CheckIcon16,
  ChevronRightIcon16,
  FolderIcon16,
  GlobeIcon16,
  GridIcon16,
  ListIcon16,
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

type View = "grid" | "list"

const viewIcons: Record<View, React.ReactNode> = {
  grid: <GridIcon16 />,
  list: <ListIcon16 />,
}

type NoteListProps = {
  baseQuery?: string
  folder?: string
  query: string
  view: View
  onFolderChange?: (folder: string | undefined) => void
  onQueryChange: (query: string) => void
  onViewChange: (view: View) => void
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
  view,
  onFolderChange = () => {},
  onQueryChange,
  onViewChange,
}: NoteListProps) {
  const searchNotes = useSearchNotes()
  const notes = useAtomValue(notesAtom)
  const virtualFolders = useAtomValue(virtualFoldersAtom)
  const navigate = useNavigate()
  const moveNotesToFolder = useMoveNotesToFolder()

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAllVisible = useCallback(() => {
    setSelectedIds(
      new Set(childNotes.slice(0, numVisibleItems).map((n) => n.id)),
    )
  }, [childNotes, numVisibleItems])

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleMoveToFolder = useCallback(
    (targetFolder: string) => {
      const result = moveNotesToFolder([...selectedIds], targetFolder)
      if (result.success && result.moved > 0) exitSelectMode()
    },
    [moveNotesToFolder, selectedIds, exitSelectMode],
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
                <Button
                  variant="secondary"
                  size="small"
                  onClick={exitSelectMode}
                  className="shrink-0"
                >
                  <XIcon12 className="mr-1.5" />
                  Cancel
                </Button>
                <span className="text-sm text-text-secondary shrink-0">
                  {selectedIds.size} selected
                </span>
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    render={
                      <Button
                        variant="primary"
                        size="small"
                        disabled={selectedIds.size === 0}
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
                {isFolderView ? (
                  <NewFolderButton currentFolder={folder || undefined} />
                ) : null}
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
                <DiceButton
                  disabled={childNotes.length === 0}
                  onClick={() => {
                    const resultsCount = childNotes.length
                    const randomIndex = Math.floor(Math.random() * resultsCount)
                    navigate({ to: `/notes/${childNotes[randomIndex].id}` })
                  }}
                />
                <DropdownMenu>
              <DropdownMenu.Trigger
                render={
                  <IconButton
                    aria-label="View"
                    className="h-10 w-10 shrink-0 rounded-lg bg-bg-secondary hover:bg-bg-secondary-hover! data-[popup-open]:bg-bg-secondary-hover! active:bg-bg-secondary-active! epaper:ring-1 epaper:ring-inset epaper:ring-border epaper:focus-visible:ring-2 coarse:h-12 coarse:w-12"
                  >
                    {viewIcons[view]}
                  </IconButton>
                }
              />
              <DropdownMenu.Content align="end" width={160}>
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>View as</DropdownMenu.GroupLabel>
                  <DropdownMenu.Item
                    icon={<GridIcon16 />}
                    onClick={() => onViewChange("grid")}
                    selected={view === "grid"}
                  >
                    Grid
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    icon={<ListIcon16 />}
                    onClick={() => onViewChange("list")}
                    selected={view === "list"}
                  >
                    List
                  </DropdownMenu.Item>
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu>
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
          {childFolderNames.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="flex h-8 items-center px-2 text-sm text-text-secondary coarse:h-10 coarse:px-3">
                Folders
              </div>
              <ul className="flex flex-col gap-0.5">
                {childFolderNames.map((name) => {
                  const folderPath = folder ? `${folder}/${name}` : name
                  return (
                    <li key={folderPath}>
                      <button
                        type="button"
                        onClick={() => onFolderChange(folderPath)}
                        className="focus-ring flex h-10 w-full items-center rounded-lg px-3 text-left hover:bg-bg-hover coarse:h-12 coarse:p-4"
                      >
                        <FolderIcon16 className="mr-3 shrink-0 text-text-secondary coarse:mr-4" />
                        <span className="truncate text-text">{name}</span>
                        <ChevronRightIcon16 className="ml-auto shrink-0 text-text-tertiary" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
          {view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {childNotes.slice(0, numVisibleItems).map((note) => (
                <div key={note.id} className="relative">
                  {isSelectMode ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSelection(note.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          toggleSelection(note.id)
                        }
                      }}
                      className="focus-ring flex cursor-pointer flex-col rounded-xl border-2 border-transparent transition-[border-color] hover:border-border [&:has([data-state=checked])]:border-border-focus"
                    >
                      <div className="absolute left-3 top-3 z-10">
                        <Checkbox
                          checked={selectedIds.has(note.id)}
                          onCheckedChange={() => toggleSelection(note.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <NotePreviewCard id={note.id} selectMode />
                    </div>
                  ) : (
                    <NotePreviewCard id={note.id} />
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {view === "list" ? (
            <ul className="flex flex-col gap-0.5">
              {childNotes.slice(0, numVisibleItems).map((note) => {
                if (isSelectMode) {
                  return (
                    <li key={note.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSelection(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            toggleSelection(note.id)
                          }
                        }}
                        className="focus-ring flex h-10 cursor-pointer items-center rounded-lg px-3 hover:bg-bg-hover coarse:h-12 coarse:p-4"
                      >
                        <Checkbox
                          checked={selectedIds.has(note.id)}
                          onCheckedChange={() => toggleSelection(note.id)}
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

function DiceButton({ disabled = false, onClick }: { disabled?: boolean; onClick?: () => void }) {
  const [number, setNumber] = React.useState(() => Math.floor(Math.random() * 6) + 1)
  return (
    <IconButton
      disabled={disabled}
      aria-label="Roll the dice"
      className="group/dice h-10 w-10 shrink-0 rounded-lg bg-bg-secondary hover:bg-bg-secondary-hover! active:bg-bg-secondary-active! epaper:ring-1 epaper:ring-inset epaper:ring-border epaper:focus-visible:ring-2 coarse:h-12 coarse:w-12"
      onClick={() => {
        setNumber(Math.floor(Math.random() * 6) + 1)
        onClick?.()
      }}
    >
      <Dice
        number={number}
        className="group-hover/dice:rotate-[20deg] group-active/dice:rotate-[100deg] group-hover/dice:-translate-y-0.5"
      />
    </IconButton>
  )
}
