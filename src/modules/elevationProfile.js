/**
 * Mapping Elf — Elevation Profile
 * Queries Open-Meteo Elevation API and renders Chart.js profile
 */
import { Chart, registerables } from 'chart.js';
import { samplePoints, cumulativeDistances, formatDistance, formatElevation } from './utils.js';

Chart.register(...registerables);

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';

export class ElevationProfile {
  constructor(canvasId, emptyStateId, onHover) {
    this.canvas = document.getElementById(canvasId);
    this.emptyState = document.getElementById(emptyStateId);
    this.onHover = onHover;
    this.chart = null;
    this.elevations = [];
    this.distances = [];
    this.points = [];
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
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#fbbf24',
            pointHoverBorderColor: '#fff',
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
        onHover: (event, elements) => {
          if (elements.length > 0 && this.onHover) {
            const idx = elements[0].index;
            if (idx < this.points.length) {
              this.onHover(this.points[idx][0], this.points[idx][1]);
            }
          }
        },
      },
    });
  }
}
