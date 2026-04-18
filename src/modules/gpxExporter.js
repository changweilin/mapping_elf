/**
 * Mapping Elf — GPX Exporter / Importer
 *
 * wpData item shape (same as KML):
 *   { lat, lng, label, isWaypoint, isReturn, date, time,
 *     weather: { key: { label, value } } }
 */

export class GpxExporter {
  /**
   * Generate GPX XML from all weather-column points.
   * Actual route waypoints get <wpt> elements as before.
   * Interval/intermediate points also get <wpt> but tagged with
   * <type>mel:interval</type> so the importer can skip them.
   *
   * @param {Array}    wpData      - all weather column points
   * @param {Array}    routeCoords - [[lat,lng], …] full track
   * @param {number[]} elevations  - elevation at each route coord
   * @param {string}   name
   */
  static generate(wpData, routeCoords, elevations = [], name = 'Mapping Elf Track') {
    const now = new Date().toISOString();
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mapping Elf"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:mel="https://mapping-elf.app/gpx/1/0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${this._escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
`;

    wpData.forEach((pt) => {
      gpx += `  <wpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">\n`;
      // Prefix intermediate labels with the `*_` marker so they survive
      // round-trips even when the <type> extension is stripped by other tools.
      const outLabel = pt.isWaypoint ? pt.label : `*_${pt.label}`;
      gpx += `    <name>${this._escapeXml(outLabel)}</name>\n`;

      // Mark non-waypoint columns so the importer can identify them
      if (!pt.isWaypoint) {
        gpx += `    <type>mel:interval</type>\n`;
      }

      const hasExt = pt.date || pt.time || pt.windyUrl ||
        (pt.weather && Object.values(pt.weather).some(v => v.value && v.value !== '—'));
      if (hasExt) {
        gpx += `    <extensions>\n`;
        if (pt.date) gpx += `      <mel:date>${this._escapeXml(pt.date)}</mel:date>\n`;
        if (pt.time) gpx += `      <mel:time>${this._escapeXml(pt.time)}</mel:time>\n`;
        if (pt.weather) {
          for (const [key, { value }] of Object.entries(pt.weather)) {
            if (value && value !== '—') {
              gpx += `      <mel:${key}>${this._escapeXml(String(value))}</mel:${key}>\n`;
            }
          }
        }
        if (pt.windyUrl) {
          gpx += `      <mel:windyUrl>${this._escapeXml(pt.windyUrl)}</mel:windyUrl>\n`;
        }
        gpx += `    </extensions>\n`;
      }

      gpx += `  </wpt>\n`;
    });

    // Track — annotate each trkpt with the nearest weather-point data
    if (routeCoords.length > 0) {
      // Build cumulative distance index for wpData points (metres along route)
      const wpWithCum = wpData.filter(p => typeof p.cum === 'number');

      // Compute cumulative distances for routeCoords
      const trkCum = this._cumulativeDistances(routeCoords);

      gpx += `  <trk>\n    <name>${this._escapeXml(name)}</name>\n    <trkseg>\n`;
      routeCoords.forEach((coord, i) => {
        const ele = elevations[i] !== undefined ? elevations[i] : 0;
        gpx += `      <trkpt lat="${coord[0].toFixed(6)}" lon="${coord[1].toFixed(6)}">\n`;
        gpx += `        <ele>${ele.toFixed(1)}</ele>\n`;
        gpx += `        <time>${now}</time>\n`;

        // Attach nearest weather-point data
        if (wpWithCum.length > 0) {
          const nearest = this._nearestByDist(wpWithCum, trkCum[i]);
          const hasW = nearest && (nearest.date || nearest.windyUrl ||
            (nearest.weather && Object.values(nearest.weather).some(v => v.value && v.value !== '—')));
          if (hasW) {
            gpx += `        <extensions>\n`;
            if (nearest.label) gpx += `          <mel:weatherRef>${this._escapeXml(nearest.label)}</mel:weatherRef>\n`;
            if (nearest.date)  gpx += `          <mel:date>${this._escapeXml(nearest.date)}</mel:date>\n`;
            if (nearest.time)  gpx += `          <mel:time>${this._escapeXml(nearest.time)}</mel:time>\n`;
            if (nearest.weather) {
              for (const [key, { value }] of Object.entries(nearest.weather)) {
                if (value && value !== '—') {
                  gpx += `          <mel:${key}>${this._escapeXml(String(value))}</mel:${key}>\n`;
                }
              }
            }
            if (nearest.windyUrl) {
              gpx += `          <mel:windyUrl>${this._escapeXml(nearest.windyUrl)}</mel:windyUrl>\n`;
            }
            gpx += `        </extensions>\n`;
          }
        }

        gpx += `      </trkpt>\n`;
      });
      gpx += `    </trkseg>\n  </trk>\n`;
    }

    gpx += `</gpx>`;
    return gpx;
  }

  /**
   * Compute cumulative distances (metres) along an array of [lat,lng] coords.
   */
  static _cumulativeDistances(coords) {
    const R = 6371000;
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      const [lat1, lng1] = coords[i - 1];
      const [lat2, lng2] = coords[i];
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      cum.push(cum[i - 1] + 2 * R * Math.asin(Math.sqrt(a)));
    }
    return cum;
  }

  /**
   * Find the wpData point whose cum distance is closest to d.
   */
  static _nearestByDist(wpWithCum, d) {
    let best = wpWithCum[0];
    let bestDiff = Math.abs((best.cum || 0) - d);
    for (let i = 1; i < wpWithCum.length; i++) {
      const diff = Math.abs((wpWithCum[i].cum || 0) - d);
      if (diff < bestDiff) { bestDiff = diff; best = wpWithCum[i]; }
    }
    return best;
  }

  /**
   * Download GPX file
   */
  static download(gpxString, filename = 'mapping_elf_track.gpx') {
    const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Parse GPX file and extract waypoints + track points + segment dates.
   * Skips <wpt> elements tagged with <type>mel:interval</type>.
   *
   * When a track is present, waypoints are projected onto the nearest track
   * point and sorted in track order. The track start and end are prepended /
   * appended when no existing waypoint lies within 100 m of them.
   */
  static parse(gpxString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxString, 'text/xml');

    const waypoints = [];
    const trackPoints = [];
    const segmentDates = [];
    const intermediatePoints = [];

    // Parse track points first so we can project waypoints onto the track
    const trkpts = doc.querySelectorAll('trkpt');
    trkpts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      const eleEl = pt.querySelector('ele');
      const eleText = eleEl ? eleEl.textContent.trim() : '';
      const ele = eleText && !isNaN(parseFloat(eleText)) ? parseFloat(eleText) : null;
      if (!isNaN(lat) && !isNaN(lon)) {
        trackPoints.push({ lat, lon, ele });
      }
    });

    // Parse waypoints — split intermediate (mel:interval or `*_` prefix) out
    const rawWpts = [];
    const wpts = doc.querySelectorAll('wpt');
    wpts.forEach((wpt) => {
      const lat = parseFloat(wpt.getAttribute('lat'));
      const lon = parseFloat(wpt.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) return;
      const nameEl = wpt.querySelector('name');
      const rawName = nameEl ? nameEl.textContent.trim() : '';
      const typeEl = wpt.querySelector('type');
      const hasIntervalTag = typeEl && typeEl.textContent.trim() === 'mel:interval';
      const hasIntervalPrefix = rawName.startsWith('*_');
      if (hasIntervalTag || hasIntervalPrefix) {
        const label = hasIntervalPrefix ? rawName.slice(2) : rawName;
        intermediatePoints.push({ lat, lng: lon, label });
        return;
      }

      rawWpts.push({
        latlon: [lat, lon],
        meta: {
          label: rawName || null,
          date: this._getExtValue(wpt, 'date'),
          time: this._getExtValue(wpt, 'time'),
        },
      });
    });

    if (trackPoints.length > 0 && rawWpts.length > 0) {
      // Project each waypoint onto the track and sort by ascending track index
      const SNAP_M = 100;
      const projected = rawWpts.map(wp => ({
        ...wp,
        trackIdx: this._nearestTrackIndex(wp.latlon[0], wp.latlon[1], trackPoints),
      }));
      projected.sort((a, b) => a.trackIdx - b.trackIdx);

      // Prepend track start if the first waypoint is far from it
      const trackStart = trackPoints[0];
      if (this._distM(projected[0].latlon[0], projected[0].latlon[1], trackStart.lat, trackStart.lon) > SNAP_M) {
        projected.unshift({ latlon: [trackStart.lat, trackStart.lon], meta: { label: null, date: null, time: null }, trackIdx: 0 });
      }

      // Append track end if the last waypoint is far from it
      const trackEnd = trackPoints[trackPoints.length - 1];
      if (this._distM(projected[projected.length - 1].latlon[0], projected[projected.length - 1].latlon[1], trackEnd.lat, trackEnd.lon) > SNAP_M) {
        projected.push({ latlon: [trackEnd.lat, trackEnd.lon], meta: { label: null, date: null, time: null }, trackIdx: trackPoints.length - 1 });
      }

      projected.forEach(wp => {
        waypoints.push(wp.latlon);
        segmentDates.push(wp.meta);
      });
    } else if (rawWpts.length > 0) {
      // No track — use waypoints as-is
      rawWpts.forEach(wp => {
        waypoints.push(wp.latlon);
        segmentDates.push(wp.meta);
      });
    } else if (trackPoints.length > 0) {
      // No waypoints — sample evenly from track
      const step = Math.max(1, Math.floor(trackPoints.length / 10));
      for (let i = 0; i < trackPoints.length; i += step) {
        waypoints.push([trackPoints[i].lat, trackPoints[i].lon]);
        segmentDates.push({ date: null, time: null });
      }
      const last = trackPoints[trackPoints.length - 1];
      waypoints.push([last.lat, last.lon]);
      segmentDates.push({ date: null, time: null });
    }

    return { waypoints, trackPoints, segmentDates, intermediatePoints };
  }

  /** Index of the track point closest to (lat, lon). */
  static _nearestTrackIndex(lat, lon, trackPoints) {
    let minDist = Infinity;
    let minIdx = 0;
    for (let i = 0; i < trackPoints.length; i++) {
      const d = this._distM(lat, lon, trackPoints[i].lat, trackPoints[i].lon);
      if (d < minDist) { minDist = d; minIdx = i; }
    }
    return minIdx;
  }

  /** Haversine distance in metres between two lat/lon pairs. */
  static _distM(lat1, lon1, lat2, lon2) {
    const R = 6_371_000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Get value of a custom extension element by local name (namespace-agnostic)
   */
  static _getExtValue(el, localName) {
    const exts = el.querySelector('extensions');
    if (!exts) return null;
    for (const child of exts.children) {
      if (child.localName === localName) {
        const val = child.textContent.trim();
        return val || null;
      }
    }
    return null;
  }

  static _escapeXml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
