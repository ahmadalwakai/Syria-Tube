import { YouTubeApiError } from '../core';

export type StartupState =
  | { status: 'initializing' }
  | { status: 'checking-readiness' }
  | { status: 'loading-content' }
  | { status: 'ready' }
  | { status: 'offline' }
  | { status: 'error'; error: YouTubeApiError };

export function createInitialStartupState(): StartupState {
  return { status: 'initializing' };
}

export function checkingReadinessState(): StartupState {
  return { status: 'checking-readiness' };
}

export function loadingContentState(current: StartupState): StartupState {
  return current.status === 'ready' ? current : { status: 'loading-content' };
}

export function readyStartupState(): StartupState {
  return { status: 'ready' };
}

export function failedStartupState(error: YouTubeApiError, connectivityFailure: boolean): StartupState {
  return connectivityFailure ? { status: 'offline' } : { status: 'error', error };
}
