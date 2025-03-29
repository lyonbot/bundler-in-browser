import React, { useState, useContext, useEffect } from "react";
import { ResizablePanel } from "./components/ResizablePanel";
import { FileExplorer } from "./components/FileExplorer";
import { Editor } from "./components/Editor";
import { Preview } from "./components/Preview";
import { OutputPanel } from "./components/OutputPanel";
import { FileSystemContext } from "./contexts/FileSystemContext";
import CompileButton from "./components/CompileButton";

import styles from "./styles/App.module.scss";

interface Tab {
  path: string;
  content: string;
}

const entryPath = '/src/index.js'

const App: React.FC = () => {
  const { files, updateFile } = useContext(FileSystemContext);
  const [activeTab, setActiveTab] = useState<string | null>(entryPath);
  const [tabs, setTabs] = useState<Tab[]>([{ path: entryPath, content: files[entryPath] }]);

  const handleFileSelect = (path: string, location?: { line: number, column: number }) => {
    if (!tabs.find((tab) => tab.path === path)) {
      setTabs((prev) => [...prev, { path, content: files[path] || "" }]);
    }
    setActiveTab(path);
    setTimeout(() => {
      try {
        const monaco = (window as any).monaco;
        const editor = monaco.editor.getEditors()[0]
        editor.focus()
        if (location) {
          editor.setPosition({
            lineNumber: location.line,
            column: 1 + location.column,
          })
          editor.revealLineInCenter(location.line)
        }
      } catch (e) {
        // ignore
      }
    }, 50)
  };

  const handleEditorChange = (value: string | undefined) => {
    if (activeTab && value !== undefined) {
      updateFile(activeTab, value);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.path === activeTab ? { ...tab, content: value } : tab
        )
      );
    }
  };

  const handleCloseTab = (path: string) => {
    const newTabs = tabs.filter((tab) => tab.path !== path);
    setTabs(newTabs);
    if (activeTab === path) {
      setActiveTab(newTabs.length > 0 ? newTabs[0].path : null);
    }
    // in case monaco leaks
    try {
      const monaco = (window as any).monaco;
      monaco.editor.getModels().forEach((model: any) => {
        if (model.uri.path === path) model.dispose();
      });
    } catch (e) {
      // ignore
    }
  };

  return (
    <div
      className="app"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <div className={styles.columns}>
        <ResizablePanel className="panel-left" initialWidth="200px">
          <div style={{ padding: 8, background: '#222', border: '1px solid #ccc' }}>
            <CompileButton />
          </div>
          <FileExplorer
            activeTab={activeTab}
            tabs={tabs}
            onFileSelect={handleFileSelect}
            onCloseTab={handleCloseTab}
          />
        </ResizablePanel>
        <ResizablePanel className="panel-center" initialWidth="40vw">
          <Editor
            tabs={tabs}
            activeTab={activeTab}
            onTabSelect={setActiveTab}
            onEditorChange={handleEditorChange}
            onCloseTab={handleCloseTab}
          />
        </ResizablePanel>
        <div style={{ flex: 1, position: "relative" }}>
          <Preview
            onFileSelect={handleFileSelect}
          />
        </div>
      </div>
      <OutputPanel onFileSelect={handleFileSelect} />
    </div>
  );
};

export default App;
