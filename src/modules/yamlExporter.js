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
      yaml += `  - label: ${this._yamlStr(pt.label)}\n`;
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

    // Split into point blocks by the "  - label:" sentinel
    const lines = yamlString.split('\n');
    let inPoints = false;
    let current = null;

    const commitPoint = () => {
      if (!current) return;
      const lat = parseFloat(current.lat);
      const lng = parseFloat(current.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      // Only import waypoints as map waypoints; intervals are skipped
      if (current.type !== 'interval') {
        waypoints.push([lat, lng]);
        segmentDates.push({ date: current.date || null, time: current.time || null });
      }
    };

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (/^points:/.test(line)) { inPoints = true; continue; }
      if (!inPoints) continue;

      // New point entry
      if (/^  - label:/.test(line)) {
        commitPoint();
        current = { label: this._parseScalar(line.replace(/^  - label:\s*/, '')) };
        continue;
      }

      if (!current) continue;

      // Top-level point fields (4-space indent or "    key: val")
      const fieldMatch = line.match(/^    (\w+):\s*(.*)/);
      if (fieldMatch) {
        const [, key, val] = fieldMatch;
        if (key !== 'weather') current[key] = this._parseScalar(val.replace(/\s*#.*$/, '').trim());
        continue;
      }
    }
    commitPoint();

    return { waypoints, trackPoints: [], segmentDates };
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
