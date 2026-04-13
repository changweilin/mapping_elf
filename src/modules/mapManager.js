/**
 * Mapping Elf — Map Manager
 * Handles Leaflet map, layers, waypoints, multiple route polylines
 */
import L from 'leaflet';
import { interpolateRouteColor } from './utils.js';

const TILE_LAYERS = {
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; OpenTopoMap',
      maxZoom: 17,
    },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: '&copy; Esri',
      maxZoom: 19,
    },
  },
};

const DEFAULT_CENTER = [23.5, 121.0];
const DEFAULT_ZOOM = 8;

// Colors for alternative routes
const ROUTE_COLORS = ['#6ee7b7', '#60a5fa', '#f59e0b', '#f87171'];
const ROUTE_ALT_OPACITY = 0.4;
const ROUTE_SELECTED_OPACITY = 0.9;

// Max gradient chunks for the selected route polyline
const GRADIENT_CHUNKS = 80;

export class MapManager {
  constructor(containerId, onWaypointChange) {
    this.onWaypointChange = onWaypointChange;
    this.onRouteSelect = null; // callback(index)
    this.onRouteHover = null; // callback(lat, lng) | callback(null, null)
    this.onWaypointSelect = null; // callback(wpIndex)
    this.isRoundTrip = false;
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = []; // Weather emoji per waypoint index
    this.waypointColors = [];  // Gradient color strings per waypoint index
    this.routePolylines = []; // Solid polylines for alternative routes
    this.gradientPolylines = []; // Gradient chunks for selected route
    this.selectedRouteIndex = 0;
    this.hoverMarker = null;
    this.currentLayerName = 'streets';
    this.intermediateMarkers = [];
    this.ignoreMapClick = false;
    this.dragLine = null;
    this._dragWpIndex = undefined;

    this.map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    this.tileLayers = {};
    for (const [name, config] of Object.entries(TILE_LAYERS)) {
      this.tileLayers[name] = L.tileLayer(config.url, config.options);
    }
    this.tileLayers.streets.addTo(this.map);

    this.map.on('click', (e) => {
      if (this.ignoreMapClick) return;
      this.addWaypoint(e.latlng.lat, e.latlng.lng);
    });
  }

  _blockMapClick() {
    this.ignoreMapClick = true;
    setTimeout(() => { this.ignoreMapClick = false; }, 300);
  }

  _startRubberBand(marker) {
    const idx = this.waypointMarkers.indexOf(marker);
    if (idx < 0) return;
    this._dragWpIndex = idx;
    if (this.dragLine) {
      this.map.removeLayer(this.dragLine);
    }
    this.dragLine = L.polyline([], {
      color: '#f59e0b', // 使用琥珀色(Amber)強調虛線
      weight: 3,
      dashArray: '6 6',
      opacity: 0.9,
      interactive: false,
    }).addTo(this.map);
    this._updateRubberBand(marker.getLatLng());
  }

  _updateRubberBand(latlng) {
    if (!this.dragLine || this._dragWpIndex === undefined) return;
    const idx = this._dragWpIndex;
    const pts = [];
    if (idx > 0) pts.push(this.waypoints[idx - 1]);
    pts.push([latlng.lat, latlng.lng]);
    if (idx < this.waypoints.length - 1) pts.push(this.waypoints[idx + 1]);
    this.dragLine.setLatLngs(pts);
  }

  _stopRubberBand() {
    if (this.dragLine) {
      this.map.removeLayer(this.dragLine);
      this.dragLine = null;
    }
    this._dragWpIndex = undefined;
  }

  switchLayer(layerName) {
    if (!this.tileLayers[layerName]) return;
    this.map.removeLayer(this.tileLayers[this.currentLayerName]);
    this.tileLayers[layerName].addTo(this.map);
    this.currentLayerName = layerName;
  }

