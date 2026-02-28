import { useAtomValue, useSetAtom } from "jotai"
import { selectAtom, useAtomCallback } from "jotai/utils"
import React from "react"
import {
  backlinksIndexAtom,
  githubRepoAtom,
  githubUserAtom,
  globalStateMachineAtom,
  markdownFilesAtom,
  notesAtom,
  virtualFoldersAtom,
} from "../global-state"
import { Note, NoteId } from "../schema"
import { parseFrontmatter, updateFrontmatterValue } from "../utils/frontmatter"
import { deleteGist, updateGist } from "../utils/gist"
import { parseNote } from "../utils/parse-note"
import { updateWikilinks } from "../utils/update-wikilinks"
import { isValidNoteId } from "../utils/note-id"

const EMPTY_BACKLINKS: NoteId[] = []

const shallowEqualBacklinks = (a: NoteId[], b: NoteId[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function useNoteById(id: NoteId | undefined) {
  const noteAtom = React.useMemo(
    () => selectAtom(notesAtom, (notes) => (id ? notes.get(id) : undefined)),
    [id],
  )
  const note = useAtomValue(noteAtom)
  return note
}

/** Get backlinks for any note ID, even if the note doesn't exist */
export function useBacklinksForId(id: NoteId | undefined) {
  const backlinksAtom = React.useMemo(
    () =>
      selectAtom(
        backlinksIndexAtom,
        (index) => (id ? (index.get(id) ?? EMPTY_BACKLINKS) : EMPTY_BACKLINKS),
        shallowEqualBacklinks,
      ),
    [id],
  )
  return useAtomValue(backlinksAtom)
}

/** All folder path prefixes of a note id (e.g. "a/b/c" -> ["a", "a/b"]) */
function getFolderPrefixes(noteId: string): string[] {
  const parts = noteId.split("/")
  if (parts.length <= 1) return []
  const prefixes: string[] = []
  for (let i = 1; i < parts.length; i += 1) {
    prefixes.push(parts.slice(0, i).join("/"))
  }
  return prefixes
}

export function useSaveNote() {
  const send = useSetAtom(globalStateMachineAtom)
  const setVirtualFolders = useSetAtom(virtualFoldersAtom)
  const githubUser = useAtomValue(githubUserAtom)
  const githubRepo = useAtomValue(githubRepoAtom)
  const getNotes = useAtomCallback(React.useCallback((get) => get(notesAtom), []))

  const saveNote = React.useCallback(
    async ({ id, content }: Pick<Note, "id" | "content">) => {
      const contentWithTimestamp = updateFrontmatterValue({
        content,
        properties: { updated_at: new Date() },
      })

      send({
        type: "WRITE_FILES",
        markdownFiles: { [`${id}.md`]: contentWithTimestamp },
      })

      // Remove this note's folder path(s) from virtual folders now that they exist on disk
      const folderPrefixes = getFolderPrefixes(id ?? "")
      if (folderPrefixes.length > 0) {
        setVirtualFolders((prev) =>
          prev.filter((path) => !folderPrefixes.includes(path)),
        )
      }

      const { frontmatter } = parseFrontmatter(contentWithTimestamp)
      if (typeof frontmatter.gist_id === "string" && githubUser && githubRepo) {
        await updateGist({
          gistId: frontmatter.gist_id,
          note: parseNote(id ?? "", contentWithTimestamp),
          githubUser,
          githubRepo,
          notes: getNotes(),
        })
      }
    },
    [send, setVirtualFolders, githubUser, githubRepo, getNotes],
  )

  return saveNote
}

type RenameNoteResult =
  | { success: true }
  | { success: false; reason: "duplicate" | "invalid" | "no-op" }

export function useRenameNote() {
  const getMarkdownFiles = useAtomCallback(React.useCallback((get) => get(markdownFilesAtom), []))
  const send = useSetAtom(globalStateMachineAtom)

  return React.useCallback(
    (params: { oldName: string; newName: string; content: string }): RenameNoteResult => {
      const { oldName, newName, content } = params

      const markdownFiles = getMarkdownFiles()
      const oldFilepath = `${oldName}.md`
      const newFilepath = `${newName}.md`

      // Guard against no-op renames
      if (!oldName || !newName || oldName === newName) {
        return { success: false, reason: "no-op" }
      }

      if (!isValidNoteId(newName)) {
        return { success: false, reason: "invalid" }
      }

      // Prevent overwriting an existing file
      if (newFilepath !== oldFilepath && markdownFiles[newFilepath]) {
        return { success: false, reason: "duplicate" }
      }

      const oldFileExists = Object.prototype.hasOwnProperty.call(markdownFiles, oldFilepath)

      const updatedMarkdownFiles: Record<string, string | null> = {}

      // Update wikilinks in all other notes
      for (const [filepath, content] of Object.entries(markdownFiles)) {
        if (filepath === oldFilepath) continue
        const newContent = updateWikilinks({ fileContent: content, oldId: oldName, newId: newName })
        if (newContent !== content) {
          updatedMarkdownFiles[filepath] = newContent
        }
      }

      // Write the renamed file and mark the old path for deletion
      updatedMarkdownFiles[newFilepath] = updateWikilinks({
        fileContent: content,
        oldId: oldName,
        newId: newName,
      })
      if (oldFileExists) {
        updatedMarkdownFiles[oldFilepath] = null
      }

      if (Object.keys(updatedMarkdownFiles).length > 0) {
        send({
          type: "WRITE_FILES",
          markdownFiles: updatedMarkdownFiles,
          commitMessage: `Rename note ${oldName} to ${newName}`,
        })
      }

      return { success: true }
    },
    [getMarkdownFiles, send],
  )
}

export type MoveNotesResult =
  | { success: true; moved: number; skipped: string[] }
  | { success: false; reason: string }

/** Move multiple notes to a target folder. targetFolder "" = root. Uses note basename (e.g. "a/b" → "folder/b"). */
export function useMoveNotesToFolder() {
  const getMarkdownFiles = useAtomCallback(React.useCallback((get) => get(markdownFilesAtom), []))
  const send = useSetAtom(globalStateMachineAtom)
  const setVirtualFolders = useSetAtom(virtualFoldersAtom)

  return React.useCallback(
    (noteIds: NoteId[], targetFolder: string): MoveNotesResult => {
      const markdownFiles = getMarkdownFiles()
      const moved: { oldId: NoteId; newId: NoteId; content: string }[] = []
      const skipped: string[] = []

      for (const oldId of noteIds) {
        const oldFilepath = `${oldId}.md`
        const content = markdownFiles[oldFilepath]
        if (content == null) {
          skipped.push(oldId)
          continue
        }
        const basename = oldId.includes("/") ? oldId.split("/").pop()! : oldId
        const newId = targetFolder ? `${targetFolder}/${basename}` : basename
        if (newId === oldId) continue
        if (!isValidNoteId(newId)) {
          skipped.push(oldId)
          continue
        }
        const newFilepath = `${newId}.md`
        if (markdownFiles[newFilepath] != null && newFilepath !== oldFilepath) {
          skipped.push(oldId)
          continue
        }
        moved.push({ oldId, newId, content })
      }

      if (moved.length === 0) {
        return { success: true, moved: 0, skipped }
      }

      const updatedMarkdownFiles: Record<string, string | null> = {}
      const movedOldPaths = new Set(moved.map((m) => `${m.oldId}.md`))

      for (const [filepath, content] of Object.entries(markdownFiles)) {
        let newContent = content
        for (const { oldId, newId } of moved) {
          newContent = updateWikilinks({ fileContent: newContent, oldId, newId })
        }
        if (newContent !== content) updatedMarkdownFiles[filepath] = newContent
      }

      for (const { oldId, newId, content } of moved) {
        const oldFilepath = `${oldId}.md`
        const newFilepath = `${newId}.md`
        updatedMarkdownFiles[newFilepath] = updateWikilinks({
          fileContent: content,
          oldId,
          newId,
        })
        updatedMarkdownFiles[oldFilepath] = null
      }

      const folderPrefixesToRemove = new Set<string>()
      for (const { oldId } of moved) {
        for (const p of getFolderPrefixes(oldId)) folderPrefixesToRemove.add(p)
      }
      if (folderPrefixesToRemove.size > 0) {
        setVirtualFolders((prev) =>
          prev.filter((path) => !folderPrefixesToRemove.has(path)),
        )
      }

      send({
        type: "WRITE_FILES",
        markdownFiles: updatedMarkdownFiles,
        commitMessage: `Move ${moved.length} note(s) to ${targetFolder || "root"}`,
      })

      return { success: true, moved: moved.length, skipped }
    },
    [getMarkdownFiles, send, setVirtualFolders],
  )
}

export function useDeleteNote() {
  const send = useSetAtom(globalStateMachineAtom)
  const githubUser = useAtomValue(githubUserAtom)
  const getNoteById = useAtomCallback(
    React.useCallback((get, set, id: NoteId) => {
      const notes = get(notesAtom)
      return notes.get(id)
    }, []),
  )

  const deleteNote = React.useCallback(
    async (id: NoteId) => {
      // If the note has a gist ID, delete the gist
      const note = getNoteById(id)
      if (typeof note?.frontmatter.gist_id === "string" && githubUser?.token) {
        await deleteGist({
          githubToken: githubUser.token,
          gistId: note.frontmatter.gist_id,
        })
      }

      send({ type: "DELETE_FILE", filepath: `${id}.md` })
    },
    [send, githubUser, getNoteById],
  )

  return deleteNote
}
