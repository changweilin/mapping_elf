/**
 * Mapping Elf — Weather Service
 * Uses Open-Meteo API for weather data
 */
import { samplePoints } from './utils.js';

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const HISTORICAL_API = 'https://archive-api.open-meteo.com/v1/archive';

// WMO Weather codes to emoji + description
const WMO_CODES = {
  0: { icon: '☀️', desc: '晴天' },
  1: { icon: '🌤️', desc: '大致晴朗' },
  2: { icon: '⛅', desc: '多雲' },
  3: { icon: '☁️', desc: '陰天' },
  45: { icon: '🌫️', desc: '霧' },
  48: { icon: '🌫️', desc: '霜霧' },
  51: { icon: '🌦️', desc: '小毛雨' },
  53: { icon: '🌦️', desc: '毛雨' },
  55: { icon: '🌧️', desc: '大毛雨' },
  61: { icon: '🌧️', desc: '小雨' },
  63: { icon: '🌧️', desc: '中雨' },
  65: { icon: '🌧️', desc: '大雨' },
  71: { icon: '🌨️', desc: '小雪' },
  73: { icon: '🌨️', desc: '中雪' },
  75: { icon: '❄️', desc: '大雪' },
  80: { icon: '🌦️', desc: '陣雨' },
  81: { icon: '🌧️', desc: '中陣雨' },
  82: { icon: '⛈️', desc: '大陣雨' },
  95: { icon: '⛈️', desc: '雷暴' },
  96: { icon: '⛈️', desc: '雷暴伴冰雹' },
  99: { icon: '⛈️', desc: '強雷暴伴冰雹' },
};

export class WeatherService {
  /**
   * Fetch weather for route points on a given date
   */
  async getWeatherAlongRoute(routeCoords, dateStr) {
    if (!routeCoords || routeCoords.length < 2 || !dateStr) return [];

    // Sample 3-5 points along route
    const samples = samplePoints(routeCoords, 5);
    // Pick start, middle, end
    const queryPoints = [
      samples[0],
      samples[Math.floor(samples.length / 2)],
      samples[samples.length - 1],
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateStr);
    const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));

    const results = [];
    const labels = ['起點', '中點', '終點'];

    for (let i = 0; i < queryPoints.length; i++) {
      const [lat, lng] = queryPoints[i];
      try {
        let data;
        if (diffDays >= 0 && diffDays <= 16) {
          // Forecast
          data = await this._fetchForecast(lat, lng, dateStr);
        } else {
          // Historical
          data = await this._fetchHistorical(lat, lng, dateStr);
        }
        data.label = labels[i];
        data.lat = lat;
        data.lng = lng;
        results.push(data);
      } catch (err) {
        console.warn(`Weather fetch failed for point ${i}:`, err.message);
        results.push({
          label: labels[i], lat, lng,
          temp: '—', tempMax: '—', tempMin: '—',
          humidity: '—', windSpeed: '—', precipitation: '—',
          weatherCode: -1, weatherDesc: '無法取得', weatherIcon: '❓',
        });
      }
    }

    return results;
  }

  async _fetchForecast(lat, lng, dateStr) {
    const url = `${FORECAST_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,relative_humidity_2m_mean&timezone=Asia/Taipei&start_date=${dateStr}&end_date=${dateStr}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Forecast API error: ${resp.status}`);
    const json = await resp.json();
    const d = json.daily;
    if (!d || !d.time || d.time.length === 0) throw new Error('No forecast data');

    const code = d.weathercode?.[0] ?? -1;
    const wmo = WMO_CODES[code] || { icon: '❓', desc: '未知' };

    return {
      temp: d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°` : '—',
      tempMax: d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°C` : '—',
      tempMin: d.temperature_2m_min?.[0] != null ? `${d.temperature_2m_min[0]}°C` : '—',
      humidity: d.relative_humidity_2m_mean?.[0] != null ? `${d.relative_humidity_2m_mean[0]}%` : '—',
      windSpeed: d.windspeed_10m_max?.[0] != null ? `${d.windspeed_10m_max[0]} km/h` : '—',
      precipitation: d.precipitation_sum?.[0] != null ? `${d.precipitation_sum[0]} mm` : '—',
      weatherCode: code,
      weatherDesc: wmo.desc,
      weatherIcon: wmo.icon,
    };
  }

  async _fetchHistorical(lat, lng, dateStr) {
    const url = `${HISTORICAL_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max&timezone=Asia/Taipei&start_date=${dateStr}&end_date=${dateStr}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Historical API error: ${resp.status}`);
    const json = await resp.json();
    const d = json.daily;
    if (!d || !d.time || d.time.length === 0) throw new Error('No historical data');

    const code = d.weathercode?.[0] ?? -1;
    const wmo = WMO_CODES[code] || { icon: '❓', desc: '未知' };

    return {
      temp: d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°` : '—',
      tempMax: d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°C` : '—',
      tempMin: d.temperature_2m_min?.[0] != null ? `${d.temperature_2m_min[0]}°C` : '—',
      humidity: '—',
      windSpeed: d.windspeed_10m_max?.[0] != null ? `${d.windspeed_10m_max[0]} km/h` : '—',
      precipitation: d.precipitation_sum?.[0] != null ? `${d.precipitation_sum[0]} mm` : '—',
      weatherCode: code,
      weatherDesc: wmo.desc,
      weatherIcon: wmo.icon,
    };
  }

  static getWmoInfo(code) {
    return WMO_CODES[code] || { icon: '❓', desc: '未知' };
  }
}
