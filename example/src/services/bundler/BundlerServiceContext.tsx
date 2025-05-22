import { Provider } from 'jotai';
import React, { memo } from 'react';
import type { BundlerService } from './service';

const BundlerServiceContext = React.createContext<BundlerService | null>(null);
/**
 * Provider component for the Compiler Service
 * Initializes and provides both BundlerService and Jotai store context
 *
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components to be wrapped
 */

export const BundlerServiceProvider: React.FC<{ children: React.ReactNode; service: BundlerService; }> = memo(({ children, service }) => {
  return <BundlerServiceContext.Provider value={service}>
    <Provider store={service.store}>
      {children}
    </Provider>
  </BundlerServiceContext.Provider>;
});
/**
 * Hook to access the BundlerService instance
 * @returns {BundlerService} The compiler service instance
 * @throws {Error} If used outside of BundlerServiceProvider
 */

export function useBundlerService(): BundlerService {
  const service = React.useContext(BundlerServiceContext);
  if (!service) {
    throw new Error('useBundlerService must be used within BundlerServiceProvider');
  }
  return service;
}
