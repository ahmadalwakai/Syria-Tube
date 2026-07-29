import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const videoPlayerPath = path.join(projectRoot, 'node_modules', 'expo-video', 'ios', 'VideoPlayer.swift');
const videoManagerPath = path.join(projectRoot, 'node_modules', 'expo-video', 'ios', 'VideoManager.swift');

patchVideoPlayer();
patchVideoManager();

console.log('Syria Tube expo-video iOS background patch ok.');

function patchVideoPlayer() {
  patchFile(videoPlayerPath, [
    {
      label: 'apply policy when staysActiveInBackground changes',
      applied: 'applyBackgroundPlaybackPolicy()',
      find: `  var staysActiveInBackground = false {
    didSet {
      if staysActiveInBackground {
        VideoManager.shared.setAppropriateAudioSessionOrWarn()
      }
    }
  }`,
      replace: `  var staysActiveInBackground = false {
    didSet {
      applyBackgroundPlaybackPolicy()
      if staysActiveInBackground {
        VideoManager.shared.setAppropriateAudioSessionOrWarn()
      }
    }
  }`
    },
    {
      label: 'initialize AVPlayer background policy eagerly',
      applied: 'VideoManager.shared.register(videoPlayer: self)\n    applyBackgroundPlaybackPolicy()',
      find: '    VideoManager.shared.register(videoPlayer: self)',
      replace: `    VideoManager.shared.register(videoPlayer: self)
    applyBackgroundPlaybackPolicy()`
    },
    {
      label: 'define AVPlayer background policy helper',
      applied: 'func applyBackgroundPlaybackPolicy()',
      find: `  deinit {
    releasePlayer()
  }`,
      replace: `  func applyBackgroundPlaybackPolicy() {
    ref.audiovisualBackgroundPlaybackPolicy = staysActiveInBackground ? .continuesIfPossible : .pauses
  }

  deinit {
    releasePlayer()
  }`
    }
  ]);
}

function patchVideoManager() {
  patchFile(videoManagerPath, [
    {
      label: 'refresh audio session before background transition loop',
      applied: `  func onAppBackgrounded() {
    setAppropriateAudioSessionOrWarn()`,
      find: '  func onAppBackgrounded() {',
      replace: `  func onAppBackgrounded() {
    setAppropriateAudioSessionOrWarn()`
    },
    {
      label: 'reuse eager background policy helper',
      applied: 'player.applyBackgroundPlaybackPolicy()',
      find: '        player.ref.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible',
      replace: '        player.applyBackgroundPlaybackPolicy()'
    }
  ]);
}

function patchFile(filePath, patches) {
  let source;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    fail(`Could not read ${path.relative(projectRoot, filePath)}. Run npm install first.`);
  }

  let next = source;
  for (const patch of patches) {
    if (next.includes(patch.applied)) {
      continue;
    }
    if (!next.includes(patch.find)) {
      fail(`Could not apply ${patch.label} in ${path.relative(projectRoot, filePath)}.`);
    }
    next = next.replace(patch.find, patch.replace);
  }

  if (next !== source) {
    writeFileSync(filePath, next);
  }
}

function fail(message) {
  console.error(`Syria Tube expo-video iOS background patch error: ${message}`);
  process.exit(1);
}
