import React from "react";
import MonacoEditor from "@monaco-editor/react";


interface Tab {
  path: string;
  content: string;
}

interface EditorProps {
  tabs: Tab[];
  activeTab: string | null;
  onTabSelect: (path: string) => void;
  onEditorChange: (value: string | undefined) => void;
  onCloseTab: (path: string) => void;
}

export const Editor: React.FC<EditorProps> = ({
  tabs,
  activeTab,
  onTabSelect,
  onEditorChange,
  onCloseTab,
}) => {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: 'wrap',
          backgroundColor: "#1e1e1e",
          padding: "4px",
          gap: "2px",
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.path}
            onMouseDown={(e) => {
              if (e.button === 0) onTabSelect(tab.path);
              if (e.button === 1) onCloseTab(tab.path);
              e.preventDefault();
            }}
            style={{
              padding: "4px 8px",
              backgroundColor: activeTab === tab.path ? "#333" : "#252525",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>{tab.path.split("/").pop()}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.path);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#666",
                cursor: "pointer",
                padding: "2px",
                fontSize: "12px",
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeTab ? (
          <MonacoEditor
            height="100%"
            theme="vs-dark"
            value={tabs.find((tab) => tab.path === activeTab)?.content}
            onChange={onEditorChange}
            path={activeTab}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
              backgroundColor: "#1e1e1e",
            }}
          >
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
};
