import {
  VideoPlaybackContentType,
  YouTubeVideo,
  hasNativePlaybackSource,
  isValidYouTubeVideoId
} from '../core';
import {
  PlaybackDescriptor,
  PlaybackPlatformSupport,
  PlaybackUnavailableReason,
  PlayerCapabilities
} from './types';

export function resolvePlaybackDescriptor(item: YouTubeVideo): PlaybackDescriptor {
  if (!isValidYouTubeVideoId(item.id)) {
    return { kind: 'unavailable', item, reason: 'invalid-video-id' };
  }

  if (hasNativePlaybackSource(item)) {
    return {
      kind: 'native-direct',
      item,
      source: {
        uri: item.playbackUrl,
        contentType: normalizeNativeContentType(item.playbackContentType),
        metadata: {
          title: item.title,
          artist: item.channelName,
          artwork: item.thumbnailUrl
        }
      }
    };
  }

  if (item.availability !== 'public') {
    return { kind: 'unavailable', item, reason: availabilityReason(item) };
  }

  if (!item.embeddable) {
    return { kind: 'unavailable', item, reason: 'embedding-disabled' };
  }

  return { kind: 'youtube-embed', item, videoId: item.id };
}

export function capabilitiesForPlayback(
  descriptor: PlaybackDescriptor,
  platform: PlaybackPlatformSupport
): PlayerCapabilities {
  if (descriptor.kind === 'native-direct') {
    return {
      backgroundPlayback: platform.backgroundPlayback,
      pictureInPicture: platform.pictureInPicture,
      airPlay: platform.airPlay,
      nowPlaying: platform.nowPlaying,
      playbackRate: true,
      customSeeking: true,
      miniPlayer: true
    };
  }

  if (descriptor.kind === 'youtube-embed') {
    return {
      backgroundPlayback: false,
      pictureInPicture: false,
      airPlay: false,
      nowPlaying: false,
      playbackRate: true,
      customSeeking: true,
      miniPlayer: true
    };
  }

  return {
    backgroundPlayback: false,
    pictureInPicture: false,
    airPlay: false,
    nowPlaying: false,
    playbackRate: false,
    customSeeking: false,
    miniPlayer: false
  };
}

function normalizeNativeContentType(value: VideoPlaybackContentType | undefined): VideoPlaybackContentType {
  return value ?? 'auto';
}

function availabilityReason(item: YouTubeVideo): PlaybackUnavailableReason {
  if (item.availability === 'private') {
    return 'private';
  }
  if (item.availability === 'deleted') {
    return 'deleted';
  }
  if (item.availability === 'ageRestricted') {
    return 'age-restricted';
  }
  if (item.availability === 'embeddingDisabled') {
    return 'embedding-disabled';
  }
  return 'unknown';
}
