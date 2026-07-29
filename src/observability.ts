import type { FeedStatus, YouTubeApiErrorCode } from './core';
import type { PlaybackDescriptor, PlayerPhase, PlayerPresentation } from './player/types';

export type DiagnosticOperation = 'startup' | 'homeFeed' | 'suggestions' | 'search' | 'player';
export type DiagnosticResultStatus = 'started' | 'succeeded' | 'failed' | 'aborted' | 'ignored';

export type DevelopmentDiagnosticEvent = {
  operation: DiagnosticOperation;
  sourceKind?: PlaybackDescriptor['kind'];
  playerPhase?: PlayerPhase;
  presentationMode?: PlayerPresentation;
  requestId?: number;
  requestGeneration?: number;
  startedAt?: string;
  finishedAt?: string;
  resultStatus?: DiagnosticResultStatus;
  errorCode?: YouTubeApiErrorCode;
  aborted?: boolean;
  staleResponseIgnored?: boolean;
  startupState?: string;
  feedState?: FeedStatus;
  cachedItemCount?: number;
  retrying?: boolean;
};

export type SafeDevelopmentDiagnostic = {
  [K in keyof DevelopmentDiagnosticEvent]?: DevelopmentDiagnosticEvent[K];
};

const allowedKeys = new Set<keyof DevelopmentDiagnosticEvent>([
  'operation',
  'sourceKind',
  'playerPhase',
  'presentationMode',
  'requestId',
  'requestGeneration',
  'startedAt',
  'finishedAt',
  'resultStatus',
  'errorCode',
  'aborted',
  'staleResponseIgnored',
  'startupState',
  'feedState',
  'cachedItemCount',
  'retrying'
]);

const sensitiveTextPattern = /https?:|authorization|bearer|cookie|token|api[_-]?key|secret|signature|playbackUrl/i;

export function sanitizeDevelopmentDiagnostic(event: DevelopmentDiagnosticEvent): SafeDevelopmentDiagnostic {
  const safe: SafeDevelopmentDiagnostic = {};
  for (const [key, value] of Object.entries(event) as Array<[keyof DevelopmentDiagnosticEvent, DevelopmentDiagnosticEvent[keyof DevelopmentDiagnosticEvent]]>) {
    if (!allowedKeys.has(key) || value === undefined) {
      continue;
    }
    if (typeof value === 'string' && sensitiveTextPattern.test(value)) {
      continue;
    }
    (safe as Record<string, unknown>)[key] = value;
  }
  return safe;
}

export function logDevelopmentDiagnostic(event: DevelopmentDiagnosticEvent) {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return;
  }
  console.info('Syria Tube diagnostic', sanitizeDevelopmentDiagnostic(event));
}
