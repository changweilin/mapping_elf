import { Capacitor } from '@capacitor/core';
import { webPlatform } from './webPlatform.js';

function isNativeRuntime() {
  return !!Capacitor?.isNativePlatform?.();
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
};
