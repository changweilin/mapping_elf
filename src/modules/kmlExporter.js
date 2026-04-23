/**
 * Mapping Elf — KML Exporter
 * Generates KML compatible with Google Maps / Google Earth.
 *
 * wpData item shape:
 *   { lat, lng, label, isWaypoint, isReturn, date, time,
 *     weather: { key: { label, value } } }
 */
import { orderWaypointsAlongTrack } from './utils.js';

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
      let outLabel = pt.isWaypoint ? pt.label : `*_${pt.label}`;
      if (pt.isReturn && !outLabel.endsWith(' ↩')) {
        outLabel += ' ↩';
      }
      kml += `    <Placemark>
      <name>${this._esc(outLabel)}</name>
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

  /**
   * Parse KML and extract waypoints + track points + segment dates.
   * Skips Placemarks tagged with styleUrl #wpInterval.
   * Returns same shape as GpxExporter.parse().
   */
  static parse(kmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlString, 'text/xml');

    const waypoints = [];
    const trackPoints = [];
    const segmentDates = [];
    const intermediatePoints = [];

    let fileOrderCounter = 0;
    doc.querySelectorAll('Placemark').forEach(pm => {
      const styleUrl = pm.querySelector('styleUrl')?.textContent?.trim() || '';
      const pointEl = pm.querySelector('Point');
      const lineEl  = pm.querySelector('LineString');

      if (pointEl) {
        const coordsText = pointEl.querySelector('coordinates')?.textContent?.trim() || '';
        const [lngStr, latStr] = coordsText.split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || isNaN(lng)) return;

        const description = pm.querySelector('description')?.textContent || '';
        const meta = this._parseDescription(description);

        const rawName = pm.querySelector('name')?.textContent?.trim() || '';
        const hasIntervalStyle = styleUrl === '#wpInterval';
        const hasIntervalPrefix = rawName.startsWith('*_');
        let label = hasIntervalPrefix ? rawName.slice(2) : rawName;
        
        // Strip turnaround symbols to prevent accumulation on re-export
        if (label.startsWith('↩ ')) label = label.substring(2);
        label = label.replace(/\s*[↺↻↩]$|\s*\(回程\)$/, '').trim();

        if (hasIntervalStyle || hasIntervalPrefix) {
          intermediatePoints.push({
            lat, lng, label,
            date: meta.date || null,
            time: meta.time || null,
            weather: meta.weather,
            windyUrl: meta.windyUrl || null,
            fileOrder: fileOrderCounter++,
          });
          return;
        }

        waypoints.push([lat, lng]);
        segmentDates.push({
          label: label || null,
          date: meta.date || null,
          time: meta.time || null,
          weather: meta.weather,
          windyUrl: meta.windyUrl || null,
          fileOrder: fileOrderCounter++,
        });
      } else if (lineEl) {
        // Route LineString → track points
        const coordsText = lineEl.querySelector('coordinates')?.textContent?.trim() || '';
        coordsText.split(/\s+/).forEach(triplet => {
          const parts = triplet.split(',');
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          const ele = parts[2] !== undefined ? parseFloat(parts[2]) : 0;
          if (!isNaN(lat) && !isNaN(lon)) {
            trackPoints.push({ lat, lon, ele: isNaN(ele) ? 0 : ele });
          }
        });
      }
    });

    if (trackPoints.length > 0 && waypoints.length > 0) {
      // orderWaypointsAlongTrack walks mileage forward-only in file order so
      // out-and-back revisits stay distinct. Waypoints whose best forward
      // match is too far get deferred to a second pass and re-inserted by
      // mileage with `inserted: true`; we mark those labels with a `*`.
      const SNAP_M = 100;
      const trackCoords = trackPoints.map(p => [p.lat, p.lon]);
      const orderInfo = orderWaypointsAlongTrack(waypoints, trackCoords);
      let ordered = orderInfo.map(({ index }) => {
        const meta = segmentDates[index];
        return { latlon: waypoints[index], meta };
      });

      // Prepend track start if the first waypoint is far from it
      const trackStart = trackPoints[0];
      if (this._distM(ordered[0].latlon[0], ordered[0].latlon[1], trackStart.lat, trackStart.lon) > SNAP_M) {
        ordered.unshift({ latlon: [trackStart.lat, trackStart.lon], meta: { label: null, date: null, time: null, weather: {}, windyUrl: null } });
      }

      // Append track end if the last waypoint is far from it
      const trackEnd = trackPoints[trackPoints.length - 1];
      if (this._distM(ordered[ordered.length - 1].latlon[0], ordered[ordered.length - 1].latlon[1], trackEnd.lat, trackEnd.lon) > SNAP_M) {
        ordered.push({ latlon: [trackEnd.lat, trackEnd.lon], meta: { label: null, date: null, time: null, weather: {}, windyUrl: null } });
      }

      // De-duplicate waypoints that are almost identical in coordinates (< 1.0m)
      const unique = [];
      for (const p of ordered) {
        if (unique.length > 0) {
          const prev = unique[unique.length - 1];
          if (this._distM(p.latlon[0], p.latlon[1], prev.latlon[0], prev.latlon[1]) < 1.0) {
            continue; // Skip almost identical consecutive point
          }
        }
        unique.push(p);
      }

      // Re-populate original arrays
      waypoints.length = 0;
      segmentDates.length = 0;
      unique.forEach(p => {
        waypoints.push(p.latlon);
        segmentDates.push(p.meta);
      });
    } else if (waypoints.length === 0 && trackPoints.length > 0) {
      // Fallback: if no waypoints but have track, sample some
      const step = Math.max(1, Math.floor(trackPoints.length / 10));
      for (let i = 0; i < trackPoints.length - 1; i += step) {
        waypoints.push([trackPoints[i].lat, trackPoints[i].lon]);
        segmentDates.push({ date: null, time: null, weather: {}, windyUrl: null });
      }
      const last = trackPoints[trackPoints.length - 1];
      waypoints.push([last.lat, last.lon]);
      segmentDates.push({ date: null, time: null, weather: {}, windyUrl: null });
    }

    return { waypoints, trackPoints, segmentDates, intermediatePoints };
  }

  static _distM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  static _parseDescription(html) {
    const res = { weather: {} };
    if (!html) return res;
    // Basic extraction from the HTML table string (avoiding full DOMParser for speed if possible)
    // but DOMParser is safer for arbitrary HTML.
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length === 2) {
        const key = tds[0].textContent.trim();
        const val = tds[1].textContent.trim();
        if (key === '日期') res.date = val;
        else if (key === '時間') res.time = val;
        else res.weather[key] = val; // Store by label; main.js will map back to keys
      } else if (tds.length === 1) {
        const a = tds[0].querySelector('a');
        if (a && a.textContent.includes('Windy')) res.windyUrl = a.href;
      }
    });
    return res;
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
