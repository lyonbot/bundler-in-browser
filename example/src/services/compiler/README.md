# Compiler Service

A powerful in-browser compilation service that leverages 🧑‍🔧 Web Workers to perform code compilation tasks without blocking the main thread. This service is built on top of `bundler-in-browser` and provides a React-friendly interface for managing compilation states.

## Usage

```tsx
// 1. Initialize the service
const compilerService = new CompilerService();

// 2. Wrap your app with the provider
<CompilerServiceProvider service={compilerService}>
  <YourApp />
</CompilerServiceProvider>

// 3. Use the service in your components
function YourComponent() {
  const service = useCompilerService();

  const isReady = useAtomValue(service.isReadyAtom);
  const isCompiling = useAtomValue(service.isCompilingAtom);
  const lastResult = useAtomValue(service.resultAtom);
  const lastErrors = useAtomValue(service.errorsAtom);
  
  const handleCompile = async () => {
    await service.compile({
      '/index.js': 'console.log("Hello World")',
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

### 1. CompilerService (index.tsx)

The main service class that manages the compilation process and worker lifecycle:

- Maintains a Web Worker instance for handling compilation tasks
- Uses Jotai for state management
- Provides methods for compilation and worker reset
- Tracks compilation status and results

Key states managed by the service:

- `isReadyAtom`: Indicates if the worker is initialized and ready
- `isCompilingAtom`: Shows current compilation status
- `logsAtom`: Stores compilation logs
- `resultAtom`: Stores the last successful compilation result
- `errorsAtom`: Contains any compilation errors

### 2. CompilerServiceContext (CompilerServiceContext.tsx)

Provides React context integration:

- `CompilerServiceProvider`: A component that provides both CompilerService and Jotai store context
- `useCompilerService`: A hook to access the CompilerService instance within React components

### 3. Worker Implementation (compiler.worker.ts)

Handles the actual compilation process:

- Initializes the bundler with necessary plugins (Sass, Vue)
- Sets up event listeners for compilation progress
- Processes compilation requests and returns results
- Uses memfs for in-memory file system operations
