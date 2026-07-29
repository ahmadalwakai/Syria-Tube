import React, { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { PlayerCommand, PlayerState, isValidYouTubeVideoId } from './core';
import {
  getYouTubePlayerErrorMessage,
  mapYouTubeIframeState,
  parseYouTubePlayerEvent
} from './player/adapters/YouTubePlaybackAdapter';

const youtubeEmbedOrigin = 'https://syriatube.local';
const webViewOriginWhitelist = [youtubeEmbedOrigin, 'https://www.youtube.com', 'https://m.youtube.com'];

export function YouTubePlayer({
  videoId,
  command,
  repeatOne,
  onCommandHandled,
  onReady,
  onProgress,
  onStateChange,
  onError
}: {
  videoId: string;
  command: PlayerCommand | null;
  repeatOne: boolean;
  onCommandHandled: () => void;
  onReady: () => void;
  onProgress: (position: number, duration: number) => void;
  onStateChange: (state: PlayerState, position: number, duration: number) => void;
  onError: (message: string) => void;
}) {
  const webViewRef = useRef<WebView>(null);
  const instanceId = useRef(`youtube:${videoId}:${Math.random().toString(36).slice(2)}`).current;
  const html = useMemo(() => buildPlayerHtml(videoId, instanceId), [instanceId, videoId]);
  const iframeSrc = useMemo(() => buildWebEmbedUrl(videoId), [videoId]);

  useEffect(() => {
    if (!isValidYouTubeVideoId(videoId)) {
      onError('The selected video id is invalid.');
    }
  }, [videoId, onError]);

  useEffect(() => {
    if (!command) {
      return;
    }
    webViewRef.current?.injectJavaScript(commandScript(command));
    onCommandHandled();
  }, [command, onCommandHandled]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(`window.syriaTubePlayer && window.syriaTubePlayer.repeatOne(${repeatOne ? 'true' : 'false'}); true;`);
  }, [repeatOne]);

  function handleMessage(event: WebViewMessageEvent) {
    const parsed = parseYouTubePlayerEvent(event.nativeEvent.data, instanceId);
    if (parsed.status === 'stale') {
      return;
    }
    if (parsed.status === 'invalid') {
      onStateChange('error', 0, 0);
      onError('The embedded YouTube player sent an unreadable event.');
      return;
    }
    const payload = parsed.event;
    if (payload.type === 'ready') {
      onReady();
      onStateChange('ready', payload.position, payload.duration);
    }
    if (payload.type === 'state') {
      const state = mapYouTubeIframeState(payload.state);
      onStateChange(state, payload.position, payload.duration);
      if (payload.duration > 0) {
        onProgress(payload.position, payload.duration);
      }
    }
    if (payload.type === 'error') {
      onStateChange('error', 0, 0);
      onError(getYouTubePlayerErrorMessage(payload.code));
    }
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.webView}>
        {React.createElement('iframe', {
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          allowFullScreen: true,
          onLoad: () => {
            onReady();
            onStateChange('ready', 0, 0);
          },
          src: iframeSrc,
          style: webIframeStyle,
          title: `YouTube video ${videoId}`
        })}
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ html, baseUrl: youtubeEmbedOrigin }}
      originWhitelist={webViewOriginWhitelist}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      allowsPictureInPictureMediaPlayback
      allowsAirPlayForMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      onMessage={handleMessage}
      onError={() => onError('The YouTube player could not connect.')}
      onHttpError={() => onError('The YouTube player failed to load.')}
      style={styles.webView}
      scrollEnabled={false}
      bounces={false}
      allowsFullscreenVideo
    />
  );
}

function buildWebEmbedUrl(videoId: string): string {
  const safeVideoId = isValidYouTubeVideoId(videoId) ? videoId : '';
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0'
  });
  return `https://www.youtube.com/embed/${safeVideoId}?${params}`;
}

