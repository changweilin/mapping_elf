/**
 * Mapping Elf — YAML Exporter
 *
 * wpData item shape:
 *   { lat, lng, label, isWaypoint, isReturn, date, time, windyUrl,
 *     weather: { key: { label, value } } }
 */

export class YamlExporter {
  /**
   * Generate YAML from all weather-column points (waypoints + intervals).
   *
   * @param {Array}  wpData - all weather column points (from collectExportData)
   * @param {string} name   - route name
   */
  static generate(wpData, name = 'Mapping Elf Track') {
    const now = new Date().toISOString();
    let yaml = '';

    yaml += `name: ${this._yamlStr(name)}\n`;
    yaml += `exported: ${now}\n`;
    yaml += `points:\n`;

    wpData.forEach((pt) => {
      let outLabel = pt.isWaypoint ? pt.label : `*_${pt.label}`;
      if (pt.isReturn && !outLabel.endsWith(' ↩')) {
        outLabel += ' ↩';
      }
      yaml += `  - label: ${this._yamlStr(outLabel)}\n`;
      yaml += `    type: ${pt.isWaypoint ? 'waypoint' : 'interval'}\n`;
      if (pt.isReturn) yaml += `    return: true\n`;
      yaml += `    lat: ${pt.lat.toFixed(6)}\n`;
      yaml += `    lng: ${pt.lng.toFixed(6)}\n`;
      if (pt.date) yaml += `    date: ${this._yamlStr(pt.date)}\n`;
      if (pt.time) yaml += `    time: "${pt.time}"\n`;

      const weatherEntries = pt.weather ? Object.entries(pt.weather).filter(([, v]) => v.value && v.value !== '—') : [];
      if (weatherEntries.length > 0) {
        yaml += `    weather:\n`;
        for (const [key, { label, value }] of weatherEntries) {
          yaml += `      ${key}: ${this._yamlStr(String(value))}  # ${label}\n`;
        }
      }

      if (pt.windyUrl) {
        yaml += `    windy: ${pt.windyUrl}\n`;
      }
    });

    return yaml;
  }

  /**
   * Download YAML file
   */
  static download(yamlString, filename = 'mapping_elf_track.yaml') {
    const blob = new Blob([yamlString], { type: 'text/yaml;charset=utf-8' });
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
   * Parse a Mapping Elf YAML file.
   * Returns same shape as GpxExporter.parse(): { waypoints, trackPoints, segmentDates }
   * trackPoints is always empty — YAML only carries waypoint-level data.
   */
  static parse(yamlString) {
    const waypoints = [];
    const segmentDates = [];
    const intermediatePoints = [];

    // Split into point blocks by the "  - label:" sentinel
    const lines = yamlString.split('\n');
    let inPoints = false;
    let inWeather = false;
    let current = null;

    const commitPoint = () => {
      if (!current) return;
      const lat = parseFloat(current.lat);
      const lng = parseFloat(current.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      const rawLabel = current.label || '';
      const hasIntervalPrefix = rawLabel.startsWith('*_');
      const isInterval = current.type === 'interval' || hasIntervalPrefix;
      let label = hasIntervalPrefix ? rawLabel.slice(2) : rawLabel;

      // Strip turnaround symbols to prevent accumulation on re-export
      if (label.startsWith('↩ ')) label = label.substring(2);
      label = label.replace(/\s*[↺↻↩]$|\s*\(回程\)$/, '').trim();

      const pointData = {
        lat, lng,
        label,
        date: current.date || null,
        time: current.time || null,
        weather: current.weather || {},
        windyUrl: current.windy || null,
      };

      if (isInterval) {
        intermediatePoints.push(pointData);
        return;
      }
      waypoints.push([lat, lng]);
      segmentDates.push(pointData);
    };

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (/^points:/.test(line)) { inPoints = true; continue; }
      if (!inPoints) continue;

      // New point entry
      if (/^  - label:/.test(line)) {
        commitPoint();
        inWeather = false;
        current = { label: this._parseScalar(line.replace(/^  - label:\s*/, '')) };
        continue;
      }

      if (!current) continue;

      // Weather block start
      if (/^    weather:/.test(line)) {
        current.weather = {};
        inWeather = true;
        continue;
      }

      // Weather entries (6-space indent)
      if (inWeather && /^      (\w+):\s*(.*)/.test(line)) {
        const [, wKey, wVal] = line.match(/^      (\w+):\s*(.*)/);
        current.weather[wKey] = this._parseScalar(wVal.replace(/\s*#.*$/, '').trim());
        continue;
      }

      // Top-level point fields (4-space indent)
      const fieldMatch = line.match(/^    (\w+):\s*(.*)/);
      if (fieldMatch) {
        inWeather = false;
        const [, key, val] = fieldMatch;
        current[key] = this._parseScalar(val.replace(/\s*#.*$/, '').trim());
        continue;
      }
    }
    commitPoint();
    
    // De-duplicate waypoints that are almost identical in coordinates (< 1.0m)
    const uniqueWaypoints = [];
    const uniqueSegmentDates = [];
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (uniqueWaypoints.length > 0) {
            const prev = uniqueWaypoints[uniqueWaypoints.length - 1];
            if (this._distM(wp[0], wp[1], prev[0], prev[1]) < 1.0) {
                continue; // Skip almost identical consecutive point
            }
        }
        uniqueWaypoints.push(wp);
        uniqueSegmentDates.push(segmentDates[i]);
    }

    return { waypoints: uniqueWaypoints, trackPoints: [], segmentDates: uniqueSegmentDates, intermediatePoints };
  }

  static _distM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Strip surrounding quotes from a YAML scalar value */
  static _parseScalar(val) {
    if (!val) return '';
    val = val.trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return val;
  }

  /**
   * Escape a value for YAML — quote if it contains special chars.
   */
  static _yamlStr(val) {
    if (!val) return '""';
    // Quote if it starts with special YAML chars or contains colon-space
    if (/^[\s\-\[\]{}"'|>&*!%@`#,]/.test(val) || val.includes(': ') || val.includes('\n')) {
      return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return val;
  }
}
