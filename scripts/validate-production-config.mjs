import { readFileSync } from 'node:fs';

const variableName = 'EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL';
const productionProfile = 'production';

const shouldValidate =
  process.argv.includes('--production') ||
  process.env.EAS_BUILD_PROFILE === productionProfile ||
  process.env.NODE_ENV === productionProfile;

if (!shouldValidate) {
  console.log('Syria Tube production config validation skipped for non-production build.');
  process.exit(0);
}

const value = process.env[variableName]?.trim();
if (!value) {
  fail(`${variableName} is required for production builds.`);
}

let parsed;
try {
  parsed = new URL(value);
} catch {
  fail(`${variableName} must be a valid absolute URL.`);
}

if (parsed.protocol !== 'https:') {
  fail(`${variableName} must use HTTPS for production builds.`);
}

if (isDevelopmentOnlyHost(parsed.hostname)) {
  fail(`${variableName} must not point to localhost, loopback, link-local, or private LAN hosts in production builds.`);
}

if (isTemporaryTunnelHost(parsed.hostname)) {
  fail(`${variableName} must not point to a temporary Cloudflare quick tunnel in production builds.`);
}

validateExpoMediaConfig();
validateNativeExpoVideoPatch();

console.log(`Syria Tube production config ok: API host ${parsed.hostname}; native background playback enabled`);

function fail(message) {
  console.error(`Syria Tube production config error: ${message}`);
  process.exit(1);
}

function validateExpoMediaConfig() {
  let appConfig;
  try {
    appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  } catch {
    fail('app.json must be readable during production validation.');
  }

  const expoConfig = appConfig.expo;
  const infoPlist = expoConfig?.ios?.infoPlist ?? {};
  const backgroundModes = Array.isArray(infoPlist.UIBackgroundModes) ? infoPlist.UIBackgroundModes : [];
  if (!backgroundModes.includes('audio')) {
    fail('iOS production builds must enable UIBackgroundModes audio for lock-screen playback.');
  }

  if (infoPlist.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true) {
    fail('iOS production builds must not enable NSAllowsArbitraryLoads.');
  }

  const plugins = Array.isArray(expoConfig?.plugins) ? expoConfig.plugins : [];
  const expoVideoPlugin = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-video');
  const expoVideoOptions = Array.isArray(expoVideoPlugin) ? expoVideoPlugin[1] : null;
  if (expoVideoOptions?.supportsBackgroundPlayback !== true) {
    fail('expo-video must enable supportsBackgroundPlayback for lock-screen playback.');
  }

  if (expoVideoOptions?.supportsPictureInPicture !== true) {
    fail('expo-video must enable supportsPictureInPicture for the native player.');
  }
}

function validateNativeExpoVideoPatch() {
  let videoPlayerSource;
  let videoManagerSource;
  try {
    videoPlayerSource = readFileSync(new URL('../node_modules/expo-video/ios/VideoPlayer.swift', import.meta.url), 'utf8');
    videoManagerSource = readFileSync(new URL('../node_modules/expo-video/ios/VideoManager.swift', import.meta.url), 'utf8');
  } catch {
    fail('expo-video iOS native sources must be installed before production validation.');
  }

  if (!videoPlayerSource.includes('func applyBackgroundPlaybackPolicy()')) {
    fail('expo-video iOS background playback patch is missing from VideoPlayer.swift.');
  }

  if (!videoPlayerSource.includes('ref.audiovisualBackgroundPlaybackPolicy = staysActiveInBackground ? .continuesIfPossible : .pauses')) {
    fail('expo-video iOS AVPlayer policy must be set eagerly for lock-screen playback.');
  }

  if (!videoManagerSource.includes('player.applyBackgroundPlaybackPolicy()')) {
    fail('expo-video iOS background manager must reuse the eager background playback policy.');
  }
}

function isDevelopmentOnlyHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized)
  );
}

function isTemporaryTunnelHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'trycloudflare.com' || normalized.endsWith('.trycloudflare.com');
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}
