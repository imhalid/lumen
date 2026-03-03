import { useNavigate } from "@tanstack/react-router"
import { useAtom, useSetAtom } from "jotai"
import React from "react"
import { createEntityDialogAtom, virtualFoldersAtom } from "../global-state"
import { generateNoteId, isValidNoteId } from "../utils/note-id"
import { toSlugPath } from "../utils/slug"
import { Button } from "./button"
import { Dialog } from "./dialog"
import { FormControl } from "./form-control"
import { TextInput } from "./text-input"

export function CreateEntityDialogHost() {
  const navigate = useNavigate()
  const setVirtualFolders = useSetAtom(virtualFoldersAtom)
  const [dialog, setDialog] = useAtom(createEntityDialogAtom)

  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!dialog.open) {
      setName("")
      setError(null)
      return
    }

    setName("")
    setError(null)
    // Defer so Radix mounts content first
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [dialog.open])

  const title = dialog.open
    ? dialog.kind === "note"
      ? "New note"
      : "New folder"
    : "New"

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => {
        if (!open) setDialog({ open: false })
      }}
    >
      <Dialog.Content title={title}>
        {dialog.open ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              setError(null)

              const trimmed = name.trim()
              if (!trimmed) {
                setError("Please enter a name.")
                return
              }

              const slug = toSlugPath(trimmed)

              if (dialog.kind === "note") {
                const baseId = slug || generateNoteId()
                const noteId = dialog.currentFolder ? `${dialog.currentFolder}/${baseId}` : baseId

                if (!isValidNoteId(noteId)) {
                  setError(`"${noteId}" is not a valid note name.`)
                  return
                }

                const frontmatterLines: string[] = []
                frontmatterLines.push(`title: ${JSON.stringify(trimmed)}`)
                frontmatterLines.push("isPrivate: false")

                if (dialog.tags.length > 0) {
                  frontmatterLines.push(`tags: [${dialog.tags.join(", ")}]`)
                }

                const content = `---\n${frontmatterLines.join("\n")}\n---\n\n`

                setDialog({ open: false })
                navigate({
                  to: "/notes/$",
                  params: { _splat: noteId },
                  search: {
                    mode: "write",
                    query: undefined,
                    view: "list",
                    content,
                  },
                })

                return
              }

              // dialog.kind === "folder"
              if (!slug) {
                setError("Please enter a valid folder name.")
                return
              }

              const folderPath = dialog.currentFolder ? `${dialog.currentFolder}/${slug}` : slug

              if (!isValidNoteId(folderPath)) {
                setError(`"${folderPath}" is not a valid folder name.`)
                return
              }

              setVirtualFolders((prev) =>
                prev.includes(folderPath)
                  ? prev
                  : [...prev, folderPath].sort((a, b) => a.localeCompare(b)),
              )

              setDialog({ open: false })
              navigate({
                to: "/",
                search: { query: undefined, view: "list", folder: folderPath },
              })
            }}
          >
            <FormControl
              htmlFor="create-entity-name"
              label={dialog.kind === "note" ? "Note name" : "Folder name"}
              required
            >
              <TextInput
                ref={inputRef}
                id="create-entity-name"
                name="create-entity-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={dialog.kind === "note" ? "e.g. Meeting notes" : "e.g. Projects"}
                invalid={Boolean(error)}
                autoCapitalize="off"
                spellCheck={false}
              />
            </FormControl>

            {error ? <div className="text-sm text-text-danger">{error}</div> : null}

            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDialog({ open: false })}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create
              </Button>
            </div>
          </form>
        ) : (
          <div />
        )}
      </Dialog.Content>
    </Dialog>
  )
}

