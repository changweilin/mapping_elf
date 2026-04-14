/**
 * Mapping Elf — KML Exporter
 * Generates KML compatible with Google Maps / Google Earth.
 *
 * wpData item shape:
 *   { lat, lng, label, isWaypoint, isReturn, date, time,
 *     weather: { key: { label, value } } }
 */
export class KmlExporter {
  /**
   * @param {Array}    wpData      - per-column export data (waypoints + interval points)
   * @param {Array}    routeCoords - [[lat,lng], …] full track
   * @param {number[]} elevations  - elevation at each route coord
   * @param {string}   name
   */
  static generate(wpData, routeCoords, elevations = [], name = 'Mapping Elf Track') {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${this._esc(name)}</name>
    <Style id="routeLine">
      <LineStyle>
        <color>ffff5500</color>
        <width>4</width>
      </LineStyle>
      <PolyStyle><fill>0</fill></PolyStyle>
    </Style>
    <Style id="wpGoing">
      <IconStyle>
        <scale>1.1</scale>
        <Icon><href>https://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>
    <Style id="wpReturn">
      <IconStyle>
        <scale>1.0</scale>
        <Icon><href>https://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>
    <Style id="wpInterval">
      <IconStyle>
        <scale>0.7</scale>
        <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.7</scale></LabelStyle>
    </Style>
`;

    // --- Placemarks for each weather column point ---
    wpData.forEach(pt => {
      const styleId = pt.isWaypoint
        ? (pt.isReturn ? '#wpReturn' : '#wpGoing')
        : '#wpInterval';
      const desc = this._buildDescription(pt);
      kml += `    <Placemark>
      <name>${this._esc(pt.label)}</name>
      <description><![CDATA[${desc}]]></description>
      <styleUrl>${styleId}</styleUrl>
      <Point>
        <coordinates>${pt.lng.toFixed(6)},${pt.lat.toFixed(6)},0</coordinates>
      </Point>
    </Placemark>\n`;
    });

    // --- Route LineString ---
    if (routeCoords.length > 0) {
      const coordStr = routeCoords
        .map((c, i) => `${c[1].toFixed(6)},${c[0].toFixed(6)},${(elevations[i] ?? 0).toFixed(1)}`)
        .join('\n          ');
      kml += `    <Placemark>
      <name>${this._esc(name)}</name>
      <styleUrl>#routeLine</styleUrl>
      <LineString>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>
          ${coordStr}
        </coordinates>
      </LineString>
    </Placemark>\n`;
    }

    kml += `  </Document>\n</kml>`;
    return kml;
  }

  static _buildDescription(pt) {
    const rows = [];
    if (pt.isReturn) rows.push(`<tr><td colspan="2" style="padding:2px 6px;color:#0077cc;font-weight:bold;">🔄 回程</td></tr>`);
    if (pt.date)     rows.push(`<tr><td style="padding:2px 8px;color:#555;">日期</td><td style="padding:2px 8px;">${this._esc(pt.date)}</td></tr>`);
    if (pt.time)     rows.push(`<tr><td style="padding:2px 8px;color:#555;">時間</td><td style="padding:2px 8px;">${this._esc(pt.time)}</td></tr>`);

    const weatherEntries = pt.weather ? Object.entries(pt.weather) : [];
    const hasWeather = weatherEntries.some(([, v]) => v.value && v.value !== '—');
    if (hasWeather) {
      rows.push(`<tr><td colspan="2" style="padding:6px 8px 2px;font-weight:bold;border-top:1px solid #ddd;">天氣資訊</td></tr>`);
      weatherEntries.forEach(([, { label, value }]) => {
        if (value && value !== '—') {
          rows.push(`<tr><td style="padding:2px 8px;color:#555;">${this._esc(label)}</td><td style="padding:2px 8px;">${this._esc(String(value))}</td></tr>`);
        }
      });
    }

    if (pt.windyUrl) {
      rows.push(`<tr><td colspan="2" style="padding:6px 8px 2px;border-top:1px solid #ddd;"><a href="${pt.windyUrl}" style="color:#0077cc;">🌬️ Windy</a></td></tr>`);
    }

    if (rows.length === 0) return '';
    return `<table style="border-collapse:collapse;font-size:13px;min-width:180px;">${rows.join('')}</table>`;
  }

  static download(kmlString, filename = 'mapping_elf_track.kml') {
    const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static _esc(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
