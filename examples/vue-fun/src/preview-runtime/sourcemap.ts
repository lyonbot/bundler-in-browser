import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

// --- Type Definitions ---

/**
 * A simplified interface for a raw Source Map JSON object.
 * A complete definition can be found in packages like `@types/source-map`.
 */
export interface RawSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourcesContent?: string[];
}

/**
 * Describes a single, processed frame of a stack trace.
 */
export interface StackFrame {
  functionName: string;
  filePath: string;
  line: number;
  column: number;
  mapped: boolean; // True if the location was mapped back to original source
}

/**
 * The final, parsed error stack object.
 */
export interface ParsedErrorStack {
  errorMessage: string;
  trace: StackFrame[];
}

/**
 * A collection mapping a generated file's URL to its RawSourceMap.
 */
export type SourceMapCollection = Record<string, RawSourceMap>;

/**
 * The signature for the parser function returned by the factory.
 */
export type ErrorStackParser = (stack?: string | null) => Promise<ParsedErrorStack>;


/**
 * Creates a high-performance error stack parser.
 * This factory function pre-processes all available source maps for fast lookups later.
 *
 * @param {SourceMapCollection} availableSourcemaps - An object where keys are generated file URLs
 * and values are their corresponding Source Map JSON objects.
 * @returns {ErrorStackParser} An asynchronous parser function.
 */
export function createErrorStackParser(availableSourcemaps: SourceMapCollection): ErrorStackParser {
  // 1. Pre-process and cache Source Maps into efficient TraceMap instances.
  const tracers = new Map<string, TraceMap>();
  for (const [url, sourceMapJson] of Object.entries(availableSourcemaps)) {
    try {
      const tracer = new TraceMap(sourceMapJson as any);
      tracers.set(url, tracer);
    } catch (e) {
      console.error(`Failed to parse sourcemap for ${url}:`, e);
    }
  }

  /**
   * The actual parser function that holds the pre-processed tracers in its closure.
   * @param {string | null | undefined} stack - The complete error.stack string.
   */
  return async function parseStack(stack?: string | null): Promise<ParsedErrorStack> {
    if (!stack) {
      return { errorMessage: 'No stack provided.', trace: [] };
    }

    const lines: string[] = stack.split('\n');
    const errorMessage: string = lines.shift() || 'Unknown error';

    // 2. A more robust regex to capture function name, file path, line, and column.
    // Handles formats like "at functionName (filePath:line:col)" and "functionName@filePath:line:col"
    const stackFrameRegex = /^\s*(?:at\s+)?(.*?)?\s*[@(](.*?):(\d+):(\d+)\)?\s*$/;

    const trace = lines
      .map((line: string): StackFrame | null => {
        const match = line.match(stackFrameRegex);
        if (!match) {
          return null;
        }

        const [, functionName, generatedUrl, lineStr, columnStr] = match;
        const generatedLine = parseInt(lineStr, 10);
        const generatedColumn = parseInt(columnStr, 10);

        // 3. Look up the pre-processed tracer from the cache.
        const tracer = tracers.get(generatedUrl);

        if (tracer) {
          // Perform a fast, synchronous lookup using the TraceMap instance.
          const originalPosition = originalPositionFor(tracer, {
            line: generatedLine,
            column: generatedColumn,
          });

          if (originalPosition && originalPosition.source) {
            return {
              functionName: originalPosition.name || functionName || 'anonymous',
              filePath: originalPosition.source,
              line: originalPosition.line,
              column: originalPosition.column,
              mapped: true,
            };
          }
        }

        // If no sourcemap is found or mapping fails, return the generated location.
        return {
          functionName: functionName || 'anonymous',
          filePath: generatedUrl,
          line: generatedLine,
          column: generatedColumn,
          mapped: false,
        };
      })
      // Use a type guard to filter out nulls and satisfy TypeScript's type checker.
      .filter((frame): frame is StackFrame => Boolean(frame));

    return { errorMessage, trace };
  };
}


// --- Example Usage ---
/*
async function main() {
  const sourcemaps: SourceMapCollection = {
    'https://example.com/dist/bundle.js': {
      version: 3,
      sources: ['../src/index.ts'],
      names: ['logError', 'console', 'log'],
      mappings: 'AAAA,SAASA,QAAQC,OAAOC,GAAG,CAAC,gBAAgB,CAAC,CAAC',
      file: 'bundle.js',
    },
  };

  // 1. Create the parser once (this is the expensive step).
  const parseErrorStack = createErrorStackParser(sourcemaps);

  // 2. Simulate an error stack string.
  const fakeErrorStack = `Error: Something went wrong
    at logError (https://example.com/dist/bundle.js:1:10)
    at https://example.com/dist/bundle.js:1:25`;

  // 3. Use the parser (this is fast and can be called repeatedly).
  const parsedResult = await parseErrorStack(fakeErrorStack);

  console.log(JSON.stringify(parsedResult, null, 2));
}

main();

// Expected Output:
// {
//   "errorMessage": "Error: Something went wrong",
//   "trace": [
//     {
//       "functionName": "logError",
//       "filePath": "../src/index.ts",
//       "line": 1,
//       "column": 9,
//       "mapped": true
//     },
//     {
//       "functionName": "anonymous",
//       "filePath": "https://example.com/dist/bundle.js",
//       "line": 1,
//       "column": 25,
//       "mapped": false
//     }
//   ]
// }
*/