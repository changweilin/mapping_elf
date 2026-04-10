/**
 * Mapping Elf — Map Manager
 * Handles Leaflet map, layers, waypoints, multiple route polylines
 */
import L from 'leaflet';

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

// Colors for alternative routes (index 0 = selected, rest = alternatives)
const ROUTE_COLORS = ['#6ee7b7', '#60a5fa', '#f59e0b', '#f87171'];
const ROUTE_ALT_OPACITY = 0.4;
const ROUTE_SELECTED_OPACITY = 0.9;

export class MapManager {
  constructor(containerId, onWaypointChange) {
    this.onWaypointChange = onWaypointChange;
    this.onRouteSelect = null; // callback(index)
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = []; // Weather emoji per waypoint index
    this.routePolylines = []; // Array of polylines for alternatives
    this.selectedRouteIndex = 0;
    this.hoverMarker = null;
    this.currentLayerName = 'streets';
    this.intermediateMarkers = [];

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
      this.addWaypoint(e.latlng.lat, e.latlng.lng);
    });
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

    // Desktop: right-click / context menu
    marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      _enableDrag();
    });

    // Touch: long-press (500ms) enables drag mode
    let _longPressTimer = null;
    let _touchStartX = 0, _touchStartY = 0;
    marker.on('touchstart', (e) => {
      const t = e.originalEvent.touches[0];
      _touchStartX = t.clientX;
      _touchStartY = t.clientY;
      _longPressTimer = setTimeout(() => {
        if (!_dragModeActive) _enableDrag();
      }, 500);
    });
    marker.on('touchmove', (e) => {
      if (_longPressTimer) {
        const t = e.originalEvent.touches[0];
        const dx = t.clientX - _touchStartX;
        const dy = t.clientY - _touchStartY;
        if (dx * dx + dy * dy > 64) { // >8px moved → cancel long-press
          clearTimeout(_longPressTimer);
          _longPressTimer = null;
        }
      }
    });
    marker.on('touchend', () => {
      clearTimeout(_longPressTimer);
      _longPressTimer = null;
    });

    // Click/tap when drag mode active → cancel
    marker.on('click', (e) => {
      if (_dragModeActive) {
        L.DomEvent.stopPropagation(e);
        _disableDrag();
      }
    });

    marker.on('dragend', (e) => {
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
  }

  clearWaypointWeather() {
    this.waypointWeather = [];
    this.waypointMarkers.forEach((marker, i) => marker.setIcon(this._createIcon(i)));
  }

  /**
   * Draw a single route (backwards compatible)
   */
  drawRoute(routeCoords) {
    this.clearAllRoutes();
    const polyline = L.polyline(routeCoords, {
      color: ROUTE_COLORS[0],
      weight: 4,
      opacity: ROUTE_SELECTED_OPACITY,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);
    this.routePolylines = [polyline];
    this.selectedRouteIndex = 0;
  }

  /**
   * Draw multiple alternative routes on the map
   * @param {Array} routes - Array of { coords, label, index, ... }
   * @param {number} selectedIdx - Index of the currently selected route
   */
  drawMultipleRoutes(routes, selectedIdx = 0) {
    this.clearAllRoutes();
    this.selectedRouteIndex = selectedIdx;

    // Draw alternatives first (behind), then selected on top
    const ordered = routes
      .map((r, i) => ({ ...r, drawOrder: i === selectedIdx ? 999 : i }))
      .sort((a, b) => a.drawOrder - b.drawOrder);

    for (const route of ordered) {
      const isSelected = route.index === selectedIdx;
      const color = ROUTE_COLORS[route.index % ROUTE_COLORS.length];

      const polyline = L.polyline(route.coords, {
        color: color,
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? ROUTE_SELECTED_OPACITY : ROUTE_ALT_OPACITY,
        smoothFactor: 1,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: isSelected ? null : '8 6',
        className: `route-line route-${route.index}`,
      }).addTo(this.map);

      // Click on alternative route to select it
      polyline.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.selectRoute(routes, route.index);
      });

      // Tooltip on hover
      polyline.bindTooltip(route.label, {
        sticky: true,
        className: 'route-tooltip',
        direction: 'top',
        offset: [0, -10],
      });

      // Store reference with route index
      polyline._routeIndex = route.index;
      this.routePolylines.push(polyline);
    }
  }

  /**
   * Visually select a route among alternatives
   * @param {Array} routes - Current alternatives
   * @param {number} selectedIdx - Index to select
   * @param {boolean} triggeredByUI - If true, do not fire onRouteSelect to avoid recursion
   */
  selectRoute(routes, selectedIdx, triggeredByUI = false) {
    this.selectedRouteIndex = selectedIdx;

    // Update polyline styles
    this.routePolylines.forEach((pl) => {
      const isSelected = pl._routeIndex === selectedIdx;
      const color = ROUTE_COLORS[pl._routeIndex % ROUTE_COLORS.length];

      pl.setStyle({
        color: color,
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? ROUTE_SELECTED_OPACITY : ROUTE_ALT_OPACITY,
        dashArray: isSelected ? null : '8 6',
      });

      // Bring selected to front
      if (isSelected) pl.bringToFront();
    });

    // Callback to update UI, but only if NOT triggered by the UI already
    if (this.onRouteSelect && !triggeredByUI) {
      this.onRouteSelect(selectedIdx);
    }
  }

  /**
   * Set km-interval intermediate markers (non-interactive, small icons)
   * @param {Array<{lat,lng,cumDistM}>} points
   */
  setIntermediateMarkers(points) {
    this.clearIntermediateMarkers();
    points.forEach((pt) => {
      const km = (pt.cumDistM / 1000).toFixed(0);
      const icon = L.divIcon({
        className: 'intermediate-point-icon',
        html: `<span>${km}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = L.marker([pt.lat, pt.lng], { icon, interactive: false }).addTo(this.map);
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
  }

  // Keep clearRoute as alias
  clearRoute() {
    this.clearAllRoutes();
  }

  showHoverMarker(lat, lng) {
    if (!this.hoverMarker) {
      const icon = L.divIcon({
        className: 'elevation-hover-marker',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      this.hoverMarker = L.marker([lat, lng], { icon, interactive: false }).addTo(this.map);
    } else {
      this.hoverMarker.setLatLng([lat, lng]);
    }
  }

  clearHoverMarker() {
    if (this.hoverMarker) {
      this.map.removeLayer(this.hoverMarker);
      this.hoverMarker = null;
    }
  }

  fitToRoute() {
    if (this.routePolylines.length > 0) {
      const bounds = L.latLngBounds([]);
      this.routePolylines.forEach((pl) => bounds.extend(pl.getBounds()));
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
      () => {}
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
}
