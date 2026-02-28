import { useCreateNewFolder } from "../hooks/create-new-note"
import { IconButton } from "./icon-button"
import { FolderIcon16 } from "./icons"

type NewFolderButtonProps = {
  /** When inside a folder in the list, pass its path so the new folder is created here */
  currentFolder?: string
}

export function NewFolderButton({ currentFolder }: NewFolderButtonProps) {
  const createNewFolder = useCreateNewFolder(currentFolder)

  return (
    <IconButton
      aria-label="New folder"
      size="small"
      onClick={createNewFolder}
    >
      <FolderIcon16 />
    </IconButton>
  )
}
