import React, { useRef, useEffect } from 'react';
import { useCompilerService } from '../services/compiler';
import { useAtomValue } from 'jotai';
import dayjs from 'dayjs';

interface OutputPanelProps { }

export const OutputPanel: React.FC<OutputPanelProps> = () => {
  const preRef = useRef<HTMLPreElement>(null);

  const compilerService = useCompilerService();
  const logs = useAtomValue(compilerService.logsAtom);

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
            compilerService.clearLogs();
          }}
        >
          Clear
        </button>
      </div>
      <pre
        id="compile-log"
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
            {dayjs(log.timestamp).format('HH:mm:ss')} {log.message}
          </div>
        ))}
      </pre>
    </div>
  );
};