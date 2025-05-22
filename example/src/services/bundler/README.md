# Compiler Service

A powerful in-browser compilation service that leverages 🧑‍🔧 Web Workers to perform code compilation tasks without blocking the main thread. This service is built on top of `bundler-in-browser` and provides a React-friendly interface for managing compilation states.

## Usage

```tsx
// 1. Initialize the service
const bundlerService = new BundlerService();

// 2. Wrap your app with the provider
<BundlerServiceProvider service={bundlerService}>
  <YourApp />
</BundlerServiceProvider>

// 3. Use the service in your components
function YourComponent() {
  const service = useBundlerService();

  const isReady = useAtomValue(service.isReadyAtom);
  const isBuilding = useAtomValue(service.isBuildingAtom);
  const lastResult = useAtomValue(service.resultAtom);
  const lastErrors = useAtomValue(service.errorsAtom);
  
  const handleCompile = async () => {
    await service.compile({
      '/src/index.js': 'console.log("Hello World")',
      // ... more files
    });
  };
  
  return (
    // Your component JSX
  );
}
```

## Architecture

The compiler service consists of four main components:

### 1. BundlerService (index.tsx)

The main service class that manages the compilation process and worker lifecycle:

- Maintains a Web Worker instance for handling compilation tasks
- Uses Jotai for state management
- Provides methods for compilation and worker reset
- Tracks compilation status and results

Key states managed by the service:

- `isReadyAtom`: Indicates if the worker is initialized and ready
- `isBuildingAtom`: Shows current compilation status
- `logsAtom`: Stores compilation logs
- `resultAtom`: Stores the last successful compilation result
- `errorsAtom`: Contains any compilation errors

### 2. BundlerServiceContext (BundlerServiceContext.tsx)

Provides React context integration:

- `BundlerServiceProvider`: A component that provides both BundlerService and Jotai store context
- `useBundlerService`: A hook to access the BundlerService instance within React components

### 3. Worker Implementation (bundler.worker.ts)

Handles the actual building process:

- Initializes the bundler with necessary plugins (Sass, Vue)
- Sets up event listeners for building progress
- Processes build requests and returns results
- Uses @zenfs/core for in-memory file system operations
