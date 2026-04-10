/**
 * Mapping Elf — Elevation Profile
 * Queries Open-Meteo Elevation API and renders Chart.js profile
 */
import { Chart, registerables } from 'chart.js';
import { samplePoints, cumulativeDistances, formatDistance, formatElevation, interpolateRouteColor, interpolateRouteColorRgb } from './utils.js';

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
   */
  async update(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) {
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

    // Calculate stats
    const stats = this._calcStats();

    // Render chart
    this._renderChart();

    return stats;
  }

  /**
   * Update chart with pre-fetched elevation data (no API call)
   */
  updateWithData(sampledCoords, elevations) {
    if (!sampledCoords || sampledCoords.length < 2) {
      this.clear();
      return;
    }

    this.points = sampledCoords;
    this.elevations = elevations;
    this.distances = cumulativeDistances(this.points);
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
          const xFrac = Math.max(0, Math.min(1, m.cumDistM / totalM));
          const xPx = left + xFrac * (right - left);
          const elev = self._interpolateElevAtCumM(m.cumDistM);
          const yPx = scales.y.getPixelForValue(elev);

          const rgb = interpolateRouteColorRgb(xFrac);
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

          c.restore();
        });
      },
    };

    // Canvas gradient plugin: horizontal linear gradient teal→sky→amber→red
    const lineGradientPlugin = {
      id: 'lineGradient',
      beforeDatasetsDraw(chart) {
        const { chartArea, ctx: c } = chart;
        if (!chartArea) return;
        const g = c.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
        g.addColorStop(0,    'rgb(110,231,183)');
        g.addColorStop(0.33, 'rgb(56,189,248)');
        g.addColorStop(0.66, 'rgb(251,191,36)');
        g.addColorStop(1,    'rgb(248,113,113)');
        chart.data.datasets[0].borderColor = g;
      },
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: this.elevations,
            fill: true,
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
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(22,24,34,0.9)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleFont: { family: 'Inter', size: 11 },
            bodyFont: { family: 'Inter', size: 12, weight: '600' },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => `距離: ${items[0].label} km`,
              label: (item) => `海拔: ${formatElevation(item.raw)}`,
            },
          },
          wpMarkers: {}, // enable local plugin
        },
        scales: {
          x: {
            title: { display: true, text: 'km', color: '#6b7280', font: { size: 10 } },
            ticks: { color: '#6b7280', font: { size: 9 }, maxTicksLimit: 8 },
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.06)' },
          },
          y: {
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
              self.onHover(self.points[idx][0], self.points[idx][1]);
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
  }
}
