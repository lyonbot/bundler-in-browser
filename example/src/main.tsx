import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { FileSystemProvider } from './contexts/FileSystemContext';

import { CompilerService, CompilerServiceProvider } from './services/compiler';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const compilerService = new CompilerService();

root.render(
  <React.StrictMode>
    <CompilerServiceProvider service={compilerService}>
      <FileSystemProvider>
        <App />
      </FileSystemProvider>
    </CompilerServiceProvider>
  </React.StrictMode>
);
