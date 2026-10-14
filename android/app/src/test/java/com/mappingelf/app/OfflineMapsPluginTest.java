package com.mappingelf.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class OfflineMapsPluginTest {

    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void testExtensionFromName() {
        assertEquals("map", OfflineMapsPlugin.extensionFromName("taiwan.map"));
        assertEquals("mbtiles", OfflineMapsPlugin.extensionFromName("route.mbtiles"));
        assertEquals("mbtiles", OfflineMapsPlugin.extensionFromName("Archive.Backup.MBTILES"));
        assertEquals("", OfflineMapsPlugin.extensionFromName("no_extension"));
        assertEquals("", OfflineMapsPlugin.extensionFromName("trailing."));
        assertEquals("", OfflineMapsPlugin.extensionFromName(null));
        assertEquals("", OfflineMapsPlugin.extensionFromName(""));
    }

    @Test
    public void testFormatFor() {
        assertEquals("mapsforge", OfflineMapsPlugin.formatFor("map", null));
        assertEquals("mbtiles", OfflineMapsPlugin.formatFor("mbtiles", null));
        assertEquals("mbtiles", OfflineMapsPlugin.formatFor("bin", "application/x-sqlite3"));
        assertEquals("mbtiles", OfflineMapsPlugin.formatFor("", "application/vnd.sqlite3"));
        assertNull(OfflineMapsPlugin.formatFor("gpx", "application/gpx+xml"));
        assertNull(OfflineMapsPlugin.formatFor(null, null));
    }

    @Test
    public void testSafeFilename() {
        assertEquals("taiwan.map", OfflineMapsPlugin.safeFilename("taiwan.map", "mapsforge"));
        assertEquals("simple.map", OfflineMapsPlugin.safeFilename("simple", "mapsforge"));
        assertEquals("simple.mbtiles", OfflineMapsPlugin.safeFilename("simple", "mbtiles"));
        assertEquals("offline-map.map", OfflineMapsPlugin.safeFilename(null, "mapsforge"));
        assertEquals("offline-map.mbtiles", OfflineMapsPlugin.safeFilename("   ", "mbtiles"));

        String sanitized = OfflineMapsPlugin.safeFilename("map:<>*?file.map", "mapsforge");
        assertEquals("map_file.map", sanitized);
    }

    @Test
    public void testParseInteger() {
        assertEquals(Integer.valueOf(14), OfflineMapsPlugin.parseInteger("14"));
        assertEquals(Integer.valueOf(0), OfflineMapsPlugin.parseInteger("  0  "));
        assertNull(OfflineMapsPlugin.parseInteger("not-a-number"));
        assertNull(OfflineMapsPlugin.parseInteger(null));
        assertNull(OfflineMapsPlugin.parseInteger(""));
    }

    @Test
    public void testMimeTypeForMbtilesFormat() {
        assertEquals("image/jpeg", OfflineMapsPlugin.mimeTypeForMbtilesFormat("jpg"));
        assertEquals("image/jpeg", OfflineMapsPlugin.mimeTypeForMbtilesFormat("JPEG"));
        assertEquals("image/webp", OfflineMapsPlugin.mimeTypeForMbtilesFormat("webp"));
        assertEquals("application/x-protobuf", OfflineMapsPlugin.mimeTypeForMbtilesFormat("pbf"));
        assertEquals("application/x-protobuf", OfflineMapsPlugin.mimeTypeForMbtilesFormat("mvt"));
        assertEquals("image/png", OfflineMapsPlugin.mimeTypeForMbtilesFormat("png"));
        assertEquals("image/png", OfflineMapsPlugin.mimeTypeForMbtilesFormat("unknown"));
        assertEquals("image/png", OfflineMapsPlugin.mimeTypeForMbtilesFormat(null));
    }

    @Test
    public void testDetectTileMimeType() {
        byte[] pngHeader = new byte[] { (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };
        assertEquals("image/png", OfflineMapsPlugin.detectTileMimeType(pngHeader, "default"));

        byte[] jpegHeader = new byte[] { (byte) 0xff, (byte) 0xd8, (byte) 0xff, 0x00 };
        assertEquals("image/jpeg", OfflineMapsPlugin.detectTileMimeType(jpegHeader, "default"));

        byte[] webpHeader = new byte[] {
            0x52, 0x49, 0x46, 0x46,
            0x00, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50
        };
        assertEquals("image/webp", OfflineMapsPlugin.detectTileMimeType(webpHeader, "default"));

        byte[] unknown = new byte[] { 0x01, 0x02, 0x03, 0x04 };
        assertEquals("fallback/type", OfflineMapsPlugin.detectTileMimeType(unknown, "fallback/type"));
        assertEquals("image/png", OfflineMapsPlugin.detectTileMimeType(null, null));
    }

    @Test
    public void testBytesToHex() {
        assertEquals("000fff", OfflineMapsPlugin.bytesToHex(new byte[] { 0x00, 0x0f, (byte) 0xff }));
        assertEquals("", OfflineMapsPlugin.bytesToHex(new byte[0]));
        assertEquals("", OfflineMapsPlugin.bytesToHex(null));
    }

    @Test
    public void testValidateOfflineMapPathAllowed() throws IOException {
        File baseDir = temporaryFolder.newFolder("offline_maps");
        File childFile = new File(baseDir, "taiwan.map");
        childFile.createNewFile();

        File resolved = OfflineMapsPlugin.validateOfflineMapPath(baseDir, childFile);
        assertNotNull(resolved);
        assertEquals(childFile.getCanonicalPath(), resolved.getCanonicalPath());
    }

    @Test
    public void testValidateOfflineMapPathTraversalRejection() throws IOException {
        File baseDir = temporaryFolder.newFolder("offline_maps");
        File outsideFile = temporaryFolder.newFile("secret.txt");
        File traversalTarget = new File(baseDir, "../" + outsideFile.getName());

        try {
            OfflineMapsPlugin.validateOfflineMapPath(baseDir, traversalTarget);
            fail("Expected IOException for directory traversal attempt");
        } catch (IOException ex) {
            assertEquals("Target is outside offline map directory", ex.getMessage());
        }
    }
}