  addWaypoint(lat, lng) {
    this.waypoints.push([lat, lng]);
    const icon = this._createIcon(this.waypoints.length - 1);

    const marker = L.marker([lat, lng], {
      icon,
      draggable: false,
    }).addTo(this.map);

    let _dragModeActive = false;
    let _justDragged = false;
    let _isTouchActive = false;

    const _enableDrag = () => {
      _dragModeActive = true;
      marker.dragging.enable();
      marker.getElement()?.classList.add('is-dragging');
      if (navigator.vibrate) navigator.vibrate(40);
    };

    const _disableDrag = () => {
      _dragModeActive = false;
      marker.dragging.disable();
      marker.getElement()?.classList.remove('is-dragging');
    };

    // Desktop: right-click / context menu → Leaflet built-in drag.
    // Guard: on mobile Leaflet fires a synthetic contextmenu during a long-press
    // (before our 500ms timer). Do NOT call _enableDrag() then — enabling
    // Leaflet's built-in drag mid-touch leaves the start position undefined and
    // causes the marker to jump off-screen (same problem described in the touch
    // handler below). The manual touch-drag handler will activate at 500ms.
    marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      if (_isTouchActive || _longPressTimer !== null || _dragModeActive) return;
      _enableDrag();
    });

    // Desktop: left-button long-press (500ms) → manual drag
    let _mouseLPTimer = null;
    let _mouseStartX = 0, _mouseStartY = 0;
    marker.on('mousedown', (e) => {
      if (e.originalEvent.button !== 0 || _dragModeActive) return;
      L.DomEvent.stopPropagation(e);
      _mouseStartX = e.originalEvent.clientX;
      _mouseStartY = e.originalEvent.clientY;

      const cancelLP = () => {
        clearTimeout(_mouseLPTimer);
        _mouseLPTimer = null;
        document.removeEventListener('mousemove', onMoveGuard);
        document.removeEventListener('mouseup', cancelLP);
      };
      const onMoveGuard = (ev) => {
        const dx = ev.clientX - _mouseStartX, dy = ev.clientY - _mouseStartY;
        if (dx * dx + dy * dy > 64) cancelLP();
      };

      _mouseLPTimer = setTimeout(() => {
        document.removeEventListener('mousemove', onMoveGuard);
        document.removeEventListener('mouseup', cancelLP);
        _mouseLPTimer = null;
        _dragModeActive = true;
        marker.getElement()?.classList.add('is-dragging');
        if (navigator.vibrate) navigator.vibrate(40);
        this.map.dragging.disable();

        const onMove = (ev) => marker.setLatLng(this.map.mouseEventToLatLng(ev));
        const onUp = () => {
          _dragModeActive = false;
          _justDragged = true;
          this._blockMapClick();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          this.map.dragging.enable();
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const pos = marker.getLatLng();
          const idx = this.waypointMarkers.indexOf(marker);
          if (idx >= 0) {
            this.waypoints[idx] = [pos.lat, pos.lng];
            this.onWaypointChange(this.waypoints);
          }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }, 500);

      document.addEventListener('mousemove', onMoveGuard);
      document.addEventListener('mouseup', cancelLP);
    });

    // Touch: long-press (500ms) → manual drag (mirrors desktop handler).
    // We do NOT use marker.dragging.enable() here because Leaflet's built-in
    // drag needs a touchstart to anchor its start point; enabling it mid-touch
    // (500ms after the original touchstart) leaves the start position undefined,
    // causing the marker to jump off-screen on the first touchmove.
    let _longPressTimer = null;
    let _touchStartX = 0, _touchStartY = 0;
    marker.on('touchstart', (e) => {
      _isTouchActive = true;
      if (_dragModeActive) return;
      const touch = e.originalEvent.touches[0];
      _touchStartX = touch.clientX;
      _touchStartY = touch.clientY;

      _longPressTimer = setTimeout(() => {
        _longPressTimer = null;
        _dragModeActive = true;
        marker.getElement()?.classList.add('is-dragging');
        if (navigator.vibrate) navigator.vibrate(40);
        this.map.dragging.disable();

        this._startRubberBand(marker);

        const onTouchMove = (ev) => {
          ev.preventDefault();
          const t = ev.touches[0];
          // 在手機版加入 Y 軸負偏移(-40px)，讓圖標浮在手指上方避免被遮擋
          const rect = this.map.getContainer().getBoundingClientRect();
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top - 40;
          const latlng = this.map.containerPointToLatLng([x, y]);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
        };
        const onTouchEnd = () => {
          _dragModeActive = false;
          _isTouchActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          this.map.dragging.enable();
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
          const pos = marker.getLatLng();
          const idx = this.waypointMarkers.indexOf(marker);
          if (idx >= 0) {
            this.waypoints[idx] = [pos.lat, pos.lng];
            this.onWaypointChange(this.waypoints);
          }
        };
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
      }, 500);
    });
    marker.on('touchmove', (e) => {
      if (_longPressTimer) {
        const touch = e.originalEvent.touches[0];
        const dx = touch.clientX - _touchStartX;
        const dy = touch.clientY - _touchStartY;
        if (dx * dx + dy * dy > 64) {
          clearTimeout(_longPressTimer);
          _longPressTimer = null;
        }
      }
    });
    marker.on('touchend', () => {
      _isTouchActive = false;
      if (_longPressTimer) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
      }
    });

    // Click/tap: cancel drag mode; on normal click → notify selection
    marker.on('click', (e) => {
      if (_dragModeActive || _justDragged) {
        L.DomEvent.stopPropagation(e);
        if (_dragModeActive) _disableDrag();
        return;
      }
      const idx = this.waypointMarkers.indexOf(marker);
      if (idx >= 0) this.onWaypointSelect?.(idx);
    });

    marker.on('dragend', (e) => {
      this._blockMapClick();
      const pos = e.target.getLatLng();
      const idx = this.waypointMarkers.indexOf(marker);
      this.waypoints[idx] = [pos.lat, pos.lng];
      _disableDrag();
      this.onWaypointChange(this.waypoints);
    });

    this.waypointMarkers.push(marker);
    this._updateMarkerIcons();
    this.onWaypointChange(this.waypoints);
  }

  removeWaypoint(index) {
    this.map.removeLayer(this.waypointMarkers[index]);
    this.waypoints.splice(index, 1);
    this.waypointMarkers.splice(index, 1);
    this.waypointWeather.splice(index, 1);
    this._updateMarkerIcons();
    this.onWaypointChange(this.waypoints);
  }

  removeLastWaypoint() {
    if (this.waypoints.length === 0) return;
    this.removeWaypoint(this.waypoints.length - 1);
  }

  moveWaypoint(index, offset) {
    const newIndex = index + offset;
    if (newIndex < 0 || newIndex >= this.waypoints.length) return;

    // Swap data
    const tempCoords = this.waypoints[index];
    this.waypoints[index] = this.waypoints[newIndex];
    this.waypoints[newIndex] = tempCoords;

    const tempMarker = this.waypointMarkers[index];
    this.waypointMarkers[index] = this.waypointMarkers[newIndex];
    this.waypointMarkers[newIndex] = tempMarker;

    this._updateMarkerIcons();
    this.onWaypointChange(this.waypoints);
  }

  clearWaypoints() {
    this.waypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = [];
    this.clearAllRoutes();
    this.onWaypointChange(this.waypoints);
  }

  setWaypointWeather(index, emoji) {
    if (index < 0 || index >= this.waypointMarkers.length) return;
    this.waypointWeather[index] = emoji;
    this.waypointMarkers[index].setIcon(this._createIcon(index));
    this._applyColorToMarker(this.waypointMarkers[index], index);
  }

  clearWaypointWeather() {
    this.waypointWeather = [];
    this._updateMarkerIcons();
  }

  /** Set gradient colors (one per waypoint) so icons match the elevation profile. */
  setWaypointColors(colors) {
    this.waypointColors = colors || [];
    this._updateMarkerIcons();
  }

  /**
   * Draw a single route with continuous gradient coloring
   * @param {Array} routeCoords
   * @param {boolean} isRoundTrip - if true, gradient goes teal→red→teal (symmetric)
   */
  drawRoute(routeCoords, isRoundTrip = false) {
    this.clearAllRoutes();
    this._drawGradientRoute(routeCoords, isRoundTrip);
    this.selectedRouteIndex = 0;
  }

  /**
   * Draw multiple alternative routes on the map
   * @param {Array} routes - Array of { coords, label, index, ... }
   * @param {number} selectedIdx - Index of the currently selected route
   * @param {boolean} isRoundTrip - if true, gradient is symmetric (teal→red→teal)
   */
  drawMultipleRoutes(routes, selectedIdx = 0, isRoundTrip = false) {
    this.clearAllRoutes();
    this.selectedRouteIndex = selectedIdx;
    this.isRoundTrip = isRoundTrip;
    this._redrawRoutes(routes, selectedIdx);
  }

  /**
   * Visually select a route among alternatives
   * @param {Array} routes - Current alternatives
   * @param {number} selectedIdx - Index to select
   * @param {boolean} triggeredByUI - If true, skip redraw if index unchanged (avoids double-draw)
   */
  selectRoute(routes, selectedIdx, triggeredByUI = false) {
    // Skip redundant redraw when triggered by UI after a map-click already updated things
    if (this.selectedRouteIndex === selectedIdx && triggeredByUI) return;

    this.selectedRouteIndex = selectedIdx;
    this._redrawRoutes(routes, selectedIdx);

    if (this.onRouteSelect && !triggeredByUI) {
      this.onRouteSelect(selectedIdx);
    }
  }

  /**
   * Internal: clear and redraw all route polylines for a given selection
   */
  _redrawRoutes(routes, selectedIdx) {
    this.routePolylines.forEach((pl) => this.map.removeLayer(pl));
    this.routePolylines = [];
    this.clearGradientRoute();

    // Draw alternative routes first (behind selected)
    for (const route of routes) {
      if (route.index === selectedIdx) continue;

      const color = ROUTE_COLORS[route.index % ROUTE_COLORS.length];
      const pl = L.polyline(route.coords, {
        color,
        weight: 3,
        opacity: ROUTE_ALT_OPACITY,
        smoothFactor: 1,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: '8 6',
        className: `route-line route-${route.index}`,
      }).addTo(this.map);

      pl._routeIndex = route.index;
      pl.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.selectRoute(routes, route.index);
      });
      pl.bindTooltip(route.label, {
        sticky: true,
        className: 'route-tooltip',
        direction: 'top',
        offset: [0, -10],
      });
      this._bindRouteHoverEvents(pl);
      this.routePolylines.push(pl);
    }

    // Draw selected route as continuous gradient on top
    const selectedRoute = routes.find((r) => r.index === selectedIdx);
    if (selectedRoute) {
      this._drawGradientRoute(selectedRoute.coords, this.isRoundTrip || false);
    }
  }

  /**
   * Draw the selected route as GRADIENT_CHUNKS small polylines colored by
   * position along the route (t=0 at start → t=1 at end).
   * @param {Array} routeCoords
   * @param {boolean} isRoundTrip - if true, gradient goes teal→red→teal (symmetric)
   */
  _drawGradientRoute(routeCoords, isRoundTrip = false) {
    this.clearGradientRoute();
    const N = routeCoords.length;
    if (N < 2) return;

    const chunks = Math.min(GRADIENT_CHUNKS, N - 1);
    const chunkSize = (N - 1) / chunks;

    for (let chunk = 0; chunk < chunks; chunk++) {
      const startI = Math.floor(chunk * chunkSize);
      const endI = Math.min(Math.floor((chunk + 1) * chunkSize), N - 1);
      if (endI <= startI) continue;

      const tLinear = startI / (N - 1);
      // For round-trip: mirror gradient at midpoint (0→1→0)
      const t = isRoundTrip ? 1 - Math.abs(2 * tLinear - 1) : tLinear;
      const color = interpolateRouteColor(t);
      const pl = L.polyline(routeCoords.slice(startI, endI + 1), {
        color,
        weight: 5,
        opacity: ROUTE_SELECTED_OPACITY,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(this.map);
      this._bindRouteHoverEvents(pl);
      this.gradientPolylines.push(pl);
    }
  }

  clearGradientRoute() {
    this.gradientPolylines.forEach((pl) => this.map.removeLayer(pl));
    this.gradientPolylines = [];
  }

  /**
   * Set km-interval intermediate markers (non-interactive, small icons)
   * @param {Array<{lat,lng,cumDistM}>} points
   */
  setIntermediateMarkers(points, totalDistM = 0) {
    this.clearIntermediateMarkers();
    points.forEach((pt) => {
      const km = (pt.cumDistM / 1000).toFixed(0);
      const tLinear = totalDistM > 0 ? Math.min(1, pt.cumDistM / totalDistM) : 0;
      const t = this.isRoundTrip ? 1 - Math.abs(2 * tLinear - 1) : tLinear;
      const color = interpolateRouteColor(t);
      const icon = L.divIcon({
        className: 'intermediate-point-icon',
        html: `<span>${km}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = L.marker([pt.lat, pt.lng], { icon, interactive: false }).addTo(this.map);
      // Override the CSS background with the gradient color
      const el = marker.getElement();
      if (el) el.style.background = color;
      this.intermediateMarkers.push(marker);
    });
  }

  clearIntermediateMarkers() {
    this.intermediateMarkers.forEach((m) => this.map.removeLayer(m));
    this.intermediateMarkers = [];
  }

  clearAllRoutes() {
    this.routePolylines.forEach((pl) => this.map.removeLayer(pl));
    this.routePolylines = [];
    this.selectedRouteIndex = 0;
    this.clearHoverMarker();
    this.clearIntermediateMarkers();
    this.clearGradientRoute();
  }

  // Keep clearRoute as alias
  clearRoute() {
    this.clearAllRoutes();
  }

  showHoverMarker(lat, lng, color = null) {
    const styleStr = color ? `background-color: ${color}; box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 8px ${color};` : '';
    const html = color ? `<div style="width:100%; height:100%; border-radius:50%; ${styleStr}"></div>` : '';
    if (!this.hoverMarker) {
      const icon = L.divIcon({
        className: color ? '' : 'elevation-hover-marker',
        html: html,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      this.hoverMarker = L.marker([lat, lng], { icon, interactive: false }).addTo(this.map);
    } else {
      this.hoverMarker.setLatLng([lat, lng]);
      if (color) {
        this.hoverMarker.setIcon(L.divIcon({
          className: '',
          html: html,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }));
      }
    }
  }

  clearHoverMarker() {
    if (this.hoverMarker) {
      this.map.removeLayer(this.hoverMarker);
      this.hoverMarker = null;
    }
  }

  fitToRoute() {
    const allPl = [...this.routePolylines, ...this.gradientPolylines];
    if (allPl.length > 0) {
      const bounds = L.latLngBounds([]);
      allPl.forEach((pl) => bounds.extend(pl.getBounds()));
      this.map.fitBounds(bounds, { padding: [50, 50] });
    } else if (this.waypoints.length > 0) {
      const bounds = L.latLngBounds(this.waypoints.map((w) => [w[0], w[1]]));
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  goToMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      },
      () => { }
    );
  }

  setWaypointsFromImport(coords) {
    this.clearWaypoints();
    coords.forEach(([lat, lng]) => this.addWaypoint(lat, lng));
    this.fitToRoute();
  }

  _createIcon(index) {
    const total = this.waypoints.length;
    let cls = '';
    if (index === 0 && total > 1) cls = 'start';
    else if (index === total - 1 && total > 1) cls = 'end';

    const weather = this.waypointWeather[index];
    const weatherHtml = weather ? `<div class="wp-weather-badge">${weather}</div>` : '';

    const size = cls ? 40 : 36;
    return L.divIcon({
      className: `custom-waypoint-icon ${cls}`,
      html: `${weatherHtml}<span>${index + 1}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  _updateMarkerIcons() {
    this.waypointMarkers.forEach((marker, i) => {
      marker.setIcon(this._createIcon(i));
      this._applyColorToMarker(marker, i);
    });
  }

  /** Apply the stored gradient color to a marker's DOM element. */
  _applyColorToMarker(marker, index) {
    const color = this.waypointColors[index];
    if (!color) return;
    const el = marker.getElement();
    if (el) {
      el.style.background = color;
      el.style.setProperty('box-shadow', `0 2px 8px rgba(0,0,0,0.4), 0 0 0 2px ${color}55`);
    }
  }

  _bindRouteHoverEvents(polyline) {
    polyline.on('mousemove', (e) => {
      if (this.onRouteHover) this.onRouteHover(e.latlng.lat, e.latlng.lng);
    });
    polyline.on('mouseout', () => {
      if (this.onRouteHover) this.onRouteHover(null, null);
    });
  }

  getCurrentLayerInfo() {
    const layer = this.tileLayers[this.currentLayerName];
    if (layer) {
      return {
        urlTemplate: layer._url,
        maxZoom: layer.options.maxZoom || 18,
      };
    }
    return null;
  }

  /** Highlight a waypoint marker by index (adds .is-selected class). */
  highlightWaypoint(wpIndex) {
    this.waypointMarkers.forEach(m => m.getElement()?.classList.remove('is-selected'));
    const m = this.waypointMarkers[wpIndex];
    if (m) m.getElement()?.classList.add('is-selected');
  }

  /** Remove all waypoint selection highlights. */
  clearWaypointHighlight() {
    this.waypointMarkers.forEach(m => m.getElement()?.classList.remove('is-selected'));
  }
}
