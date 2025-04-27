import { useAtomValue } from "jotai";
import React, { memo, useContext, useEffect, useRef } from "react";
import { FileSystemContext } from "../contexts/FileSystemContext";
import { useCompilerService } from "../services/compiler";
import { clsx, MOD_KEY_LABEL } from "yon-utils";
import styles from "../styles/BuildButton.module.scss";

function StartBuildButton() {
  const compilerService = useCompilerService();
  const { files } = useContext(FileSystemContext);
  const isBuilding = useAtomValue(compilerService.isCompilingAtom);

  const doBuild = useRef<() => void>(null as any);
  doBuild.current = () => compilerService.build({ ...files });

  useEffect(() => {
    setTimeout(() => doBuild.current(), 100);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === "KeyS" && (e.metaKey || e.ctrlKey)) {
        doBuild.current();
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return (
    <button
      type="button"
      disabled={isBuilding}
      onClick={doBuild.current}
      className={clsx(styles.buildButton, isBuilding && styles.building)}
    >
      <span>{isBuilding ? "Building..." : "▶︎ Run"}</span>
      <kbd>{MOD_KEY_LABEL}+S</kbd>
    </button>
  );
}

export default memo(StartBuildButton);
