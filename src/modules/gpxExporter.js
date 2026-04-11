/**
 * Mapping Elf — GPX Exporter / Importer
 */

export class GpxExporter {
  /**
   * Generate GPX XML string from route data.
   * @param {Array}  segmentDates - [{date, time, weather:{key:{label,value}}}|null, …] indexed by waypoint
   */
  static generate(waypoints, routeCoords, elevations = [], name = 'Mapping Elf Track', segmentDates = [], waypointNames = []) {
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

    // Waypoints with optional segment date/time extensions
    waypoints.forEach((wp, i) => {
      const seg = segmentDates[i];
      const wptName = waypointNames[i] || `航點 ${i + 1}`;
      gpx += `  <wpt lat="${wp[0].toFixed(6)}" lon="${wp[1].toFixed(6)}">
    <name>${this._escapeXml(wptName)}</name>`;
      if (seg && (seg.date || seg.time || seg.weather)) {
        gpx += `\n    <extensions>`;
        if (seg.date) gpx += `\n      <mel:date>${this._escapeXml(seg.date)}</mel:date>`;
        if (seg.time) gpx += `\n      <mel:time>${this._escapeXml(seg.time)}</mel:time>`;
        if (seg.weather) {
          for (const [key, { value }] of Object.entries(seg.weather)) {
            if (value && value !== '—') {
              gpx += `\n      <mel:${key}>${this._escapeXml(String(value))}</mel:${key}>`;
            }
          }
        }
        gpx += `\n    </extensions>`;
      }
      gpx += `\n  </wpt>\n`;
    });

    // Track
    if (routeCoords.length > 0) {
      gpx += `  <trk>
    <name>${this._escapeXml(name)}</name>
    <trkseg>\n`;

      routeCoords.forEach((coord, i) => {
        const ele = elevations[i] !== undefined ? elevations[i] : 0;
        gpx += `      <trkpt lat="${coord[0].toFixed(6)}" lon="${coord[1].toFixed(6)}">
        <ele>${ele.toFixed(1)}</ele>
        <time>${now}</time>
      </trkpt>\n`;
      });

      gpx += `    </trkseg>
  </trk>\n`;
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
   * Parse GPX file and extract waypoints + track points + segment dates
   */
  static parse(gpxString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxString, 'text/xml');

    const waypoints = [];
    const trackPoints = [];
    const segmentDates = [];

    // Parse waypoints
    const wpts = doc.querySelectorAll('wpt');
    wpts.forEach((wpt) => {
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
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
