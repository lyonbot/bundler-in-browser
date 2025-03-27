import { useAtomValue } from "jotai";
import React, { memo, useContext, useEffect, useRef } from "react";
import { FileSystemContext } from "../contexts/FileSystemContext";
import { useCompilerService } from "../services/compiler";
import { clsx, MOD_KEY_LABEL } from "yon-utils";
import styles from "../styles/CompileButton.module.scss";

function StartCompileButton() {
  const compilerService = useCompilerService();
  const { files } = useContext(FileSystemContext);
  const isCompiling = useAtomValue(compilerService.isCompilingAtom);

  const doCompile = useRef<() => void>(null as any);
  doCompile.current = () => compilerService.compile({ ...files });

  useEffect(() => {
    setTimeout(() => doCompile.current(), 100);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === "KeyS" && (e.metaKey || e.ctrlKey)) {
        doCompile.current();
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
      disabled={isCompiling}
      onClick={doCompile.current}
      className={clsx(styles.compileButton, isCompiling && styles.compiling)}
    >
      <span>{isCompiling ? "Compiling..." : "▶︎ Run"}</span>
      <kbd>{MOD_KEY_LABEL}+S</kbd>
    </button>
  );
}

export default memo(StartCompileButton);
