import { Capacitor, registerPlugin } from '@capacitor/core';
import { webPlatform } from './webPlatform.js';

const nativePlugins = {
  App: registerPlugin('App'),
  Browser: registerPlugin('Browser'),
  Filesystem: registerPlugin('Filesystem'),
  Geolocation: registerPlugin('Geolocation'),
  Haptics: registerPlugin('Haptics'),
  Network: registerPlugin('Network'),
  Share: registerPlugin('Share'),
};

let cachedNetworkStatus = webPlatform.getNetworkStatus();

function isNativeRuntime() {
  return !!Capacitor?.isNativePlatform?.();
}

function canUsePlugin(name) {
  return isNativeRuntime() && !!Capacitor?.isPluginAvailable?.(name);
}

function asBlob(content, mimeType = 'application/octet-stream') {
  if (content instanceof Blob) return content;
  return new Blob([content ?? ''], { type: mimeType });
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
}

async function blobToBase64(blob) {
  const dataUrl = await readBlobAsDataUrl(blob);
  return String(dataUrl).split(',')[1] || '';
}

function safeNativeFilename(filename) {
  return String(filename || `mapping-elf-${Date.now()}`)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || `mapping-elf-${Date.now()}`;
}

async function writeNativeCacheFile({ filename, mimeType, content }) {
  const safeName = safeNativeFilename(filename);
  const path = `exports/${Date.now()}-${safeName}`;
  const data = await blobToBase64(asBlob(content, mimeType));
  await nativePlugins.Filesystem.writeFile({
    path,
    data,
    directory: 'CACHE',
    recursive: true,
  });
  const result = await nativePlugins.Filesystem.getUri({
    path,
    directory: 'CACHE',
  });
  return {
    filename: safeName,
    uri: result?.uri || result?.path || path,
  };
}

async function shareNativeFile({ filename, mimeType = 'application/octet-stream', content }) {
  const file = await writeNativeCacheFile({ filename, mimeType, content });
  await nativePlugins.Share.share({
    title: file.filename,
    dialogTitle: file.filename,
    files: [file.uri],
    url: file.uri,
  });
}

function normalizeNetworkStatus(status) {
  return {
    connected: status?.connected !== false,
    connectionType: status?.connectionType || 'unknown',
  };
}

async function refreshNativeNetworkStatus() {
  if (!canUsePlugin('Network')) return cachedNetworkStatus;
  const status = normalizeNetworkStatus(await nativePlugins.Network.getStatus());
  cachedNetworkStatus = status;
  return status;
}

function normalizeVibrationDuration(pattern) {
  if (Array.isArray(pattern)) {
    const total = pattern.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    return Math.max(1, Math.min(1000, total || 40));
  }
  return Math.max(1, Math.min(1000, Number(pattern) || 40));
}

if (isNativeRuntime()) {
  refreshNativeNetworkStatus().catch(() => {});
}

export const capacitorPlatform = {
  ...webPlatform,
  name: 'capacitor',
  get isNative() {
    return isNativeRuntime();
  },
  isAvailable: isNativeRuntime,
  getPlatform() {
    return Capacitor?.getPlatform?.() || 'web';
  },
  async openExternalUrl(url) {
    if (!canUsePlugin('Browser')) {
      return webPlatform.openExternalUrl(url);
    }
    try {
      await nativePlugins.Browser.open({ url });
    } catch (err) {
      console.warn('Native browser open failed; falling back to web open.', err);
      webPlatform.openExternalUrl(url);
    }
  },
  async downloadFile(payload) {
    if (!canUsePlugin('Filesystem') || !canUsePlugin('Share')) {
      return webPlatform.downloadFile(payload);
    }
    try {
      await shareNativeFile(payload);
    } catch (err) {
      console.warn('Native file export failed; falling back to web download.', err);
      await webPlatform.downloadFile(payload);
    }
  },
  async shareFile(payload) {
    if (!canUsePlugin('Filesystem') || !canUsePlugin('Share')) {
      return webPlatform.shareFile(payload);
    }
    try {
      await shareNativeFile(payload);
    } catch (err) {
      console.warn('Native file share failed; falling back to web share.', err);
      await webPlatform.shareFile(payload);
    }
  },
  async getCurrentPosition(options) {
    if (!canUsePlugin('Geolocation')) {
      return webPlatform.getCurrentPosition(options);
    }
    return nativePlugins.Geolocation.getCurrentPosition(options || {});
  },
  vibrate(pattern) {
    if (!canUsePlugin('Haptics')) {
      return webPlatform.vibrate(pattern);
    }
    nativePlugins.Haptics.vibrate({ duration: normalizeVibrationDuration(pattern) })
      .catch(() => webPlatform.vibrate(pattern));
  },
  getNetworkStatus() {
    if (canUsePlugin('Network')) {
      refreshNativeNetworkStatus().catch(() => {});
    }
    return cachedNetworkStatus;
  },
  subscribeNetworkStatus(callback) {
    if (!canUsePlugin('Network') || typeof callback !== 'function') {
      return webPlatform.subscribeNetworkStatus(callback);
    }

    let disposed = false;
    refreshNativeNetworkStatus()
      .then((status) => {
        if (!disposed) callback(status);
      })
      .catch(() => {});

    const handlePromise = nativePlugins.Network.addListener('networkStatusChange', (status) => {
      cachedNetworkStatus = normalizeNetworkStatus(status);
      callback(cachedNetworkStatus);
    });

    return () => {
      disposed = true;
      handlePromise.then((handle) => handle?.remove?.()).catch(() => {});
    };
  },
  subscribeBackButton(callback) {
    if (!canUsePlugin('App') || typeof callback !== 'function') return () => {};
    const handlePromise = nativePlugins.App.addListener('backButton', callback);
    return () => {
      handlePromise.then((handle) => handle?.remove?.()).catch(() => {});
    };
  },
  exitApp() {
    if (!canUsePlugin('App')) return false;
    nativePlugins.App.exitApp().catch(() => {});
    return true;
  },
};