function commandScript(command: PlayerCommand): string {
  if (typeof command !== 'string') {
    if (command.type === 'seekTo') {
      return `window.syriaTubePlayer && window.syriaTubePlayer.seekTo(${safeNumber(command.seconds, 0)}); true;`;
    }
    if (command.type === 'setPlaybackRate') {
      return `window.syriaTubePlayer && window.syriaTubePlayer.setPlaybackRate(${safeNumber(command.rate, 1)}); true;`;
    }
    return `window.syriaTubePlayer && window.syriaTubePlayer.setVolume(${safeNumber(command.volume, 100)}); true;`;
  }
  switch (command) {
    case 'play':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.play(); true;';
    case 'pause':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.pause(); true;';
    case 'stop':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.stop(); true;';
    case 'seekBackward10':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.seekBy(-10); true;';
    case 'seekForward10':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.seekBy(10); true;';
    case 'replay':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.replay(); true;';
  }
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function buildPlayerHtml(videoId: string, instanceId: string): string {
  const safeVideoId = isValidYouTubeVideoId(videoId) ? videoId : '';
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <style>
    html, body, #player {
      background: #101616;
      height: 100%;
      margin: 0;
      overflow: hidden;
      padding: 0;
      width: 100%;
    }
  </style>
</head>
<body>
  <div id="player"></div>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script>
    var player;
    var repeatOneEnabled = false;
    var progressTimer = null;

    function post(payload) {
      payload.instanceId = '${instanceId}';
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    function currentTime() {
      try { return player && player.getCurrentTime ? player.getCurrentTime() : 0; } catch (error) { return 0; }
    }

    function duration() {
      try { return player && player.getDuration ? player.getDuration() : 0; } catch (error) { return 0; }
    }

    function postState(state) {
      post({ type: 'state', state: state, position: currentTime(), duration: duration() });
    }

    function ensureProgressTimer() {
      if (progressTimer !== null) { return; }
      progressTimer = window.setInterval(function() {
        if (player && player.getPlayerState) {
          var state = player.getPlayerState();
          if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED || state === YT.PlayerState.BUFFERING) {
            postState(state);
          }
        }
      }, 3000);
    }

    function clearProgressTimer() {
      if (progressTimer !== null) {
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
    }

    function onYouTubeIframeAPIReady() {
      player = new YT.Player('player', {
        width: '100%',
        height: '100%',
        videoId: '${safeVideoId}',
        playerVars: {
          playsinline: 1,
          controls: 1,
          enablejsapi: 1,
          rel: 0,
          origin: '${youtubeEmbedOrigin}'
        },
        events: {
          onReady: function() {
            ensureProgressTimer();
            post({ type: 'ready', position: currentTime(), duration: duration() });
          },
          onStateChange: function(event) {
            if (event.data === YT.PlayerState.ENDED && repeatOneEnabled) {
              player.seekTo(0, true);
              player.playVideo();
            }
            postState(event.data);
          },
          onError: function(event) {
            post({ type: 'error', code: event.data });
          }
        }
      });
    }

    window.syriaTubePlayer = {
      play: function() { if (player && player.playVideo) { player.playVideo(); } },
      pause: function() { if (player && player.pauseVideo) { player.pauseVideo(); postState(YT.PlayerState.PAUSED); } },
      stop: function() { if (player && player.stopVideo) { player.stopVideo(); postState(YT.PlayerState.ENDED); } clearProgressTimer(); },
      seekBy: function(delta) {
        if (!player || !player.seekTo) { return; }
        var target = Math.max(0, currentTime() + delta);
        player.seekTo(target, true);
        postState(player.getPlayerState ? player.getPlayerState() : -1);
      },
      seekTo: function(seconds) {
        if (!player || !player.seekTo) { return; }
        var target = Math.max(0, Number(seconds) || 0);
        player.seekTo(target, true);
        postState(player.getPlayerState ? player.getPlayerState() : -1);
      },
      setPlaybackRate: function(rate) {
        if (!player || !player.setPlaybackRate) { return; }
        var target = Math.max(0.25, Math.min(2, Number(rate) || 1));
        player.setPlaybackRate(target);
        postState(player.getPlayerState ? player.getPlayerState() : -1);
      },
      setVolume: function(volume) {
        if (!player || !player.setVolume) { return; }
        var target = Math.max(0, Math.min(100, Number(volume) || 0));
        player.setVolume(target);
        if (target > 0 && player.unMute) { player.unMute(); }
        if (target === 0 && player.mute) { player.mute(); }
        postState(player.getPlayerState ? player.getPlayerState() : -1);
      },
      replay: function() {
        if (!player || !player.seekTo) { return; }
        player.seekTo(0, true);
        if (player.playVideo) { player.playVideo(); }
      },
      repeatOne: function(enabled) {
        repeatOneEnabled = enabled === true;
      }
    };

    window.addEventListener('pagehide', function() {
      if (player && player.getPlayerState) { postState(player.getPlayerState()); }
    });

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        ensureProgressTimer();
      }
      if (player && player.getPlayerState) { postState(player.getPlayerState()); }
    });
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  webView: {
    backgroundColor: '#101616',
    flex: 1
  }
});

const webIframeStyle = {
  backgroundColor: '#101616',
  border: 0,
  display: 'block',
  height: '100%',
  width: '100%'
};
