package com.mappingelf.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.mapsforge.core.graphics.GraphicFactory;
import org.mapsforge.core.graphics.TileBitmap;
import org.mapsforge.core.model.Tile;
import org.mapsforge.map.android.graphics.AndroidGraphicFactory;
import org.mapsforge.map.datastore.MapDataStore;
import org.mapsforge.map.layer.cache.InMemoryTileCache;
import org.mapsforge.map.layer.cache.TileCache;
import org.mapsforge.map.layer.renderer.DatabaseRenderer;
import org.mapsforge.map.layer.renderer.RendererJob;
import org.mapsforge.map.model.DisplayModel;
import org.mapsforge.map.reader.MapFile;
import org.mapsforge.map.rendertheme.internal.MapsforgeThemes;
import org.mapsforge.map.rendertheme.rule.RenderThemeFuture;

@CapacitorPlugin(name = "OfflineMaps")
public class OfflineMapsPlugin extends Plugin {
    private static final String OFFLINE_MAP_DIR = "offline_maps";
    private static final int COPY_BUFFER_SIZE = 256 * 1024;
    private static final int TILE_SIZE = 256;
    private static boolean mapsforgeGraphicFactoryReady = false;
    private final Map<String, MapsforgeRendererContext> mapsforgeRenderers = new HashMap<>();

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("platform", "android");
        result.put("formats", new JSArray(Arrays.asList("mapsforge", "mbtiles")));
        result.put("renderFormats", new JSArray(Arrays.asList("mapsforge", "mbtiles")));
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
            closeMapsforgeRenderer(target);
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
            payload.put("rendererStatus", "ready");
            if ("mbtiles".equals(format)) {
                appendMbtilesMetadata(payload, destination);
            } else if ("mapsforge".equals(format)) {
                payload.put("tileMimeType", "image/png");
            }
            call.resolve(payload);
        } catch (IOException | NoSuchAlgorithmException err) {
            call.reject("離線底圖匯入失敗", err);
        }
    }

    @PluginMethod
    public void getOfflineMapTile(PluginCall call) {
        String format = call.getString("format", "");
        if (!"mbtiles".equals(format) && !"mapsforge".equals(format)) {
            JSObject result = new JSObject();
            result.put("found", false);
            result.put("reason", "unsupported-format");
            call.resolve(result);
            return;
        }

        Integer zValue = call.getInt("z");
        Integer xValue = call.getInt("x");
        Integer yValue = call.getInt("y");
        if (zValue == null || xValue == null || yValue == null) {
            call.reject("缺少圖磚座標");
            return;
        }

        try {
            File target = resolveOfflineMapFile(call.getString("storedPath"), call.getString("relativePath"));
            if (target == null || !target.exists()) {
                call.reject("找不到離線底圖檔案");
                return;
            }

            byte[] tile = "mbtiles".equals(format)
                ? readMbtilesTile(target, zValue, xValue, yValue)
                : renderMapsforgeTile(target, zValue, xValue, yValue);
            JSObject result = new JSObject();
            if (tile == null || tile.length == 0) {
                result.put("found", false);
            } else {
                String mimeType = "mapsforge".equals(format)
                    ? "image/png"
                    : detectTileMimeType(tile, call.getString("tileMimeType", ""));
                result.put("found", true);
                result.put("mimeType", mimeType);
                result.put("dataUrl", "data:" + mimeType + ";base64," + Base64.encodeToString(tile, Base64.NO_WRAP));
            }
            call.resolve(result);
        } catch (IOException | SQLiteException err) {
            call.reject("讀取離線圖磚失敗", err);
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

    private void appendMbtilesMetadata(JSObject payload, File destination) {
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(destination.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY)) {
            Map<String, String> metadata = readMbtilesMetadata(db);
            String tileFormat = metadata.get("format");
            if (tileFormat != null && !tileFormat.trim().isEmpty()) {
                String tileMimeType = mimeTypeForMbtilesFormat(tileFormat);
                payload.put("tileMimeType", tileMimeType);
                if ("application/x-protobuf".equals(tileMimeType)) {
                    payload.put("rendererStatus", "unsupported-vector-tiles");
                }
            }
            Integer minZoom = parseInteger(metadata.get("minzoom"));
            Integer maxZoom = parseInteger(metadata.get("maxzoom"));
            if (minZoom == null || maxZoom == null) {
                int[] zoomRange = queryMbtilesZoomRange(db);
                if (minZoom == null && zoomRange[0] >= 0) minZoom = zoomRange[0];
                if (maxZoom == null && zoomRange[1] >= 0) maxZoom = zoomRange[1];
            }
            if (minZoom != null) payload.put("minZoom", minZoom);
            if (maxZoom != null) payload.put("maxZoom", maxZoom);

            JSObject bounds = parseMbtilesBounds(metadata.get("bounds"));
            if (bounds != null) payload.put("bounds", bounds);
            String attribution = metadata.get("attribution");
            if (attribution != null && !attribution.trim().isEmpty()) payload.put("attribution", attribution);
        } catch (Exception ignored) {
            // Imported MBTiles can still be listed even if optional metadata is absent or malformed.
        }
    }

    private Map<String, String> readMbtilesMetadata(SQLiteDatabase db) {
        Map<String, String> metadata = new HashMap<>();
        try (Cursor cursor = db.rawQuery("SELECT name, value FROM metadata", null)) {
            while (cursor.moveToNext()) {
                metadata.put(cursor.getString(0), cursor.getString(1));
            }
        } catch (Exception ignored) {}
        return metadata;
    }

    private int[] queryMbtilesZoomRange(SQLiteDatabase db) {
        int[] zoomRange = new int[] { -1, -1 };
        try (Cursor cursor = db.rawQuery("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles", null)) {
            if (cursor.moveToFirst()) {
                if (!cursor.isNull(0)) zoomRange[0] = cursor.getInt(0);
                if (!cursor.isNull(1)) zoomRange[1] = cursor.getInt(1);
            }
        } catch (Exception ignored) {}
        return zoomRange;
    }

    private Integer parseInteger(String value) {
        if (value == null) return null;
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException err) {
            return null;
        }
    }

    private JSObject parseMbtilesBounds(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        String[] parts = value.split(",");
        if (parts.length != 4) return null;
        try {
            double west = Double.parseDouble(parts[0].trim());
            double south = Double.parseDouble(parts[1].trim());
            double east = Double.parseDouble(parts[2].trim());
            double north = Double.parseDouble(parts[3].trim());
            JSObject bounds = new JSObject();
            bounds.put("north", north);
            bounds.put("south", south);
            bounds.put("east", east);
            bounds.put("west", west);
            return bounds;
        } catch (NumberFormatException err) {
            return null;
        }
    }

    private byte[] readMbtilesTile(File target, int z, int x, int y) {
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(target.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY)) {
            int flippedY = ((1 << z) - 1) - y;
            byte[] tile = queryMbtilesTile(db, z, x, flippedY);
            if (tile != null) return tile;
            return queryMbtilesTile(db, z, x, y);
        }
    }

    private byte[] queryMbtilesTile(SQLiteDatabase db, int z, int x, int y) {
        try (Cursor cursor = db.rawQuery(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1",
            new String[] { String.valueOf(z), String.valueOf(x), String.valueOf(y) }
        )) {
            if (cursor.moveToFirst()) return cursor.getBlob(0);
        }
        return null;
    }

    private byte[] renderMapsforgeTile(File target, int z, int x, int y) throws IOException {
        MapsforgeRendererContext rendererContext = getMapsforgeRenderer(target);
        TileBitmap tileBitmap = null;
        try {
            Tile tile = new Tile(x, y, (byte) z, TILE_SIZE);
            RendererJob job = new RendererJob(
                tile,
                rendererContext.mapDataStore,
                rendererContext.renderThemeFuture,
                rendererContext.displayModel,
                1f,
                false,
                false
            );
            synchronized (rendererContext) {
                tileBitmap = rendererContext.renderer.executeJob(job);
            }
            if (tileBitmap == null) return null;

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            tileBitmap.compress(output);
            return output.toByteArray();
        } catch (RuntimeException err) {
            throw new IOException("Cannot render Mapsforge tile", err);
        } finally {
            if (tileBitmap != null) {
                tileBitmap.decrementRefCount();
            }
        }
    }

    private MapsforgeRendererContext getMapsforgeRenderer(File target) throws IOException {
        ensureMapsforgeGraphicFactory();
        String key = target.getCanonicalPath();
        synchronized (mapsforgeRenderers) {
            MapsforgeRendererContext existing = mapsforgeRenderers.get(key);
            if (existing != null) return existing;

            MapsforgeRendererContext created = new MapsforgeRendererContext(target, AndroidGraphicFactory.INSTANCE);
            mapsforgeRenderers.put(key, created);
            return created;
        }
    }

    private void closeMapsforgeRenderer(File target) throws IOException {
        String key = target.getCanonicalPath();
        MapsforgeRendererContext rendererContext;
        synchronized (mapsforgeRenderers) {
            rendererContext = mapsforgeRenderers.remove(key);
        }
        if (rendererContext != null) {
            rendererContext.close();
        }
    }

    private void ensureMapsforgeGraphicFactory() {
        synchronized (OfflineMapsPlugin.class) {
            if (!mapsforgeGraphicFactoryReady) {
                AndroidGraphicFactory.createInstance(getContext().getApplicationContext());
                mapsforgeGraphicFactoryReady = true;
            }
        }
    }

    private String mimeTypeForMbtilesFormat(String format) {
        String lower = format == null ? "" : format.toLowerCase(Locale.ROOT).trim();
        if (lower.contains("jpg") || lower.contains("jpeg")) return "image/jpeg";
        if (lower.contains("webp")) return "image/webp";
        if (lower.contains("pbf") || lower.contains("mvt")) return "application/x-protobuf";
        return "image/png";
    }

    private String detectTileMimeType(byte[] tile, String fallback) {
        if (tile.length >= 8
            && tile[0] == (byte) 0x89
            && tile[1] == 0x50
            && tile[2] == 0x4e
            && tile[3] == 0x47) {
            return "image/png";
        }
        if (tile.length >= 3 && tile[0] == (byte) 0xff && tile[1] == (byte) 0xd8 && tile[2] == (byte) 0xff) {
            return "image/jpeg";
        }
        if (tile.length >= 12
            && tile[0] == 0x52
            && tile[1] == 0x49
            && tile[2] == 0x46
            && tile[3] == 0x46
            && tile[8] == 0x57
            && tile[9] == 0x45
            && tile[10] == 0x42
            && tile[11] == 0x50) {
            return "image/webp";
        }
        return fallback == null || fallback.trim().isEmpty() ? "image/png" : fallback.trim();
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }

    private static class MapsforgeRendererContext {
        final MapDataStore mapDataStore;
        final DisplayModel displayModel;
        final RenderThemeFuture renderThemeFuture;
        final DatabaseRenderer renderer;
        final TileCache tileCache;

        MapsforgeRendererContext(File target, GraphicFactory graphicFactory) {
            mapDataStore = new MapFile(target);
            displayModel = new DisplayModel();
            tileCache = new InMemoryTileCache(64);
            renderThemeFuture = new RenderThemeFuture(graphicFactory, MapsforgeThemes.OSMARENDER, displayModel);
            new Thread(renderThemeFuture).start();
            renderer = new DatabaseRenderer(
                mapDataStore,
                graphicFactory,
                tileCache,
                null,
                true,
                false,
                null
            );
        }

        void close() {
            renderThemeFuture.decrementRefCount();
            renderer.interruptAndDestroy();
            tileCache.destroy();
            mapDataStore.close();
        }
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
