import React, { createContext, useState, useCallback } from 'react';
import { fsData } from '../fsData';

interface FileSystemContextType {
  files: Record<string, string>;
  createFile: (path: string, content: string) => void;
  updateFile: (path: string, content: string) => void;
  deleteFile: (path: string) => void;
}

export const FileSystemContext = createContext<FileSystemContextType>({
  files: {},
  createFile: () => {},
  updateFile: () => {},
  deleteFile: () => {},
});

export const FileSystemProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [files, setFiles] = useState<Record<string, string>>(fsData);

  const createFile = useCallback((path: string, content: string) => {
    setFiles(prev => ({ ...prev, [path]: content }));
  }, []);

  const updateFile = useCallback((path: string, content: string) => {
    setFiles(prev => ({ ...prev, [path]: content }));
  }, []);

  const deleteFile = useCallback((path: string) => {
    setFiles(prev => {
      const newFiles = { ...prev };
      delete newFiles[path];
      return newFiles;
    });
  }, []);

  return (
    <FileSystemContext.Provider value={{ files, createFile, updateFile, deleteFile }}>
      {children}
    </FileSystemContext.Provider>
  );
};