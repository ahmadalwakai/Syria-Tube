import type { VideoSource } from 'expo-video';

import type { YouTubeVideo } from '../core';

export type PlaybackUnavailableReason =
  | 'invalid-video-id'
  | 'private'
  | 'deleted'
  | 'age-restricted'
  | 'region-restricted'
  | 'embedding-disabled'
  | 'native-source-missing'
  | 'unsupported-source'
  | 'unknown';

export type PlaybackDescriptor =
  | {
      kind: 'youtube-embed';
      item: YouTubeVideo;
      videoId: string;
    }
  | {
      kind: 'native-direct';
      item: YouTubeVideo;
      source: VideoSource;
    }
  | {
      kind: 'unavailable';
      item: YouTubeVideo;
      reason: PlaybackUnavailableReason;
    };

export type PlayerCapabilities = {
  backgroundPlayback: boolean;
  pictureInPicture: boolean;
  airPlay: boolean;
  nowPlaying: boolean;
  playbackRate: boolean;
  customSeeking: boolean;
  miniPlayer: boolean;
};

export type PlayerPhase =
  | 'idle'
  | 'resolving'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'interrupted'
  | 'ended'
  | 'recovering'
  | 'error';

export type PlayerPresentation =
  | 'hidden'
  | 'expanded'
  | 'sticky'
  | 'mini'
  | 'fullscreen'
  | 'picture-in-picture';

export type PlaybackPlatformSupport = {
  backgroundPlayback: boolean;
  pictureInPicture: boolean;
  airPlay: boolean;
  nowPlaying: boolean;
};
