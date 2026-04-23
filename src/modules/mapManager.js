/**
 * Mapping Elf — Map Manager
 * Handles Leaflet map, layers, waypoints, multiple route polylines
 */
import L from 'leaflet';
import { interpolateRouteColor, interpolateReturnColor, cumulativeDistances } from './utils.js';

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
    this.isFrozen = false; // Freeze map clicks and waypoint dragging
    this.onWaypointChange = onWaypointChange;
    this.onRouteSelect = null; // callback(index)
    this.onRouteHover = null; // callback(lat, lng) | callback(null, null)
    this.onWaypointSelect = null; // callback(wpIndex)
    this.onWeatherBadgeClick = null; // callback(wpIndex)
    this.isRoundTrip = false;
    this.turnaroundLatLng = null; // [lat,lng] of last forward waypoint for return-leg gradient split
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = []; // Weather emoji per waypoint index
    this.waypointColors = [];  // Gradient color strings per waypoint index
    this.waypointLabels = [];  // Custom labels for each waypoint index
    this.routePolylines = []; // Solid polylines for alternative routes
    this.gradientPolylines = []; // Gradient chunks for selected route
    this.selectedRouteIndex = 0;
    this.hoverMarker = null;
    this.currentLayerName = 'topo';
    this.intermediateMarkers = [];
    this.ignoreMapClick = false;
    this.dragLine = null;
    this.dragLine = null;
    this._dragWpIndex = undefined;
    this._weatherPopups = new Map(); // Leaflet popups for weather cards (colIdx -> popup)
    this._clickTimeout = null; // Global debunking for map/track clicks to avoid dual triggering with dblclick

    this.map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    this.tileLayers = {};
    for (const [name, config] of Object.entries(TILE_LAYERS)) {
      this.tileLayers[name] = L.tileLayer(config.url, config.options);
    }
    this.tileLayers.topo.addTo(this.map);

    this.map.on('click', (e) => {
      if (this.ignoreMapClick || this.isFrozen) return;
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      } else {
        this._clickTimeout = setTimeout(() => {
          this._clickTimeout = null;
          this.addWaypoint(e.latlng.lat, e.latlng.lng);
        }, 450);
      }
    });

    this.map.on('dblclick', (e) => {
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
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

  _findInsertionIndex(latlng) {
    if (this.waypoints.length < 2) return this.waypoints.length;
    let bestIndex = 1;
    let minDetour = Infinity;
    for (let i = 1; i < this.waypoints.length; i++) {
        const w1 = this.waypoints[i - 1];
        const w2 = this.waypoints[i];
        const d1 = L.latLng(w1[0], w1[1]).distanceTo(latlng);
        const d2 = L.latLng(w2[0], w2[1]).distanceTo(latlng);
        const d12 = L.latLng(w1[0], w1[1]).distanceTo(L.latLng(w2[0], w2[1]));
        const detour = d1 + d2 - d12;
        if (detour < minDetour) {
            minDetour = detour;
            bestIndex = i;
        }
    }
    return bestIndex;
  }

  switchLayer(layerName) {
    if (!this.tileLayers[layerName]) return;
    this.map.removeLayer(this.tileLayers[this.currentLayerName]);
    this.tileLayers[layerName].addTo(this.map);
    this.currentLayerName = layerName;
  }

  setFrozen(val) {
    this.isFrozen = val;
  }

  addWaypoint(lat, lng, insertIndex = null) {
    const idx = insertIndex !== null ? insertIndex : this.waypoints.length;
    this.waypoints.splice(idx, 0, [lat, lng]);
    this.waypointWeather.splice(idx, 0, null);
    this.waypointColors.splice(idx, 0, null);
    this.waypointLabels.splice(idx, 0, null);
    const icon = this._createIcon(idx);

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
      if (this.isFrozen || _isTouchActive || _longPressTimer !== null || _dragModeActive) return;
      _enableDrag();
    });

    // Desktop: left-button long-press (500ms) → manual drag
    let _mouseLPTimer = null;
    let _mouseStartX = 0, _mouseStartY = 0;
    marker.on('mousedown', (e) => {
      if (this.isFrozen || e.originalEvent.button !== 0 || _dragModeActive) return;
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

        this._startRubberBand(marker);

        const onMove = (ev) => {
          const latlng = this.map.mouseEventToLatLng(ev);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
        };
        const onUp = () => {
          _dragModeActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
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
      if (this.isFrozen || _dragModeActive) return;
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

    // Click/tap: cancel drag mode; on normal click → notify selection or weather badge
    marker.on('click', (e) => {
      if (_dragModeActive || _justDragged) {
        L.DomEvent.stopPropagation(e);
        if (_dragModeActive) _disableDrag();
        return;
      }
      // Detect click on weather badge
      const target = e.originalEvent?.target;
      if (target && target.closest && target.closest('.wp-weather-badge')) {
        L.DomEvent.stopPropagation(e);
        const idx = this.waypointMarkers.indexOf(marker);
        if (idx >= 0) {
          // waypoints need their colIdx for the weather card; main.js will provide a callback/helper
          // but for now we just find the column mapped to this waypoint.
          this.onWeatherBadgeClick?.(idx, false);
        }
        return;
      }
      const idx = this.waypointMarkers.indexOf(marker);
      if (idx >= 0) this.onWaypointSelect?.(idx);
    });

    // 綁定 Leaflet 內建拖曳功能 (Desktop 右鍵後觸發) 的事件
    marker.on('dragstart', () => {
      this._startRubberBand(marker);
    });
    marker.on('drag', (e) => {
      this._updateRubberBand(e.target.getLatLng());
    });

    marker.on('dragend', (e) => {
      this._blockMapClick();
      this._stopRubberBand();
      const pos = e.target.getLatLng();
      const idx = this.waypointMarkers.indexOf(marker);
      this.waypoints[idx] = [pos.lat, pos.lng];
      _disableDrag();
      this.onWaypointChange(this.waypoints);
    });

    this.waypointMarkers.splice(idx, 0, marker);
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

  setWaypointLabels(labels) {
    this.waypointLabels = labels || [];
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
  drawMultipleRoutes(routes, selectedIdx = 0, isRoundTrip = false, turnaroundLatLng = null) {
    this.clearAllRoutes();
    this.selectedRouteIndex = selectedIdx;
    this.isRoundTrip = isRoundTrip;
    this.turnaroundLatLng = turnaroundLatLng;
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
        L.DomEvent.stop(e);
        if (this.isFrozen) return;
        if (this._clickTimeout) {
          clearTimeout(this._clickTimeout);
          this._clickTimeout = null;
        } else {
          this._clickTimeout = setTimeout(() => {
            this._clickTimeout = null;
            this.selectRoute(routes, route.index);
          }, 450);
        }
      });
      pl.on('dblclick', (e) => {
        L.DomEvent.stop(e);
        if (this._clickTimeout) {
          clearTimeout(this._clickTimeout);
          this._clickTimeout = null;
        }
        pl.bringToFront();
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
      this._drawGradientRoute(selectedRoute.coords, this.isRoundTrip || false, this.turnaroundLatLng);
    }
  }

  /**
   * Draw the selected route as GRADIENT_CHUNKS small polylines colored by
   * position along the route (t=0 at start → t=1 at end).
   * @param {Array} routeCoords
   * @param {boolean} isRoundTrip - if true, gradient goes teal→red→teal (symmetric)
   */
  _drawGradientRoute(routeCoords, isRoundTrip = false, turnaroundLatLng = null) {
    this.clearGradientRoute();
    const N = routeCoords.length;
    if (N < 2) return;

    // Use distance-based interpolation for better visual matching with markers/chart
    const dists = cumulativeDistances(routeCoords);
    const totalD = dists[N - 1] || 1;

    // Find split distance closest to turnaround waypoint
    let splitD = -1;
    let splitIdx = -1;
    if (turnaroundLatLng && N > 2) {
      const [tlat, tlng] = turnaroundLatLng;
      let minSq = Infinity;
      for (let i = 1; i < N - 1; i++) {
        const dSq = (routeCoords[i][0] - tlat) ** 2 + (routeCoords[i][1] - tlng) ** 2;
        if (dSq < minSq) { minSq = dSq; splitIdx = i; }
      }
      if (splitIdx > 0) splitD = dists[splitIdx];
    }

    const chunks = Math.min(GRADIENT_CHUNKS, N - 1);
    const chunkSize = (N - 1) / chunks;

    for (let chunk = 0; chunk < chunks; chunk++) {
      const startI = Math.floor(chunk * chunkSize);
      const endI = Math.min(Math.floor((chunk + 1) * chunkSize), N - 1);
      if (endI <= startI) continue;

      if (splitIdx > startI && splitIdx < endI) {
        // Chunk straddles the split point. Subdivide it!
        const d1 = dists[startI];
        const t1 = splitD > 0 ? d1 / splitD : 0;
        const pl1 = L.polyline(routeCoords.slice(startI, splitIdx + 1), {
          color: interpolateRouteColor(t1),
          weight: 5,
          opacity: ROUTE_SELECTED_OPACITY,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(this.map);
        pl1._isReturn = false;
        this._bindRouteHoverEvents(pl1);
        this._bindGradientRouteEvents(pl1);
        this.gradientPolylines.push(pl1);

        const d2 = dists[splitIdx];
        const denom = totalD - splitD;
        const t2 = denom > 0 ? (d2 - splitD) / denom : 0;
        const pl2 = L.polyline(routeCoords.slice(splitIdx, endI + 1), {
          color: interpolateReturnColor(t2),
          weight: 5,
          opacity: ROUTE_SELECTED_OPACITY,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(this.map);
        pl2._isReturn = true;
        this._bindRouteHoverEvents(pl2);
        this._bindGradientRouteEvents(pl2);
        this.gradientPolylines.push(pl2);
        continue;
      }

      const d = dists[startI];
      let color;
      if (splitD > 0) {
        if (startI < splitIdx) {
          const t = d / splitD;
          color = interpolateRouteColor(t);
        } else {
          const denom = totalD - splitD;
          const t = denom > 0 ? (d - splitD) / denom : 0;
          color = interpolateReturnColor(t);
        }
      } else {
        const xFrac = d / totalD;
        const t = isRoundTrip ? (1 - Math.abs(2 * xFrac - 1)) : xFrac;
        color = interpolateRouteColor(t);
      }

      const pl = L.polyline(routeCoords.slice(startI, endI + 1), {
        color,
        weight: 5,
        opacity: ROUTE_SELECTED_OPACITY,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(this.map);
      
      const xFrac = dists[startI] / totalD;
      if (splitD > 0) {
        pl._isReturn = (startI >= splitIdx);
      } else {
        pl._isReturn = isRoundTrip && (xFrac >= 0.5);
      }

      this._bindRouteHoverEvents(pl);
      this._bindGradientRouteEvents(pl);
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
  setIntermediateMarkers(points, totalDistM = 0, turnaroundDistM = null) {
    this.clearIntermediateMarkers();
    points.forEach((pt) => {
      let color;
      if (turnaroundDistM && turnaroundDistM > 0 && totalDistM > turnaroundDistM) {
        if (pt.cumDistM <= turnaroundDistM) {
          const t = Math.max(0, Math.min(1, pt.cumDistM / turnaroundDistM));
          color = interpolateRouteColor(t);
        } else {
          const t = Math.max(0, Math.min(1, (pt.cumDistM - turnaroundDistM) / (totalDistM - turnaroundDistM)));
          color = interpolateReturnColor(t);
        }
      } else {
        const tLinear = totalDistM > 0 ? Math.min(1, pt.cumDistM / totalDistM) : 0;
        const t = this.isRoundTrip ? 1 - Math.abs(2 * tLinear - 1) : tLinear;
        color = interpolateRouteColor(t);
      }

      const weatherHtml = pt.weatherIcon ? `<div class="wp-weather-badge">${pt.weatherIcon}</div>` : '';
      const labelHtml = pt.label ? `<div class="marker-external-label">${pt.label}</div>` : '';

      const icon = L.divIcon({
        className: 'intermediate-point-icon',
        html: `<div class="intermediate-point-inner" style="background: ${color};">${weatherHtml}</div>${labelHtml}`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker([pt.lat, pt.lng], { icon, interactive: true }).addTo(this.map);
      marker._colIdx = pt.colIdx;

      marker.on('click', (e) => {
        // Detect click on weather badge
        const target = e.originalEvent?.target;
        if (target && target.closest && target.closest('.wp-weather-badge')) {
          L.DomEvent.stopPropagation(e);
          if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
          return;
        }

        if (this.onIntermediateSelect) this.onIntermediateSelect(pt.lat, pt.lng);
      });
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
    // Sync Leaflet's cached map size with the current DOM dimensions.
    // The map container can be resized by CSS (e.g. bottom panel drag) without
    // Leaflet knowing — invalidateSize must be called before fitBounds so the
    // padding calculations use the correct canvas size.
    this.map.invalidateSize({ animate: false });

    // Account for the side panel (right) and bottom weather panel overlaying the map
    const panelEl = document.querySelector('.side-panel.open');
    const rightPad = panelEl ? panelEl.offsetWidth + 50 : 50;
    // Bottom panel overlays the map on mobile (map-container bottom: 0), but on
    // desktop the map container is already clipped above it — avoid double-counting.
    const mapContainer = document.querySelector('.map-container');
    const mapBottomOffset = mapContainer ? parseInt(getComputedStyle(mapContainer).bottom) || 0 : 0;
    const bottomPanelEl = document.getElementById('bottom-panel');
    const bottomPad = (mapBottomOffset === 0 && bottomPanelEl) ? bottomPanelEl.offsetHeight + 50 : 50;
    const fitOpts = {
      paddingTopLeft: [50, 50],
      paddingBottomRight: [rightPad, bottomPad],
    };

    const allPl = [...this.routePolylines, ...this.gradientPolylines];
    if (allPl.length > 0) {
      const bounds = L.latLngBounds([]);
      allPl.forEach((pl) => bounds.extend(pl.getBounds()));
      this.map.fitBounds(bounds, fitOpts);
    } else if (this.waypoints.length > 0) {
      const bounds = L.latLngBounds(this.waypoints.map((w) => [w[0], w[1]]));
      this.map.fitBounds(bounds, fitOpts);
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
    // Suppress per-waypoint callbacks — fire once at the end to avoid
    // repeated route recalculations and weather panel re-renders during import.
    const cb = this.onWaypointChange;
    this.onWaypointChange = () => { };
    this.clearWaypoints();
    coords.forEach(([lat, lng]) => this.addWaypoint(lat, lng));
    this.onWaypointChange = cb;
    this.fitToRoute();
    cb(this.waypoints);
  }

  _createIcon(index) {
    const total = this.waypoints.length;
    let cls = '';
    if (index === 0 && total > 1) cls = 'start';
    else if (index === total - 1 && total > 1) cls = 'end';

    const weather = this.waypointWeather[index];
    const weatherHtml = weather ? `<div class="wp-weather-badge">${weather}</div>` : '';

    const size = cls ? 40 : 36;
    const labelText = this.waypointLabels[index];
    const externalLabel = labelText ? `<div class="marker-external-label">${labelText}</div>` : '';

    return L.divIcon({
      className: `custom-waypoint-icon ${cls}`,
      html: `<div class="wp-icon-inner">${weatherHtml}<span>${index + 1}</span></div>${externalLabel}`,
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
      const inner = el.querySelector('.wp-icon-inner');
      if (inner) {
        inner.style.background = color;
        inner.style.setProperty('box-shadow', `0 2px 8px rgba(0,0,0,0.4), 0 0 0 2px ${color}55`);
      }
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

  _bindGradientRouteEvents(polyline) {
    polyline.on('click', (e) => {
      L.DomEvent.stop(e);
      if (this.isFrozen) return;
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      } else {
        this._clickTimeout = setTimeout(() => {
          this._clickTimeout = null;
          const insertIdx = this._findInsertionIndex(e.latlng);
          this.addWaypoint(e.latlng.lat, e.latlng.lng, insertIdx);
        }, 450);
      }
    });

    polyline.on('dblclick', (e) => {
      L.DomEvent.stop(e);
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
      // Toggle logic for round trips: switch between outbound and return legs
      const isReturn = polyline._isReturn;
      if (isReturn !== undefined) {
        // If we clicked on return leg, bring outbound to front; and vice-versa
        this.gradientPolylines.filter(pl => pl._isReturn === !isReturn).forEach(pl => pl.bringToFront());
      } else {
        this.gradientPolylines.forEach(gpl => gpl.bringToFront());
      }
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

  /**
   * Open a weather card popup attached to a marker.
   * Multiple popups can coexist.
   * @param {number} colIdx - weather column index
   * @param {string} htmlContent - full inner HTML for the popup
   * @param {function} onReady - callback(wrapper) fired when popup is added to DOM
   * @param {boolean} isIntermediate - if true, attach to intermediate markers
   */
  openWeatherPopup(colIdx, htmlContent, onReady, isIntermediate = false, waypointIndex = -1) {
    const marker = isIntermediate 
      ? this.intermediateMarkers.find(m => m.options.colIdx === colIdx) // We'll need to store colIdx on marker options
      : this.waypointMarkers[waypointIndex >= 0 ? waypointIndex : colIdx]; // fallback for legacy logic
    
    // Better: let the caller provide the marker or latlng. 
    // But since we want to attach to the marker, let's find it.
    let targetMarker = null;
    if (isIntermediate) {
      // Find intermediate marker by some property? 
      // I'll update setIntermediateMarkers to store colIdx on the marker.
      targetMarker = this.intermediateMarkers.find(m => m._colIdx === colIdx);
    } else {
      targetMarker = this.waypointMarkers[waypointIndex >= 0 ? waypointIndex : colIdx];
    }
    
    if (!targetMarker) return;

    // If already open for this index, update it instead of recreating (prevents flashing)
    let popup = this._weatherPopups.get(colIdx);
    if (!popup) {
      popup = L.popup({
        className: 'weather-popup',
        closeButton: false,
        closeOnClick: false,
        autoClose: false,
        autoPan: true,
        autoPanPaddingTopLeft: [20, 60],
        autoPanPaddingBottomRight: [20, 20],
        offset: isIntermediate ? [0, -12] : [0, -24],
        maxWidth: 320,
        minWidth: 200,
      });
      this._weatherPopups.set(colIdx, popup);
    }

    popup
      .setLatLng(targetMarker.getLatLng())
      .setContent(htmlContent)
      .openOn(this.map);

    // Prevent Leaflet from swallowing click events inside the popup
    const wrapper = popup.getElement();
    if (wrapper) {
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);
    }

    // Call onReady callback so event handlers can be bound
    if (onReady) onReady(wrapper);
  }

  /**
   * Close a specific weather card popup or all of them.
   * @param {number} colIdx - if undefined, closes ALL popups
   */
  closeWeatherPopup(colIdx) {
    if (colIdx !== undefined) {
      const popup = this._weatherPopups.get(colIdx);
      if (popup) {
        this.map.closePopup(popup);
        this._weatherPopups.delete(colIdx);
      }
    } else {
      this._weatherPopups.forEach(p => this.map.closePopup(p));
      this._weatherPopups.clear();
    }
  }

  /** Check if a specific weather popup is currently open. */
  isWeatherPopupOpen(colIdx) {
    if (colIdx === undefined) return this._weatherPopups.size > 0;
    const popup = this._weatherPopups.get(colIdx);
    return !!popup && this.map.hasLayer(popup);
  }
}
