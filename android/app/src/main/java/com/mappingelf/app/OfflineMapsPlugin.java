package com.mappingelf.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;

@CapacitorPlugin(name = "OfflineMaps")
public class OfflineMapsPlugin extends Plugin {
    private static final String OFFLINE_MAP_DIR = "offline_maps";
    private static final int COPY_BUFFER_SIZE = 256 * 1024;

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("platform", "android");
        result.put("formats", new JSArray(Arrays.asList("mapsforge", "mbtiles")));
        result.put("storage", "app-private-file");
        call.resolve(result);
    }

    @PluginMethod
    public void importOfflineMapSource(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/octet-stream",
            "application/x-sqlite3",
            "application/vnd.sqlite3"
        });
        startActivityForResult(call, intent, "handleOfflineMapPicked");
    }

    @PluginMethod
    public void deleteOfflineMapSource(PluginCall call) {
        try {
            File target = resolveOfflineMapFile(call.getString("storedPath"), call.getString("relativePath"));
            if (target == null) {
                call.reject("找不到離線底圖檔案");
                return;
            }

            boolean existed = target.exists();
            boolean deleted = !existed || target.delete();
            if (!deleted) {
                call.reject("刪除離線底圖檔案失敗");
                return;
            }

            JSObject result = new JSObject();
            result.put("deleted", existed);
            result.put("supported", true);
            call.resolve(result);
        } catch (IOException err) {
            call.reject("離線底圖檔案路徑無效", err);
        }
    }

    @ActivityCallback
    private void handleOfflineMapPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri sourceUri = result.getData().getData();
        ContentResolver resolver = getContext().getContentResolver();
        String displayName = queryDisplayName(resolver, sourceUri);
        String mimeType = resolver.getType(sourceUri);
        String extension = extensionFromName(displayName);
        String format = formatFor(extension, mimeType);
        if (format == null) {
            call.reject("僅支援 Mapsforge .map 與 MBTiles 檔案");
            return;
        }

        try {
            File destination = uniqueDestinationFile(safeFilename(displayName, format));
            CopyResult copy = copyUriToFile(resolver, sourceUri, destination);
            JSObject payload = new JSObject();
            payload.put("cancelled", false);
            payload.put("name", displayName);
            payload.put("filename", destination.getName());
            payload.put("format", format);
            payload.put("mimeType", mimeType == null ? "" : mimeType);
            payload.put("sizeBytes", copy.sizeBytes);
            payload.put("checksumSha256", copy.sha256);
            payload.put("storedPath", destination.getAbsolutePath());
            payload.put("relativePath", OFFLINE_MAP_DIR + "/" + destination.getName());
            payload.put("uri", Uri.fromFile(destination).toString());
            payload.put("originalUri", sourceUri.toString());
            payload.put("platform", "android");
            call.resolve(payload);
        } catch (IOException | NoSuchAlgorithmException err) {
            call.reject("離線底圖匯入失敗", err);
        }
    }

    private File getOfflineMapDir() throws IOException {
        File dir = new File(getContext().getFilesDir(), OFFLINE_MAP_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create offline map directory");
        }
        return dir.getCanonicalFile();
    }

    private File resolveOfflineMapFile(String storedPath, String relativePath) throws IOException {
        File dir = getOfflineMapDir();
        File target = null;
        if (storedPath != null && !storedPath.trim().isEmpty()) {
            target = new File(storedPath);
        } else if (relativePath != null && !relativePath.trim().isEmpty()) {
            target = new File(getContext().getFilesDir(), relativePath);
        }
        if (target == null) return null;

        File canonicalTarget = target.getCanonicalFile();
        String dirPath = dir.getCanonicalPath();
        String targetPath = canonicalTarget.getCanonicalPath();
        if (!targetPath.equals(dirPath) && !targetPath.startsWith(dirPath + File.separator)) {
            throw new IOException("Target is outside offline map directory");
        }
        return canonicalTarget;
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception ignored) {}

        String fallback = uri.getLastPathSegment();
        return fallback == null || fallback.trim().isEmpty() ? "offline-map" : fallback.trim();
    }

    private String extensionFromName(String name) {
        String lower = name == null ? "" : name.toLowerCase();
        int dot = lower.lastIndexOf('.');
        return dot >= 0 && dot < lower.length() - 1 ? lower.substring(dot + 1) : "";
    }

    private String formatFor(String extension, String mimeType) {
        if ("map".equals(extension)) return "mapsforge";
        if ("mbtiles".equals(extension)) return "mbtiles";
        String type = mimeType == null ? "" : mimeType.toLowerCase();
        if (type.contains("sqlite")) return "mbtiles";
        return null;
    }

    private String safeFilename(String displayName, String format) {
        String fallback = "offline-map." + ("mbtiles".equals(format) ? "mbtiles" : "map");
        String name = displayName == null || displayName.trim().isEmpty() ? fallback : displayName.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "_").replaceAll("\\s+", " ").trim();
        if (name.isEmpty()) name = fallback;
        if (!name.contains(".")) {
            name += "mbtiles".equals(format) ? ".mbtiles" : ".map";
        }
        return name;
    }

    private File uniqueDestinationFile(String filename) throws IOException {
        File dir = getOfflineMapDir();
        File candidate = new File(dir, filename);
        if (!candidate.exists()) return candidate;

        String base = filename;
        String ext = "";
        int dot = filename.lastIndexOf('.');
        if (dot > 0) {
            base = filename.substring(0, dot);
            ext = filename.substring(dot);
        }

        int counter = 2;
        while (candidate.exists()) {
            candidate = new File(dir, base + "-" + counter + ext);
            counter++;
        }
        return candidate;
    }

    private CopyResult copyUriToFile(ContentResolver resolver, Uri sourceUri, File destination)
        throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        InputStream rawInput = resolver.openInputStream(sourceUri);
        if (rawInput == null) throw new IOException("Cannot open selected file");
        try (
            DigestInputStream input = new DigestInputStream(rawInput, digest);
            FileOutputStream output = new FileOutputStream(destination)
        ) {
            byte[] buffer = new byte[COPY_BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                total += read;
            }
        } catch (IOException err) {
            if (destination.exists()) destination.delete();
            throw err;
        }

        if (total <= 0 && destination.exists()) {
            total = destination.length();
        }
        return new CopyResult(total, bytesToHex(digest.digest()));
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }

    private static class CopyResult {
        final long sizeBytes;
        final String sha256;

        CopyResult(long sizeBytes, String sha256) {
            this.sizeBytes = sizeBytes;
            this.sha256 = sha256;
        }
    }
}
