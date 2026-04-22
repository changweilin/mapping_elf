/**
 * Mapping Elf — Elevation Profile
 * Queries Open-Meteo Elevation API and renders Chart.js profile
 */
import { Chart, registerables } from 'chart.js';
import { samplePoints, cumulativeDistances, formatDistance, formatElevation, interpolateRouteColor, interpolateRouteColorRgb, interpolateReturnColor, interpolateReturnColorRgb } from './utils.js';

Chart.register(...registerables);

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';

export class ElevationProfile {
  constructor(canvasId, emptyStateId, onHover, onMarkerClick) {
    this.canvas = document.getElementById(canvasId);
    this.emptyState = document.getElementById(emptyStateId);
    this.onHover = onHover;
    this.onMarkerClick = onMarkerClick || null;
    this.chart = null;
    this.elevations = [];
    this.distances = [];
    this.points = [];
    this._markers = []; // [{cumDistM, label, colIdx, isWaypoint}]
    this.isRoundTrip = false;
    this.turnaroundFrac = null; // 0-1 fraction where outbound ends; null = no split
    this.isCollapsed = false;
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    this._renderChart();
  }

  /** Programmatically show the chart tooltip/crosshair at a sampled point index */
  showCrosshairAtIndex(idx) {
    if (!this.chart || idx < 0 || idx >= this.elevations.length) return;
    const meta = this.chart.getDatasetMeta(0);
    const pt = meta.data[idx];
    if (!pt) return;
    this.chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: pt.x, y: pt.y });
    this.chart.update('active');
  }

  /** Hide the programmatic crosshair */
  hideCrosshair() {
    if (!this.chart) return;
    this.chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    this.chart.update('none');
  }

  /** Set waypoint/intermediate markers to draw on the chart */
  setWaypointMarkers(markers) {
    this._markers = markers || [];
    if (this.chart) this.chart.update('none');
  }

  /** Interpolate elevation at a given cumulative distance (metres) */
  _interpolateElevAtCumM(cumM) {
    const D = this.distances;
    const E = this.elevations;
    if (!D.length || !E.length) return 0;
    if (cumM <= D[0]) return E[0] ?? 0;
    for (let i = 1; i < D.length; i++) {
      if (D[i] >= cumM) {
        const span = D[i] - D[i - 1];
        const f = span > 0 ? (cumM - D[i - 1]) / span : 0;
        return E[i - 1] + f * (E[i] - E[i - 1]);
      }
    }
    return E[E.length - 1] ?? 0;
  }

  /**
   * Fetch elevations for route points and render chart
   * @param {Array} routeCoords
   * @param {boolean} [isRoundTrip=false]
   */
  async update(routeCoords, isRoundTrip = false, turnaroundLatLng = null) {
    this.isRoundTrip = isRoundTrip;
    if (!routeCoords || routeCoords.length < 2) {
      this.turnaroundFrac = null;
      this.clear();
      return { ascent: 0, descent: 0, maxElev: 0, minElev: 0 };
    }

    // Sample points to limit API calls
    this.points = samplePoints(routeCoords, 80);

    // Batch query (Open-Meteo supports up to 100 coordinates)
    const lats = this.points.map((p) => p[0].toFixed(4)).join(',');
    const lngs = this.points.map((p) => p[1].toFixed(4)).join(',');

    try {
      const resp = await fetch(`${ELEVATION_API}?latitude=${lats}&longitude=${lngs}`);
      if (!resp.ok) throw new Error(`Elevation API error: ${resp.status}`);
      const data = await resp.json();
      this.elevations = data.elevation || [];
    } catch (err) {
      console.warn('Elevation API failed:', err.message);
      // Fallback: zero elevations
      this.elevations = this.points.map(() => 0);
    }

    // Calculate cumulative distances
    this.distances = cumulativeDistances(this.points);
    this.turnaroundFrac = this._computeTurnaroundFrac(turnaroundLatLng);

    // Calculate stats
    const stats = this._calcStats();

    // Render chart
    this._renderChart();

    return stats;
  }

  /** Find the fraction along the sampled polyline closest to turnaround latlng. */
  _computeTurnaroundFrac(turnaroundLatLng) {
    if (!turnaroundLatLng || !this.points || this.points.length < 3) return null;
    const [tlat, tlng] = turnaroundLatLng;
    let minD = Infinity, minI = -1;
    for (let i = 1; i < this.points.length - 1; i++) {
      const d = (this.points[i][0] - tlat) ** 2 + (this.points[i][1] - tlng) ** 2;
      if (d < minD) { minD = d; minI = i; }
    }
    if (minI < 0) return null;
    const total = this.distances[this.distances.length - 1] || 0;
    if (total <= 0) return null;
    const f = this.distances[minI] / total;
    return (f > 0.01 && f < 0.99) ? f : null;
  }

  /**
   * Update chart with pre-fetched elevation data (no API call)
   * @param {Array} sampledCoords
   * @param {Array} elevations
   * @param {boolean} [isRoundTrip=false]
   */
  updateWithData(sampledCoords, elevations, isRoundTrip = false, turnaroundLatLng = null) {
    if (!sampledCoords || sampledCoords.length < 2) {
      this.turnaroundFrac = null;
      this.clear();
      return;
    }

    this.isRoundTrip = isRoundTrip;
    this.points = sampledCoords;
    this.elevations = elevations;
    this.distances = cumulativeDistances(this.points);
    this.turnaroundFrac = this._computeTurnaroundFrac(turnaroundLatLng);
    this._renderChart();
  }

  clear() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this.elevations = [];
    this.distances = [];
    this.points = [];
    this._markers = [];
    this.emptyState.classList.remove('hidden');
  }

  _calcStats() {
    let ascent = 0, descent = 0;
    let maxElev = -Infinity, minElev = Infinity;

    for (let i = 0; i < this.elevations.length; i++) {
      const e = this.elevations[i];
      if (e > maxElev) maxElev = e;
      if (e < minElev) minElev = e;
      if (i > 0) {
        const diff = e - this.elevations[i - 1];
        if (diff > 0) ascent += diff;
        else descent += Math.abs(diff);
      }
    }

    return {
      ascent: Math.round(ascent),
      descent: Math.round(descent),
      maxElev: maxElev === -Infinity ? 0 : Math.round(maxElev),
      minElev: minElev === Infinity ? 0 : Math.round(minElev),
    };
  }

  _renderChart() {
    this.emptyState.classList.add('hidden');

    if (this.chart) {
      this.chart.destroy();
    }

    const labels = this.distances.map((d) => (d / 1000).toFixed(1));
    const ctx = this.canvas.getContext('2d');

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 160);
    gradient.addColorStop(0, 'rgba(110, 231, 183, 0.4)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)');

    // Plugin: draw waypoint / intermediate markers on the chart
    const self = this;
    const markerPlugin = {
      id: 'wpMarkers',
      afterDraw(chart) {
        const markers = self._markers;
        if (!markers || markers.length === 0) return;
        const { ctx: c, chartArea: { top, bottom, left, right }, scales } = chart;
        const totalM = self.distances[self.distances.length - 1] || 1;

        markers.forEach((m) => {
          // Use Chart.js-rendered pixel coordinates so the dot sits exactly
          // on the elevation curve (avoids category-scale vs distance mismatch).
          let xPx, yPx, xFrac;
          const meta = chart.getDatasetMeta(0);
          const ptMeta = m.dataIdx != null ? meta.data[m.dataIdx] : null;
          if (ptMeta) {
            xPx = ptMeta.x;
            yPx = ptMeta.y;
            xFrac = (right > left) ? (xPx - left) / (right - left) : 0;
          } else {
            // Fallback: distance-fraction positioning
            xFrac = Math.max(0, Math.min(1, m.cumDistM / totalM));
            xPx = left + xFrac * (right - left);
            const elev = self.isCollapsed ? 0 : self._interpolateElevAtCumM(m.cumDistM);
            yPx = scales.y.getPixelForValue(elev);
          }

          let rgb;
          if (self.turnaroundFrac != null && xFrac > self.turnaroundFrac) {
            const denom = 1 - self.turnaroundFrac;
            const tRet = denom > 0 ? (xFrac - self.turnaroundFrac) / denom : 0;
            rgb = interpolateReturnColorRgb(Math.max(0, Math.min(1, tRet)));
          } else if (self.turnaroundFrac != null) {
            const tOut = self.turnaroundFrac > 0 ? xFrac / self.turnaroundFrac : 0;
            rgb = interpolateRouteColorRgb(Math.max(0, Math.min(1, tOut)));
          } else {
            const tColor = self.isRoundTrip ? 1 - Math.abs(2 * xFrac - 1) : xFrac;
            rgb = interpolateRouteColorRgb(tColor);
          }
          const baseColor = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
          const lineColor = `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`;

          c.save();

          // Vertical dashed line in gradient color
          c.strokeStyle = lineColor;
          c.lineWidth = 1;
          c.setLineDash([3, 3]);
          c.beginPath();
          c.moveTo(xPx, top);
          c.lineTo(xPx, bottom);
          c.stroke();
          c.setLineDash([]);

          // Dot on elevation line in gradient color
          const r = m.isWaypoint ? 5 : 3.5;
          c.fillStyle = baseColor;
          c.beginPath();
          c.arc(xPx, yPx, r, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = 'rgba(255,255,255,0.85)';
          c.lineWidth = 1.5;
          c.stroke();

          // Draw weather icon emoji if available
          if (m.weatherIcon && !self.isCollapsed) {
            c.font = '16px serif';
            c.textAlign = 'center';
            c.textBaseline = 'bottom';
            // Draw slightly above the dot
            c.fillText(m.weatherIcon, xPx, yPx - r - 5);
          }

          c.restore();
        });
      },
    };

    // Canvas gradient plugin: horizontal linear gradient teal→sky→amber→red
    // For round-trip: symmetric teal→red→teal
    const lineGradientPlugin = {
      id: 'lineGradient',
      beforeDatasetsDraw(chart) {
        const { chartArea, ctx: c } = chart;
        if (!chartArea) return;
        const g = c.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
        if (self.turnaroundFrac != null) {
          // Outbound teal→sky→amber→red up to turnaround, then red→purple→deep-sea→sky blue
          const tf = self.turnaroundFrac;
          g.addColorStop(0, 'rgb(110,231,183)');
          g.addColorStop(tf * 0.33, 'rgb(56,189,248)');
          g.addColorStop(tf * 0.66, 'rgb(251,191,36)');
          g.addColorStop(tf, 'rgb(248,113,113)');
          g.addColorStop(tf + (1 - tf) * 0.33, 'rgb(168,85,247)');
          g.addColorStop(tf + (1 - tf) * 0.66, 'rgb(30,64,175)');
          g.addColorStop(1, 'rgb(56,189,248)');
        } else if (self.isRoundTrip) {
          // Legacy fallback (no turnaround info): symmetric teal→red→teal
          g.addColorStop(0, 'rgb(110,231,183)');
          g.addColorStop(0.165, 'rgb(56,189,248)');
          g.addColorStop(0.33, 'rgb(251,191,36)');
          g.addColorStop(0.5, 'rgb(248,113,113)');
          g.addColorStop(0.67, 'rgb(251,191,36)');
          g.addColorStop(0.835, 'rgb(56,189,248)');
          g.addColorStop(1, 'rgb(110,231,183)');
        } else {
          g.addColorStop(0, 'rgb(110,231,183)');
          g.addColorStop(0.33, 'rgb(56,189,248)');
          g.addColorStop(0.66, 'rgb(251,191,36)');
          g.addColorStop(1, 'rgb(248,113,113)');
        }
        chart.data.datasets[0].borderColor = g;
      },
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: this.isCollapsed ? this.elevations.map(() => 0) : this.elevations,
            fill: !this.isCollapsed,
            backgroundColor: gradient,
            borderColor: '#6ee7b7',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: this.isCollapsed ? { top: 0, bottom: 0, left: -5, right: -5 } : 0
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !this.isCollapsed,
            backgroundColor: 'rgba(22,24,34,0.9)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleFont: { family: 'Inter', size: 11 },
            bodyFont: { family: 'Inter', size: 12, weight: '600' },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => `距離: ${items[0].label} km`,
              label: (item) => `海拔: ${formatElevation(this.elevations[item.dataIndex])}`,
            },
          },
          wpMarkers: {}, // enable local plugin
        },
        scales: {
          x: {
            display: !this.isCollapsed,
            title: { display: true, text: 'km', color: '#6b7280', font: { size: 10 } },
            ticks: { color: '#6b7280', font: { size: 9 }, maxTicksLimit: 8 },
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.06)' },
          },
          y: {
            display: !this.isCollapsed,
            title: { display: true, text: 'm', color: '#6b7280', font: { size: 10 } },
            ticks: { color: '#6b7280', font: { size: 9 }, maxTicksLimit: 5 },
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.06)' },
          },
        },
        onClick: (event, _elements, chart) => {
          const markers = self._markers;
          if (!markers || markers.length === 0 || !self.onMarkerClick) return;
          const rect = chart.canvas.getBoundingClientRect();
          const xPx = (event.native?.clientX ?? 0) - rect.left;
          const { left: cLeft, right: cRight } = chart.chartArea;
          const totalM = self.distances[self.distances.length - 1] || 1;
          let closest = null, minDist = 18;
          markers.forEach((m) => {
            const mxPx = cLeft + (m.cumDistM / totalM) * (cRight - cLeft);
            const d = Math.abs(xPx - mxPx);
            if (d < minDist) { minDist = d; closest = m; }
          });
          if (closest) self.onMarkerClick(closest.colIdx);
        },
        onHover: (event, elements, chart) => {
          if (elements.length > 0 && self.onHover) {
            const idx = elements[0].index;
            if (idx < self.points.length) {
              const maxDist = self.distances[self.distances.length - 1] || 1;
              const cumM = self.distances[idx] || 0;
              const xFrac = Math.max(0, Math.min(1, cumM / maxDist));
              let color;
              if (self.turnaroundFrac != null && xFrac > self.turnaroundFrac) {
                const denom = 1 - self.turnaroundFrac;
                const tRet = denom > 0 ? (xFrac - self.turnaroundFrac) / denom : 0;
                color = interpolateReturnColor(Math.max(0, Math.min(1, tRet)));
              } else if (self.turnaroundFrac != null) {
                const tOut = self.turnaroundFrac > 0 ? xFrac / self.turnaroundFrac : 0;
                color = interpolateRouteColor(Math.max(0, Math.min(1, tOut)));
              } else {
                const t = self.isRoundTrip ? (1 - Math.abs(2 * xFrac - 1)) : xFrac;
                color = interpolateRouteColor(t);
              }
              self.onHover(self.points[idx][0], self.points[idx][1], color);
            }
          }
          // Change cursor when hovering near a marker
          const markers = self._markers;
          if (markers && markers.length > 0 && event.native) {
            const rect = chart.canvas.getBoundingClientRect();
            const xPx = event.native.clientX - rect.left;
            const { left: cLeft, right: cRight } = chart.chartArea;
            const totalM = self.distances[self.distances.length - 1] || 1;
            const near = markers.some((m) => {
              const mxPx = cLeft + (m.cumDistM / totalM) * (cRight - cLeft);
              return Math.abs(xPx - mxPx) < 18;
            });
            chart.canvas.style.cursor = near ? 'pointer' : 'default';
          }
        },
      },
      plugins: [markerPlugin, lineGradientPlugin],
    });

    // Resize on next frame so the chart fills the container correctly
    // (the bottom panel may not have finished layout when _renderChart is called)
    requestAnimationFrame(() => this.chart?.resize());
  }
}
