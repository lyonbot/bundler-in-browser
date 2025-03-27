import { Provider } from 'jotai';
import React, { memo } from 'react';
import type { CompilerService } from './service';

const CompilerServiceContext = React.createContext<CompilerService | null>(null);
/**
 * Provider component for the Compiler Service
 * Initializes and provides both CompilerService and Jotai store context
 *
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components to be wrapped
 */

export const CompilerServiceProvider: React.FC<{ children: React.ReactNode; service: CompilerService; }> = memo(({ children, service }) => {
  return <CompilerServiceContext.Provider value={service}>
    <Provider store={service.store}>
      {children}
    </Provider>
  </CompilerServiceContext.Provider>;
});
/**
 * Hook to access the CompilerService instance
 * @returns {CompilerService} The compiler service instance
 * @throws {Error} If used outside of CompilerServiceProvider
 */

export function useCompilerService(): CompilerService {
  const service = React.useContext(CompilerServiceContext);
  if (!service) {
    throw new Error('useCompilerService must be used within CompilerServiceProvider');
  }
  return service;
}
