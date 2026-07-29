import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, StyleSheet } from 'react-native';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';

import { PlayerCommand, PlayerState, YouTubeVideo } from './core';

export function NativeVideoPlayer({
  video,
  source,
  command,
  repeatOne,
  shouldAutoPlay,
  onCommandHandled,
  onReady,
  onProgress,
  onStateChange,
  onError
}: {
  video: YouTubeVideo;
  source: VideoSource;
  command: PlayerCommand | null;
  repeatOne: boolean;
  shouldAutoPlay: boolean;
  onCommandHandled: () => void;
  onReady: () => void;
  onProgress: (position: number, duration: number) => void;
  onStateChange: (state: PlayerState, position: number, duration: number) => void;
  onError: (message: string) => void;
}) {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lockScreenRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useVideoPlayer(
    source,
    (instance) => {
      instance.loop = repeatOne;
      configureBackgroundPlayback(instance);
      if (shouldAutoPlay) {
        instance.play();
      }
    },
    {
      seekBackwardIncrement: 10,
      seekForwardIncrement: 10
    }
  );

  useEffect(() => {
    player.loop = repeatOne;
  }, [player, repeatOne]);

  useEffect(() => {
    configureBackgroundPlayback(player);
  }, [player]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState.current === 'active';
      appState.current = nextState;
      if (lockScreenRetry.current) {
        clearTimeout(lockScreenRetry.current);
        lockScreenRetry.current = null;
      }
      if (wasActive && nextState !== 'active' && shouldAutoPlay) {
        keepPlayingAfterScreenLock(player, onStateChange);
        lockScreenRetry.current = setTimeout(() => {
          keepPlayingAfterScreenLock(player, onStateChange);
          lockScreenRetry.current = null;
        }, 650);
      }
    });
    return () => {
      if (lockScreenRetry.current) {
        clearTimeout(lockScreenRetry.current);
        lockScreenRetry.current = null;
      }
      subscription.remove();
    };
  }, [onStateChange, player, shouldAutoPlay]);

  useEffect(() => {
    if (!source) {
      onError('This video does not include a native playback source.');
    }
  }, [onError, source]);

  useEffect(() => {
    if (!command) {
      return;
    }
    try {
      runCommand(player, command);
      emitCurrentState(player, onStateChange);
    } catch {
      onError('The native player could not handle this playback command.');
    } finally {
      onCommandHandled();
    }
  }, [command, onCommandHandled, onError, onStateChange, player]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    const position = safeTime(player.currentTime);
    const duration = safeDuration(player.duration);
    if (status === 'readyToPlay') {
      onReady();
    }
    if (status === 'error') {
      onError(error?.message ?? 'The native player could not play this video.');
    }
    onStateChange(mapStatus(status, player.playing), position, duration);
  });

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    onReady();
    onStateChange(player.playing ? 'playing' : 'ready', safeTime(player.currentTime), safeDuration(duration));
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    onStateChange(isPlaying ? 'playing' : mapStatus(player.status, false), safeTime(player.currentTime), safeDuration(player.duration));
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const position = safeTime(currentTime);
    const duration = safeDuration(player.duration);
    if (duration > 0) {
      onProgress(position, duration);
    }
    onStateChange(player.playing ? 'playing' : mapStatus(player.status, false), position, duration);
  });

  useEventListener(player, 'playToEnd', () => {
    const duration = safeDuration(player.duration);
    onStateChange('ended', duration, duration);
    if (duration > 0) {
      onProgress(duration, duration);
    }
  });

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls={false}
      contentFit="contain"
      allowsPictureInPicture
      startsPictureInPictureAutomatically={false}
      allowsVideoFrameAnalysis={false}
      fullscreenOptions={{ enable: true, keepFullscreenOnPiPStop: 'autoEnter' }}
      onPictureInPictureStart={() => onStateChange(player.playing ? 'playing' : mapStatus(player.status, false), safeTime(player.currentTime), safeDuration(player.duration))}
      onPictureInPictureStop={() => onStateChange(player.playing ? 'playing' : mapStatus(player.status, false), safeTime(player.currentTime), safeDuration(player.duration))}
    />
  );
}

function configureBackgroundPlayback(player: ReturnType<typeof useVideoPlayer>) {
  player.audioMixingMode = 'doNotMix';
  player.staysActiveInBackground = true;
  player.showNowPlayingNotification = true;
  player.allowsExternalPlayback = true;
  player.keepScreenOnWhilePlaying = true;
  player.timeUpdateEventInterval = 1;
}

function keepPlayingAfterScreenLock(
  player: ReturnType<typeof useVideoPlayer>,
  onStateChange: (state: PlayerState, position: number, duration: number) => void
) {
  configureBackgroundPlayback(player);
  if (player.status === 'error' || player.playing) {
    return;
  }
  player.play();
  emitCurrentState(player, onStateChange);
}

function runCommand(player: ReturnType<typeof useVideoPlayer>, command: PlayerCommand) {
  if (typeof command !== 'string') {
    if (command.type === 'seekTo') {
      player.currentTime = Math.max(0, command.seconds);
      return;
    }
    if (command.type === 'setPlaybackRate') {
      player.playbackRate = clamp(command.rate, 0.25, 2);
      return;
    }
    const volume = clamp(command.volume, 0, 100);
    player.volume = volume / 100;
    player.muted = volume === 0;
    return;
  }

  switch (command) {
    case 'play':
      player.play();
      return;
    case 'pause':
      player.pause();
      return;
    case 'stop':
      player.pause();
      player.currentTime = 0;
      return;
    case 'seekBackward10':
      player.seekBy(-10);
      return;
    case 'seekForward10':
      player.seekBy(10);
      return;
    case 'replay':
      player.replay();
      player.play();
      return;
  }
}

function emitCurrentState(player: ReturnType<typeof useVideoPlayer>, onStateChange: (state: PlayerState, position: number, duration: number) => void) {
  onStateChange(player.playing ? 'playing' : mapStatus(player.status, false), safeTime(player.currentTime), safeDuration(player.duration));
}

function mapStatus(status: string, playing: boolean): PlayerState {
  if (playing) {
    return 'playing';
  }
  if (status === 'loading') {
    return 'buffering';
  }
  if (status === 'readyToPlay') {
    return 'paused';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'idle';
}

function safeTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  video: {
    backgroundColor: '#101616',
    flex: 1
  }
});
