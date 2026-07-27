import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { PlayerCommand, isValidYouTubeVideoId } from './core';

type PlayerEvent =
  | { type: 'ready' }
  | { type: 'state'; state: number; position: number; duration: number }
  | { type: 'error'; code: number };

const playerErrors: Record<number, string> = {
  2: 'This video could not be loaded.',
  5: 'This video cannot be played in the embedded HTML5 player.',
  100: 'This video is unavailable.',
  101: 'The owner has disabled embedded playback.',
  150: 'The owner has disabled embedded playback.',
  153: 'The player request is missing required client identity.'
};

export function YouTubePlayer({
  videoId,
  command,
  repeatOne,
  onCommandHandled,
  onReady,
  onProgress,
  onError
}: {
  videoId: string;
  command: PlayerCommand | null;
  repeatOne: boolean;
  onCommandHandled: () => void;
  onReady: () => void;
  onProgress: (position: number, duration: number) => void;
  onError: (message: string) => void;
}) {
  const webViewRef = useRef<WebView>(null);
  const html = useMemo(() => buildPlayerHtml(videoId), [videoId]);

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
    try {
      const payload = JSON.parse(event.nativeEvent.data) as PlayerEvent;
      if (payload.type === 'ready') {
        onReady();
      }
      if (payload.type === 'state' && payload.duration > 0) {
        onProgress(payload.position, payload.duration);
      }
      if (payload.type === 'error') {
        onError(playerErrors[payload.code] ?? `The embedded player reported error ${payload.code}.`);
      }
    } catch {
      onError('The embedded player sent an unreadable event.');
    }
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ html, baseUrl: 'https://syriatube.local' }}
      originWhitelist={['https://*']}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      onMessage={handleMessage}
      style={styles.webView}
      scrollEnabled={false}
      bounces={false}
      allowsFullscreenVideo
    />
  );
}

function commandScript(command: PlayerCommand): string {
  switch (command) {
    case 'play':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.play(); true;';
    case 'pause':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.pause(); true;';
    case 'seekBackward10':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.seekBy(-10); true;';
    case 'seekForward10':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.seekBy(10); true;';
    case 'replay':
      return 'window.syriaTubePlayer && window.syriaTubePlayer.replay(); true;';
  }
}

function buildPlayerHtml(videoId: string): string {
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
        if (player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
          postState(YT.PlayerState.PLAYING);
        }
      }, 5000);
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
          origin: 'https://syriatube.local'
        },
        events: {
          onReady: function() {
            ensureProgressTimer();
            post({ type: 'ready' });
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
      pause: function() { if (player && player.pauseVideo) { player.pauseVideo(); } },
      seekBy: function(delta) {
        if (!player || !player.seekTo) { return; }
        var target = Math.max(0, currentTime() + delta);
        player.seekTo(target, true);
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
