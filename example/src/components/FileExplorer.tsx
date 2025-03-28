import React, { useContext, useState } from "react";
import { FileSystemContext } from "../contexts/FileSystemContext";
import styles from "../styles/FileExplorer.module.scss";
import { clsx } from "yon-utils";

interface FileExplorerProps {
  onFileSelect?: (path: string) => void;
  activeTab?: string | null;
  tabs?: { path: string }[];
  onCloseTab?: (path: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  onFileSelect,
  activeTab,
  tabs,
  onCloseTab,
}) => {
  const { files, createFile, deleteFile } = useContext(FileSystemContext);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const handleFileClick = (path: string, event: React.MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      onCloseTab?.(path);
      return;
    }
    onFileSelect?.(path);
  };

  const handleCreateFile = () => {
    let fileName = newFileName.trim()
    if (!fileName) return

    if (!fileName.startsWith('/')) {
      const active = (activeTab || '/')
      const idx = active.lastIndexOf('/')
      fileName = `${active.slice(0, idx + 1)}${fileName}`
    }

    createFile(fileName, "");
    setNewFileName("");
    setIsCreatingFile(false);
    onFileSelect?.(fileName);
  };

  const handleDeleteFile = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`delete "${path}"?`)) {
      deleteFile(path);
      onCloseTab?.(path);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>Files</h3>
        <button
          onClick={() => setIsCreatingFile(true)}
          className={styles.newButton}
        >
          New
        </button>
      </div>

      {isCreatingFile && (
        <div className={styles.newFileInput}>
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") handleCreateFile();
              if (e.key === "Escape") setIsCreatingFile(false);
            }}
            placeholder="filename.txt"
            autoFocus
          />
        </div>
      )}

      <div className={styles.fileList}>
        {Object.keys(files).sort().map((path) => {
          const isOpen = tabs?.some((tab) => tab.path === path);
          const isActive = activeTab === path;

          return (
            <div
              key={path}
              onMouseDown={(e) => handleFileClick(path, e)}
              className={clsx(styles.fileItem, {
                [styles.active]: isActive,
                [styles.open]: isOpen && !isActive,
              })}
              title={path}
            >
              <span className={styles.filePathText} title={path}>{path}</span>
              {path === '/src/index.js' && <span className={styles.entryTag}>entry</span>}
              <div style={{ flex: '1' }}></div>
              <button
                onMouseDown={(e) => handleDeleteFile(path, e)}
                className={styles.deleteButton}
              >
                Del
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
