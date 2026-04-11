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
      gpx += `    <name>${this._escapeXml(pt.label)}</name>\n`;

      // Mark non-waypoint columns so the importer can skip them
      if (!pt.isWaypoint) {
        gpx += `    <type>mel:interval</type>\n`;
      }

      const hasExt = pt.date || pt.time ||
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
        gpx += `    </extensions>\n`;
      }

      gpx += `  </wpt>\n`;
    });

    // Track
    if (routeCoords.length > 0) {
      gpx += `  <trk>\n    <name>${this._escapeXml(name)}</name>\n    <trkseg>\n`;
      routeCoords.forEach((coord, i) => {
        const ele = elevations[i] !== undefined ? elevations[i] : 0;
        gpx += `      <trkpt lat="${coord[0].toFixed(6)}" lon="${coord[1].toFixed(6)}">\n`;
        gpx += `        <ele>${ele.toFixed(1)}</ele>\n`;
        gpx += `        <time>${now}</time>\n`;
        gpx += `      </trkpt>\n`;
      });
      gpx += `    </trkseg>\n  </trk>\n`;
    }

    gpx += `</gpx>`;
    return gpx;
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
   */
  static parse(gpxString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxString, 'text/xml');

    const waypoints = [];
    const trackPoints = [];
    const segmentDates = [];

    // Parse waypoints — skip interval annotations
    const wpts = doc.querySelectorAll('wpt');
    wpts.forEach((wpt) => {
      const typeEl = wpt.querySelector('type');
      if (typeEl && typeEl.textContent.trim() === 'mel:interval') return;

      const lat = parseFloat(wpt.getAttribute('lat'));
      const lon = parseFloat(wpt.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        waypoints.push([lat, lon]);
        segmentDates.push({
          date: this._getExtValue(wpt, 'date'),
          time: this._getExtValue(wpt, 'time'),
        });
      }
    });

    // Parse track points
    const trkpts = doc.querySelectorAll('trkpt');
    trkpts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      const eleEl = pt.querySelector('ele');
      const ele = eleEl ? parseFloat(eleEl.textContent) : 0;
      if (!isNaN(lat) && !isNaN(lon)) {
        trackPoints.push({ lat, lon, ele });
      }
    });

    // If no waypoints but have track, sample some as waypoints
    if (waypoints.length === 0 && trackPoints.length > 0) {
      const step = Math.max(1, Math.floor(trackPoints.length / 10));
      for (let i = 0; i < trackPoints.length; i += step) {
        waypoints.push([trackPoints[i].lat, trackPoints[i].lon]);
        segmentDates.push({ date: null, time: null });
      }
      const last = trackPoints[trackPoints.length - 1];
      waypoints.push([last.lat, last.lon]);
      segmentDates.push({ date: null, time: null });
    }

    return { waypoints, trackPoints, segmentDates };
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
