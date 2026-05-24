import { capacitorPlatform } from './capacitorPlatform.js';
import { webPlatform } from './webPlatform.js';

export const platform = capacitorPlatform.isAvailable() ? capacitorPlatform : webPlatform;
export { capacitorPlatform, webPlatform };
