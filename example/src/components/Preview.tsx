import React, { memo, useEffect } from "react";
import styles from "../styles/NPMProgressView.module.scss";
import { useBundlerService } from "../services/bundler";
import { useAtomValue } from "jotai";
import type { PartialMessage } from "esbuild-wasm";

interface PreviewProps {
  onFileSelect?(path: string, location?: { line: number, column: number }): void;
}

const NPMProgressView = memo(() => {
  const bundlerService = useBundlerService();
  const isBundlerReady = useAtomValue(bundlerService.isReadyAtom);
  const isBuilding = useAtomValue(bundlerService.isBuildingAtom);
  const npmProgress = useAtomValue(bundlerService.npmInstallProgressAtom);

  if (!isBundlerReady) {
    return <div className={styles.progressContainer}>
      <div className={styles.packageId}>Loading Builder-In-Browser...</div>
    </div>
  }

  if (isBuilding) {
    return <div className={styles.progressContainer}>
      {
        npmProgress ? <>
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
  }

  return null
})

const BuildErrorView = memo((props: Pick<PreviewProps, 'onFileSelect'>) => {
  const bundlerService = useBundlerService();

  const isBuilding = useAtomValue(bundlerService.isBuildingAtom)
  const errors = useAtomValue(bundlerService.errorsAtom);
  const [shown, setShown] = React.useState(false);

  useEffect(() => { if (!isBuilding) setShown(true) }, [isBuilding]) // once built, show!

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
                  const loc = location.line ? { line: location.line, column: location.column! } : undefined;
                  props.onFileSelect?.(path, loc);
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
  const bundlerService = useBundlerService();

  const result = useAtomValue(bundlerService.resultAtom);
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
      <BuildErrorView onFileSelect={onFileSelect} />
    </div>
  );
};
