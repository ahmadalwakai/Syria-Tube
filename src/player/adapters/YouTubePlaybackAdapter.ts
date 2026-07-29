import { PlayerState } from '../../core';

export type YouTubePlayerEvent =
  | { type: 'ready'; position: number; duration: number; instanceId?: string }
  | { type: 'state'; state: number; position: number; duration: number; instanceId?: string }
  | { type: 'error'; code: number; instanceId?: string };

export type ParsedYouTubePlayerEvent =
  | { status: 'ok'; event: YouTubePlayerEvent }
  | { status: 'stale' }
  | { status: 'invalid' };

const playerErrors: Record<number, string> = {
  2: 'The selected YouTube video id is malformed.',
  5: 'This video cannot be played in the embedded YouTube player.',
  100: 'This video is unavailable, private, or deleted.',
  101: 'The owner has disabled embedded playback.',
  150: 'The owner has disabled embedded playback.',
  153: 'The player request is missing required client identity.'
};

const stateMap: Record<number, PlayerState> = {
  [-1]: 'idle',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'ready'
};

export function parseYouTubePlayerEvent(data: string, expectedInstanceId?: string): ParsedYouTubePlayerEvent {
  try {
    const payload = JSON.parse(data) as YouTubePlayerEvent;
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return { status: 'invalid' };
    }
    if (expectedInstanceId && payload.instanceId && payload.instanceId !== expectedInstanceId) {
      return { status: 'stale' };
    }
    if (payload.type === 'ready' && isFinitePlayerTime(payload.position) && isFinitePlayerTime(payload.duration)) {
      return { status: 'ok', event: payload };
    }
    if (payload.type === 'state' && Number.isFinite(payload.state) && isFinitePlayerTime(payload.position) && isFinitePlayerTime(payload.duration)) {
      return { status: 'ok', event: payload };
    }
    if (payload.type === 'error' && Number.isFinite(payload.code)) {
      return { status: 'ok', event: payload };
    }
    return { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
}

export function mapYouTubeIframeState(state: number): PlayerState {
  return stateMap[state] ?? 'idle';
}

export function getYouTubePlayerErrorMessage(code: number): string {
  return playerErrors[code] ?? `The embedded YouTube player reported error ${code}.`;
}

function isFinitePlayerTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
