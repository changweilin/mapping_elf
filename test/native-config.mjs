import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, expected, label) {
  assert(text.includes(expected), `${label} is missing ${expected}`);
}

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const capacitorConfig = readJson('capacitor.config.json');
const androidBuildGradle = readText('android/app/build.gradle');
const androidManifest = readText('android/app/src/main/AndroidManifest.xml');
const androidMainActivity = readText('android/app/src/main/java/com/mappingelf/app/MainActivity.java');
const androidOfflineMapsPlugin = readText('android/app/src/main/java/com/mappingelf/app/OfflineMapsPlugin.java');
const iosProject = readText('ios/App/App.xcodeproj/project.pbxproj');
const iosInfoPlist = readText('ios/App/App/Info.plist');

const appVersion = packageJson.version;

assert(appVersion === '1.0.0', `package.json version should be 1.0.0, got ${appVersion}`);
assert(packageLock.version === appVersion, 'package-lock top-level version should match package.json');
assert(packageLock.packages?.['']?.version === appVersion, 'package-lock root package version should match package.json');
assert(capacitorConfig.appendUserAgent === `MappingElf/${appVersion}`, 'Capacitor appendUserAgent should include the app version');

assertIncludes(androidBuildGradle, 'versionCode 1', 'Android build.gradle');
assertIncludes(androidBuildGradle, `versionName "${appVersion}"`, 'Android build.gradle');
assertIncludes(androidBuildGradle, "def keystorePropertiesFile = rootProject.file('keystore.properties')", 'Android release signing config');
assertIncludes(androidBuildGradle, 'signingConfigs.release', 'Android release signing config');
assertIncludes(androidBuildGradle, 'org.mapsforge:mapsforge-map-android:0.25.0', 'Android Mapsforge renderer dependency');
assertIncludes(androidBuildGradle, 'org.mapsforge:mapsforge-map-reader:0.25.0', 'Android Mapsforge map reader dependency');

assertIncludes(androidManifest, 'android:allowBackup="false"', 'Android manifest privacy setting');
assertIncludes(androidManifest, 'android.intent.action.VIEW', 'Android manifest file-open intent filter');
assertIncludes(androidMainActivity, 'registerPlugin(OfflineMapsPlugin.class)', 'Android native offline maps plugin registration');
assertIncludes(androidOfflineMapsPlugin, '@CapacitorPlugin(name = "OfflineMaps")', 'Android native offline maps plugin');
assertIncludes(androidOfflineMapsPlugin, 'ACTION_OPEN_DOCUMENT', 'Android native offline maps picker');
assertIncludes(androidOfflineMapsPlugin, 'OFFLINE_MAP_DIR = "offline_maps"', 'Android native offline maps private storage');
assertIncludes(androidOfflineMapsPlugin, 'getOfflineMapTile', 'Android MBTiles tile bridge');
assertIncludes(androidOfflineMapsPlugin, 'SQLiteDatabase.openDatabase', 'Android MBTiles SQLite reader');
assertIncludes(androidOfflineMapsPlugin, 'renderFormats', 'Android offline map render capabilities');
assertIncludes(androidOfflineMapsPlugin, 'DatabaseRenderer', 'Android Mapsforge tile renderer');
assertIncludes(androidOfflineMapsPlugin, 'MapsforgeThemes.OSMARENDER', 'Android Mapsforge default render theme');
[
  'application/gpx+xml',
  'application/vnd.google-earth.kml+xml',
  'application/vnd.mappingelf.melmap+zip',
  'application/zip',
  'application/xml',
  'text/xml',
  'application/octet-stream',
].forEach((mimeType) => assertIncludes(androidManifest, `android:mimeType="${mimeType}"`, 'Android manifest file-open MIME types'));

assert((iosProject.match(/MARKETING_VERSION = 1\.0\.0;/g) || []).length >= 2, 'iOS MARKETING_VERSION should be 1.0.0 for Debug and Release');
assertIncludes(iosProject, 'CURRENT_PROJECT_VERSION = 1;', 'iOS build number');
[
  'com.mappingelf.gpx',
  'com.mappingelf.kml',
  'com.mappingelf.melmap',
  'public.xml',
  'public.zip-archive',
].forEach((typeId) => assertIncludes(iosInfoPlist, typeId, 'iOS document type declarations'));

console.log(`Native app config OK (${appVersion})`);
