import React, { useRef, useEffect, memo, useMemo } from 'react';
import { useBundlerService } from '../services/bundler';
import { useAtomValue } from 'jotai';
import dayjs from 'dayjs';

interface OutputPanelProps {
  onFileSelect?(path: string, location?: { line: number, column: number }): void;
}

const WithAutoFileLink = memo((props: { text: string } & OutputPanelProps) => {
  const { text, onFileSelect } = props;

  let lastOnFileSelect = useRef<OutputPanelProps['onFileSelect']>(onFileSelect);
  lastOnFileSelect.current = onFileSelect;

  const nodes = useMemo(() => {
    const ans: React.ReactNode[] = [];
    const re = /((?:^|\/)src\/[^\s:]+)(\:(\d+)\:(\d+))?/gm;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = re.exec(text)) !== null) {
      const prefix = text.slice(lastIndex, match.index);
      ans.push(<span key={`${prefix}-${lastIndex}`}>{prefix}</span>);

      let path = match[1];
      if (!path.startsWith('/')) path = `/${path}`;
      let loc: { line: number, column: number } | undefined;

      if (match[2]) {
        loc = { line: Number(match[3]), column: Number(match[4]) };
      }

      ans.push(<a
        key={path}
        href="#"
        style={{ color: '#eef' }}
        onClick={e => {
          e.preventDefault();
          lastOnFileSelect.current?.(path, loc);
        }}
      >{match[0]}</a>);

      lastIndex = match.index + match[0].length;
    }
    ans.push(<span key={`last-${lastIndex}`}>{text.slice(lastIndex)}</span>);
    return ans;
  }, [text]);

  return <>{nodes}</>;
});

export const OutputPanel: React.FC<OutputPanelProps> = ({ onFileSelect }) => {
  const preRef = useRef<HTMLPreElement>(null);

  const bundlerService = useBundlerService();
  const logs = useAtomValue(bundlerService.logsAtom);

  useEffect(() => {
    // 自动滚动到底部
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  });

  return (
    <div style={{
      height: '200px',
      borderTop: '1px solid #e0e0e0',
      backgroundColor: '#1e1e1e',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{
        padding: '4px 8px',
        backgroundColor: '#252525',
        color: '#fff',
        fontSize: '12px',
        borderBottom: '1px solid #333'
      }}>
        Output

        <button
          type='button'
          style={{
            float: 'right',
            padding: '2px 4px',
            fontSize: '10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#444',
            color: '#fff',
            cursor: 'pointer'
          }}
          onClick={() => {
            bundlerService.clearLogs();
          }}
        >
          Clear
        </button>
      </div>
      <pre
        id="build-log"
        ref={preRef}
        style={{
          margin: 0,
          padding: '8px',
          flex: 1,
          overflow: 'auto',
          color: '#fff',
          fontSize: '12px',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
      >
        {logs.map((log, i) => (
          <div key={i}>
            {dayjs(log.timestamp).format('HH:mm:ss')}
            <WithAutoFileLink text={log.message} onFileSelect={onFileSelect} />
          </div>
        ))}
      </pre>
    </div>
  );
};