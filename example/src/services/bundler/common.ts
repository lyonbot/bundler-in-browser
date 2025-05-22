/**
 * this file is shared between the bundler-in-browser and the bundler-in-node
 */

import type { BundlerInBrowser, MiniNPM } from "bundler-in-browser";

export const workerSourceMarker = 'bundle-in-browser-worker'

// -----------------------------------------------------------------------------
//
// WorkerReadyMessage
//

export type WorkerReadyMessage = {
  type: 'ready';
  source: typeof workerSourceMarker;
  error?: any;
}
export const isWorkerReadyMessage = (e: any): e is WorkerReadyMessage => e && e.type === 'ready' && e.source === workerSourceMarker;
export const newWorkerReadyMessage = (error?: any): WorkerReadyMessage => ({ type: 'ready', source: workerSourceMarker, error });


// -----------------------------------------------------------------------------
//
// WorkerLogMessage
//

export type WorkerLogMessage = {
  type: 'log';
  source: typeof workerSourceMarker;
  timestamp: number; // ms since unix epoc
  level: 'info' | 'warn' | 'error';
  message: string;
}
export const isWorkerLogMessage = (e: any): e is WorkerLogMessage => e && e.type === 'log' && e.source === workerSourceMarker;


// -----------------------------------------------------------------------------
//
// NPMProgressMessage
//

export type NPMProgressMessage = {
  type: 'npm-progress';
  source: typeof workerSourceMarker;
  progress: MiniNPM.ProgressEvent | null;
  event: 'progress' | 'done' | 'error';
}
export const isNPMProgressMessage = (e: any): e is NPMProgressMessage => e && e.type === 'npm-progress' && e.source === workerSourceMarker;

// -----------------------------------------------------------------------------
// 
// BuildRequest & CompilationResponse
//

export interface BuildRequest {
  type: 'build';
  target: typeof workerSourceMarker;

  files: { [path: string]: string };
  port: MessagePort; // to send CompilationResponse
}

export const isBuildRequest = (e: any): e is BuildRequest => e && e.type === 'build' && e.target === workerSourceMarker;

export type BuildResponse =
  | BuildFailureResponse
  | BuildSuccessResponse

export type BuildFailureResponse = {
  errors: any[]
};

export type BuildSuccessResponse = {
  result: Awaited<ReturnType<BundlerInBrowser['build']>>
  /** wrapped by wrapCommonJS */
  wrappedJs: string
};

