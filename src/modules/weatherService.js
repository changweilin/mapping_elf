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
  async getWeatherAlongRoute(routeCoords, dateStr, timeStr) {
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
          data = await this._fetchForecast(lat, lng, dateStr, timeStr);
        } else {
          // Historical
          data = await this._fetchHistorical(lat, lng, dateStr, timeStr);
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

  async _fetchForecast(lat, lng, dateStr, timeStr) {
    const url = `${FORECAST_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,relative_humidity_2m_mean&hourly=temperature_2m,relative_humidity_2m,precipitation,weathercode,windspeed_10m&timezone=Asia/Taipei&start_date=${dateStr}&end_date=${dateStr}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Forecast API error: ${resp.status}`);
    const json = await resp.json();
    const d = json.daily;
    const h = json.hourly;
    if (!d || !d.time || d.time.length === 0) throw new Error('No forecast data');

    let targetCode = d.weathercode?.[0] ?? -1;
    let mainTempStr = '—';
    let prepStr = d.precipitation_sum?.[0] != null ? `${d.precipitation_sum[0]} mm` : '—';
    let windStr = d.windspeed_10m_max?.[0] != null ? `${d.windspeed_10m_max[0]} km/h` : '—';
    let humStr = d.relative_humidity_2m_mean?.[0] != null ? `${d.relative_humidity_2m_mean[0]}%` : '—';

    // If a time was specified, try to find the matching hourly weather
    if (timeStr && h && h.time) {
      const hour = parseInt(timeStr.split(':')[0]);
      if (!isNaN(hour) && hour >= 0 && hour < 24) {
         targetCode = h.weathercode?.[hour] ?? targetCode;
         mainTempStr = h.temperature_2m?.[hour] != null ? `${h.temperature_2m[hour]}°C` : '—';
         prepStr = h.precipitation?.[hour] != null ? `${h.precipitation[hour]} mm` : prepStr;
         windStr = h.windspeed_10m?.[hour] != null ? `${h.windspeed_10m[hour]} km/h` : windStr;
         humStr = h.relative_humidity_2m?.[hour] != null ? `${h.relative_humidity_2m[hour]}%` : humStr;
      }
    } else {
      mainTempStr = d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°C` : '—';
    }

    const wmo = WMO_CODES[targetCode] || { icon: '❓', desc: '未知' };

    return {
      temp: mainTempStr,
      tempMax: d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°C` : '—',
      tempMin: d.temperature_2m_min?.[0] != null ? `${d.temperature_2m_min[0]}°C` : '—',
      humidity: humStr,
      windSpeed: windStr,
      precipitation: prepStr,
      weatherCode: targetCode,
      weatherDesc: wmo.desc,
      weatherIcon: wmo.icon,
    };
  }

  async _fetchHistorical(lat, lng, dateStr, timeStr) {
    const url = `${HISTORICAL_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max&hourly=temperature_2m,relative_humidity_2m,precipitation,weathercode,windspeed_10m&timezone=Asia/Taipei&start_date=${dateStr}&end_date=${dateStr}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Historical API error: ${resp.status}`);
    const json = await resp.json();
    const d = json.daily;
    const h = json.hourly;
    if (!d || !d.time || d.time.length === 0) throw new Error('No historical data');

    let targetCode = d.weathercode?.[0] ?? -1;
    let mainTempStr = '—';
    let prepStr = d.precipitation_sum?.[0] != null ? `${d.precipitation_sum[0]} mm` : '—';
    let windStr = d.windspeed_10m_max?.[0] != null ? `${d.windspeed_10m_max[0]} km/h` : '—';
    let humStr = '—';

    if (timeStr && h && h.time) {
      const hour = parseInt(timeStr.split(':')[0]);
      if (!isNaN(hour) && hour >= 0 && hour < 24) {
         targetCode = h.weathercode?.[hour] ?? targetCode;
         mainTempStr = h.temperature_2m?.[hour] != null ? `${h.temperature_2m[hour]}°C` : '—';
         prepStr = h.precipitation?.[hour] != null ? `${h.precipitation[hour]} mm` : prepStr;
         windStr = h.windspeed_10m?.[hour] != null ? `${h.windspeed_10m[hour]} km/h` : windStr;
         humStr = h.relative_humidity_2m?.[hour] != null ? `${h.relative_humidity_2m[hour]}%` : humStr;
      }
    } else {
      mainTempStr = d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°C` : '—';
    }

    const wmo = WMO_CODES[targetCode] || { icon: '❓', desc: '未知' };

    return {
      temp: mainTempStr,
      tempMax: d.temperature_2m_max?.[0] != null ? `${d.temperature_2m_max[0]}°C` : '—',
      tempMin: d.temperature_2m_min?.[0] != null ? `${d.temperature_2m_min[0]}°C` : '—',
      humidity: humStr,
      windSpeed: windStr,
      precipitation: prepStr,
      weatherCode: targetCode,
      weatherDesc: wmo.desc,
      weatherIcon: wmo.icon,
    };
  }

  /**
   * Fetch all available free weather data for a single point
   * @param {number} lat
   * @param {number} lng
   * @param {string} dateStr  YYYY-MM-DD
   * @param {number} hour     0-23
   */
  async getWeatherAtPoint(lat, lng, dateStr, hour) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.round((targetDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= 16) {
      return this._fetchForecastFull(lat, lng, dateStr, hour);
    } else {
      return this._fetchHistoricalFull(lat, lng, dateStr, hour);
    }
  }

  async _fetchForecastFull(lat, lng, dateStr, hour) {
    const hourly = [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dewpoint_2m',
      'precipitation', 'precipitation_probability', 'weathercode',
      'windspeed_10m', 'windgusts_10m', 'uv_index', 'visibility', 'cloudcover',
    ].join(',');
    const daily = [
      'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'weathercode',
      'windspeed_10m_max', 'windgusts_10m_max', 'sunrise', 'sunset',
      'sunshine_duration', 'precipitation_probability_max', 'uv_index_max', 'shortwave_radiation_sum',
    ].join(',');
    const url = `${FORECAST_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=${hourly}&daily=${daily}&timezone=Asia%2FTaipei&start_date=${dateStr}&end_date=${dateStr}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Forecast API error: ${resp.status}`);
    return this._parseFullData(await resp.json(), hour, true);
  }

  async _fetchHistoricalFull(lat, lng, dateStr, hour) {
    const hourly = [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dewpoint_2m',
      'precipitation', 'weathercode', 'windspeed_10m', 'windgusts_10m', 'visibility', 'cloudcover',
    ].join(',');
    const daily = [
      'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'weathercode',
      'windspeed_10m_max', 'windgusts_10m_max', 'sunrise', 'sunset',
      'sunshine_duration', 'shortwave_radiation_sum',
    ].join(',');
    const url = `${HISTORICAL_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=${hourly}&daily=${daily}&timezone=Asia%2FTaipei&start_date=${dateStr}&end_date=${dateStr}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Historical API error: ${resp.status}`);
    return this._parseFullData(await resp.json(), hour, false);
  }

  _parseFullData(json, hour, isForecast) {
    const d = json.daily;
    const h = json.hourly;
    if (!d || !d.time || d.time.length === 0) throw new Error('No data');

    const n = (v, unit = '') => v != null ? `${v}${unit}` : null;

    let hourlyCode = d.weathercode?.[0] ?? -1;
    let temp = null, feelsLike = null, humidity = null, dewPoint = null;
    let precip = null, precipProb = null, windSpeed = null, windGust = null;
    let uvIndex = null, visibility = null, cloudCover = null;

    if (h && h.time && hour >= 0 && hour < 24) {
      hourlyCode = h.weathercode?.[hour] ?? hourlyCode;
      temp       = h.temperature_2m?.[hour] ?? null;
      feelsLike  = h.apparent_temperature?.[hour] ?? null;
      humidity   = h.relative_humidity_2m?.[hour] ?? null;
      dewPoint   = h.dewpoint_2m?.[hour] ?? null;
      precip     = h.precipitation?.[hour] ?? null;
      precipProb = isForecast ? (h.precipitation_probability?.[hour] ?? null) : null;
      windSpeed  = h.windspeed_10m?.[hour] ?? null;
      windGust   = h.windgusts_10m?.[hour] ?? null;
      uvIndex    = isForecast ? (h.uv_index?.[hour] ?? null) : null;
      visibility = h.visibility?.[hour] ?? null;   // metres
      cloudCover = h.cloudcover?.[hour] ?? null;   // %
    }

    const fmtDT = s => s ? (s.split('T')[1] ?? '').slice(0, 5) || null : null;
    const wmo = WMO_CODES[hourlyCode] || { icon: '❓', desc: '未知' };

    return {
      weatherCode: hourlyCode, weatherIcon: wmo.icon, weatherDesc: wmo.desc,
      temp:     n(temp,     '°C'),
      tempMax:  n(d.temperature_2m_max?.[0], '°C'),
      tempMin:  n(d.temperature_2m_min?.[0], '°C'),
      feelsLike: n(feelsLike, '°C'),
      humidity:  n(humidity,  '%'),
      dewPoint:  n(dewPoint,  '°C'),
      precipitation:    n(precip,  ' mm'),
      precipitationSum: n(d.precipitation_sum?.[0], ' mm'),
      precipProb:    n(precipProb, '%'),
      precipProbMax: isForecast ? n(d.precipitation_probability_max?.[0], '%') : null,
      windSpeed:    n(windSpeed,             ' km/h'),
      windGust:     n(windGust,              ' km/h'),
      windSpeedMax: n(d.windspeed_10m_max?.[0],  ' km/h'),
      windGustMax:  n(d.windgusts_10m_max?.[0],  ' km/h'),
      uvIndex:    n(uvIndex),
      uvIndexMax: isForecast ? n(d.uv_index_max?.[0]) : null,
      radiation:     n(d.shortwave_radiation_sum?.[0], ' MJ/m²'),
      sunshineHours: d.sunshine_duration?.[0] != null
        ? `${(d.sunshine_duration[0] / 3600).toFixed(1)} h` : null,
      visibility: visibility != null ? `${(visibility / 1000).toFixed(1)} km` : null,
      cloudCover: n(cloudCover, '%'),
      sunrise: fmtDT(d.sunrise?.[0]),
      sunset:  fmtDT(d.sunset?.[0]),
    };
  }

  static getWmoInfo(code) {
    return WMO_CODES[code] || { icon: '❓', desc: '未知' };
  }
}
