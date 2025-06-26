import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { FileSystemProvider } from './contexts/FileSystemContext';

import { BundlerService, BundlerServiceProvider } from './services/bundler';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const bundlerService = new BundlerService();

root.render(
  <React.StrictMode>
    <BundlerServiceProvider service={bundlerService}>
      <FileSystemProvider>
        <App />
      </FileSystemProvider>
    </BundlerServiceProvider>
  </React.StrictMode>
);
