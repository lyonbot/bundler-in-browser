import React, { memo, useEffect } from "react";
import styles from "../styles/NPMProgressView.module.scss";
import { useCompilerService } from "../services/compiler";
import { useAtomValue } from "jotai";
import type { PartialMessage } from "esbuild-wasm";

interface PreviewProps {
  onFileSelect?(path: string): void
}

const NPMProgressView = memo(() => {
  const compilerService = useCompilerService();
  const isCompilerReady = useAtomValue(compilerService.isReadyAtom);
  const isCompiling = useAtomValue(compilerService.isCompilingAtom);
  const npmProgress = useAtomValue(compilerService.npmInstallProgressAtom);
  if (!isCompiling) return null;

  return (
    <div className={styles.progressContainer}>
      {
        (!isCompilerReady) ? <>
          <div className={styles.packageId}>Loading Builder-In-Browser...</div>
        </> : npmProgress ? <>
          <div className={styles.stage}>[{npmProgress.stage}]</div>
          <div className={styles.packageId}>{npmProgress.packageId}</div>
          <div className={styles.progress}>
            {npmProgress.current}/{npmProgress.total}
          </div>
        </> : <>
          <div className={styles.packageId}>Compile and bundling...</div>
          <div className={styles.progress}>
            if NPM dependencies changed, it'll take a while
          </div>
        </>
      }
    </div>
  )
})

const CompileErrorView = memo((props: Pick<PreviewProps, 'onFileSelect'>) => {
  const compilerService = useCompilerService();

  const isCompiling = useAtomValue(compilerService.isCompilingAtom)
  const errors = useAtomValue(compilerService.errorsAtom);
  const [shown, setShown] = React.useState(false);

  useEffect(() => { if (!isCompiling) setShown(true) }, [isCompiling]) // once compile done, show!

  if (!shown || !errors || errors.length === 0) return null;

  return (
    <div className={styles.errorContainer}>
      <ol className={styles.errorList}>
        {errors.map((error: PartialMessage | Error, i) => {
          const text = 'text' in error ? error.text : (error as any).message;
          const location = 'location' in error && error.location;

          return <li key={i} className={styles.errorItem}>
            <div className={styles.errorMessage}>{text}</div>
            {
              location && <div
                className={styles.errorLocation}
                onClick={e => {
                  e.preventDefault();
                  const path = '/' + location.file;
                  props.onFileSelect?.(path);
                }}>
                {location.file}:{location.line}:{location.column}
              </div>
            }
          </li>;
        })}
      </ol>
    </div>
  );
})

export const Preview: React.FC<PreviewProps> = ({ onFileSelect }) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const compilerService = useCompilerService();

  const result = useAtomValue(compilerService.resultAtom);
  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !result) return;

    const js = result.wrappedJs;
    const css = result.result.css;

    const html = `<!DOCTYPE html><html>
    <head>
      <style>${css}\n</style>
    </head>
    <body>
      <div id="root"></div>
      <script>${js}\n</script>
    </body></html>`;

    iframe.srcdoc = html;
  }, [result]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
      }}
    >
      <iframe
        ref={iframeRef}
        title="Preview"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          backgroundColor: "#fff",
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
      <NPMProgressView />
      <CompileErrorView onFileSelect={onFileSelect} />
    </div>
  );
};
