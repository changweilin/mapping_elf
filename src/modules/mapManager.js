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
    this.waypointMetadata = []; // Arbitrary metadata (ele, time, fileOrder) per waypoint index
    this.routePolylines = []; // Solid polylines for alternative routes
    this.gradientPolylines = []; // Gradient chunks for selected route
    this.legStackOrder = []; // Route leg IDs ordered bottom -> top for overlapping-layer cycling
    this.legRank = new Map(); // legId -> current stack rank
    this.selectedRouteIndex = 0;
    this.hoverMarker = null;
    this.currentLayerName = 'topo';
    this.intermediateMarkers = [];
    this.returnWaypointMarkers = []; // Markers for round-trip return waypoints (same shape as outbound, dashed border)
    this.stackedWaypointFlags = []; // Per-waypoint flag: outbound marker shares lat/lng with a return marker
    this.waypointLayerSwapped = []; // true if outbound is on top of return at this index
    this.ignoreMapClick = false;
    this.dragLine = null;
    this.dragLine = null;
    this._dragWpIndex = undefined;
    this._weatherPopups = new Map(); // Leaflet popups for weather cards (colIdx -> popup)
    this._clickTimeout = null; // Global debunking for map/track clicks to avoid dual triggering with dblclick
    this._waypointClickTimeout = null; // Delay waypoint click selection so dblclick can cancel it first
    // Map cursor — placed by GPS button (goToMyLocation). Long-press / click
    // on the cursor opens an action menu (set as waypoint / copy coords / weather).
    this._mapCursor = null;
    this._mapCursorLatLng = null;
    this._mapCursorMenuPopup = null;
    this._cursorWeatherPopup = null; // Ad-hoc weather card anchored at the cursor (independent of weatherPoints)
    this.onMapCursorAction = null; // callback(action, lat, lng)

    // Selection/Highlight state tracking
    this.highlightedWpIndex = -1;
    this.highlightedIsReturn = false;

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
        }, 300);
      }
    });

    this.map.on('dblclick', (e) => {
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
    });

    // Prevent waypoint creation on map pan/movement
    this.map.on('movestart', () => {
      this.ignoreMapClick = true;
    });
    this.map.on('moveend', () => {
      this._blockMapClick();
    });

    // Prevent waypoint creation on long-press ( > 500ms )
    let mapPressStartTime = 0;
    const handlePressStart = () => { mapPressStartTime = Date.now(); };
    const handlePressEnd = () => {
      if (Date.now() - mapPressStartTime > 500) {
        this._blockMapClick();
      }
    };

    this.map.on('mousedown', handlePressStart);
    this.map.on('touchstart', handlePressStart);
    this.map.on('mouseup', handlePressEnd);
    this.map.on('touchend', handlePressEnd);

    // Context menu on map (often triggered by long-press on mobile) should also block waypoint creation
    this.map.on('contextmenu', () => {
      this._blockMapClick();
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
    this.showTrashZone('map');
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

  ensureTrashZone() {
    if (this.trashZoneEl) return this.trashZoneEl;
    const el = document.createElement('div');
    el.className = 'waypoint-trash-zone hidden';
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">' +
      '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>' +
      '</svg>' +
      '<span class="waypoint-trash-label">拖曳至此刪除</span>';
    document.body.appendChild(el);
    this.trashZoneEl = el;
    return el;
  }

  showTrashZone(type = 'map') {
    const el = this.ensureTrashZone();
    el.classList.remove('hidden', 'is-hover', 'is-map-drag', 'is-list-drag', 'is-table-drag');
    // Clear inline positioning from a previous 'table' show
    el.style.top = '';
    el.style.left = '';
    el.style.right = '';
    el.style.width = '';
    el.style.height = '';
    if (type === 'map') {
      el.classList.add('is-map-drag');
    } else if (type === 'list') {
      el.classList.add('is-list-drag');
    } else if (type === 'table') {
      el.classList.add('is-table-drag');
      this._positionTrashZoneTable();
    }
  }

  // Anchor the trash zone to the top of #bottom-panel (the divider line) so its
  // upper edge never crosses above. Height fits inside the panel — important
  // because the elevation chart can be expanded or collapsed.
  _positionTrashZoneTable() {
    const bp = document.getElementById('bottom-panel');
    if (!bp || !this.trashZoneEl) return;
    const rect = bp.getBoundingClientRect();
    // Cap height to the panel's own height so the bottom edge never extends
    // below the panel (which would push it off-screen on a fully collapsed
    // panel). Min 18px keeps it minimally visible.
    const height = Math.max(18, Math.min(72, rect.height - 2));
    this.trashZoneEl.style.top = `${rect.top}px`;
    this.trashZoneEl.style.left = '0';
    this.trashZoneEl.style.right = '0';
    this.trashZoneEl.style.width = '100%';
    this.trashZoneEl.style.height = `${height}px`;
  }

  hideTrashZone() {
    if (!this.trashZoneEl) return;
    this.trashZoneEl.classList.add('hidden');
    this.trashZoneEl.classList.remove('is-hover');
  }

  isOverTrashZone(clientX, clientY) {
    if (clientX == null || clientY == null) return false;
    if (!this.trashZoneEl || this.trashZoneEl.classList.contains('hidden')) return false;
    const rect = this.trashZoneEl.getBoundingClientRect();
    // Use rectangular bounds check with a small buffer
    return (
      clientX >= rect.left - 10 &&
      clientX <= rect.right + 10 &&
      clientY >= rect.top - 10 &&
      clientY <= rect.bottom + 10
    );
  }

  updateTrashZoneHover(clientX, clientY) {
    const isOver = this.isOverTrashZone(clientX, clientY);
    if (this.trashZoneEl) this.trashZoneEl.classList.toggle('is-hover', isOver);
    return isOver;
  }

  // ===== Map cursor (placed by GPS button — not a waypoint) =====

  setMapCursor(lat, lng) {
    this._mapCursorLatLng = [lat, lng];
    this._closeMapCursorMenu();
    this.closeCursorWeatherPopup();
    if (!this._mapCursor) {
      const icon = this._createMapCursorIcon();
      this._mapCursor = L.marker([lat, lng], {
        icon,
        interactive: true,
        keyboard: false,
        zIndexOffset: 800,
      }).addTo(this.map);
      this._attachMapCursorEvents(this._mapCursor);
    } else {
      this._mapCursor.setLatLng([lat, lng]);
    }
  }

  clearMapCursor() {
    this._closeMapCursorMenu();
    this.closeCursorWeatherPopup();
    if (this._mapCursor) {
      this.map.removeLayer(this._mapCursor);
      this._mapCursor = null;
    }
    this._mapCursorLatLng = null;
  }

  /**
   * Open an ad-hoc weather card popup anchored at the GPS cursor's location.
   * Independent of `_weatherPopups` (which keys by weatherPoints colIdx).
   */
  openCursorWeatherPopup(htmlContent, onReady) {
    if (!this._mapCursor || !this._mapCursorLatLng) return null;
    if (!this._cursorWeatherPopup) {
      this._cursorWeatherPopup = L.popup({
        className: 'weather-popup cursor-weather-popup',
        closeButton: false,
        closeOnClick: false,
        autoClose: false,
        autoPan: true,
        autoPanPaddingTopLeft: [20, 60],
        autoPanPaddingBottomRight: [20, 20],
        offset: [0, -28],
        maxWidth: 320,
        minWidth: 200,
      });
    }
    this._cursorWeatherPopup
      .setLatLng(this._mapCursorLatLng)
      .setContent(htmlContent)
      .openOn(this.map);

    const wrapper = this._cursorWeatherPopup.getElement();
    if (wrapper) {
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);
    }
    if (onReady) onReady(wrapper);
    return wrapper;
  }

  closeCursorWeatherPopup() {
    if (this._cursorWeatherPopup) {
      this.map.closePopup(this._cursorWeatherPopup);
      this._cursorWeatherPopup = null;
    }
  }

  isCursorWeatherPopupOpen() {
    return !!(this._cursorWeatherPopup && this._cursorWeatherPopup.isOpen?.());
  }

  _createMapCursorIcon() {
    return L.divIcon({
      className: 'map-cursor-icon',
      html:
        '<div class="map-cursor-pulse"></div>' +
        '<div class="map-cursor-pin">' +
        '<svg viewBox="0 0 24 24" width="36" height="36">' +
        '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor"/>' +
        '<circle cx="12" cy="9" r="3" fill="rgba(255,255,255,0.9)"/>' +
        '</svg>' +
        '</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });
  }

  _attachMapCursorEvents(marker) {
    let lpTimer = null;
    let touchStartX = 0, touchStartY = 0;
    let mouseStartX = 0, mouseStartY = 0;

    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      this._openMapCursorMenu();
    });

    marker.on('mousedown', (e) => {
      if (e.originalEvent.button !== 0) return;
      L.DomEvent.stopPropagation(e);
      mouseStartX = e.originalEvent.clientX;
      mouseStartY = e.originalEvent.clientY;
      const cancel = () => {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', cancel);
      };
      const onMove = (ev) => {
        const dx = ev.clientX - mouseStartX, dy = ev.clientY - mouseStartY;
        if (dx * dx + dy * dy > 64) cancel();
      };
      lpTimer = setTimeout(() => {
        lpTimer = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', cancel);
        if (navigator.vibrate) navigator.vibrate(40);
        this._openMapCursorMenu();
      }, 500);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', cancel);
    });

    marker.on('touchstart', (e) => {
      const t = e.originalEvent.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        if (navigator.vibrate) navigator.vibrate(40);
        this._openMapCursorMenu();
      }, 500);
    });
    marker.on('touchmove', (e) => {
      if (!lpTimer) return;
      const t = e.originalEvent.touches[0];
      const dx = t.clientX - touchStartX, dy = t.clientY - touchStartY;
      if (dx * dx + dy * dy > 64) {
        clearTimeout(lpTimer); lpTimer = null;
      }
    });
    marker.on('touchend', () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    });
    marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      this._openMapCursorMenu();
    });
  }

  _openMapCursorMenu() {
    if (!this._mapCursor || !this._mapCursorLatLng) return;
    const [lat, lng] = this._mapCursorLatLng;
    const latStr = lat.toFixed(5);
    const lngStr = lng.toFixed(5);

    const html =
      '<div class="map-cursor-menu">' +
      `<div class="map-cursor-coords clickable-coords" data-coords="${latStr}, ${lngStr}" title="點擊複製座標">${latStr}, ${lngStr}</div>` +
      '<button class="cursor-menu-btn" data-action="waypoint">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/>' +
      '</svg>' +
      '<span>設為航點</span>' +
      '</button>' +
      '<button class="cursor-menu-btn" data-action="weather">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M19.36 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.64-4.96z" fill="currentColor"/>' +
      '</svg>' +
      '<span>開啟天氣卡</span>' +
      '</button>' +
      '<button class="cursor-menu-btn" data-action="windy">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/>' +
      '</svg>' +
      '<span>開啟 Windy</span>' +
      '</button>' +
      '<button class="cursor-menu-btn" data-action="clear">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zM11 17H9v-8h2v8zm4 0h-2v-8h2v8z" fill="currentColor"/>' +
      '</svg>' +
      '<span>清除 GPS 游標</span>' +
      '</button>' +
      '<button class="cursor-menu-btn cursor-menu-cancel" data-action="dismiss">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>' +
      '</svg>' +
      '<span>關閉選單</span>' +
      '</button>' +
      '</div>';

    this._closeMapCursorMenu();
    const popup = L.popup({
      className: 'map-cursor-popup',
      closeButton: false,
      closeOnClick: true,
      autoClose: true,
      autoPan: true,
      offset: [0, -20],
      maxWidth: 220,
      minWidth: 180,
    })
      .setLatLng([lat, lng])
      .setContent(html)
      .openOn(this.map);

    this._mapCursorMenuPopup = popup;

    const wrapper = popup.getElement();
    if (!wrapper) return;
    L.DomEvent.disableClickPropagation(wrapper);
    L.DomEvent.disableScrollPropagation(wrapper);

    wrapper.querySelectorAll('.cursor-menu-btn, .clickable-coords').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.dataset.action || (btn.classList.contains('clickable-coords') ? 'copy' : null);
        if (!action) return;
        this._closeMapCursorMenu();
        if (action === 'dismiss') {
          // Just close the menu — keep the cursor on the map.
          return;
        }
        if (this.onMapCursorAction) {
          this.onMapCursorAction(action, lat, lng);
        }
        if (action === 'waypoint') {
          this.clearMapCursor();
        }
      });
    });
  }

  _closeMapCursorMenu() {
    if (this._mapCursorMenuPopup) {
      this.map.closePopup(this._mapCursorMenuPopup);
      this._mapCursorMenuPopup = null;
    }
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
    this.waypointLayerSwapped.splice(idx, 0, true);
    this.waypointWeather.splice(idx, 0, null);
    this.waypointColors.splice(idx, 0, null);
    this.waypointLabels.splice(idx, 0, null);
    this.waypointMetadata.splice(idx, 0, {});
    const icon = this._createIcon(idx);

    const marker = L.marker([lat, lng], {
      icon,
      draggable: false,
    }).addTo(this.map);
    marker._wpIndex = idx;
    marker._stackOrderBias = idx;

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
        let layerToggledByLongPress = false;
        let manualDragMoved = false;

        // Long-press on overlapping waypoint toggles display level independently of track.
        // Selection is applied on release so the highlight does not appear while
        // the pointer/finger is still held down.
        const wpIdx = this.waypointMarkers.indexOf(marker);
        if (wpIdx >= 0 && this.stackedWaypointFlags?.[wpIdx]) {
          this._toggleWaypointLayer(wpIdx, { select: false });
          layerToggledByLongPress = true;
        }

        _dragModeActive = true;
        _justDragged = true; // Prevent subsequent click from triggering redundant highlight
        marker.getElement()?.classList.add('is-dragging');
        if (navigator.vibrate) navigator.vibrate(40);
        this.map.dragging.disable();

        this._startRubberBand(marker);

        const onMove = (ev) => {
          manualDragMoved = true;
          const latlng = this.map.mouseEventToLatLng(ev);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
          this.updateTrashZoneHover(ev.clientX, ev.clientY);
        };
        const onUp = (ev) => {
          const isOverTrash = this.isOverTrashZone(ev?.clientX, ev?.clientY);
          _dragModeActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this.hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          this.map.dragging.enable();
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const idx = this.waypointMarkers.indexOf(marker);
          if (layerToggledByLongPress && !manualDragMoved) {
            this._deferTopWaypointLayerHighlight(idx);
            return;
          }
          const pos = marker.getLatLng();
          if (idx >= 0) {
            if (isOverTrash) {
              if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
              this.removeWaypoint(idx);
            } else {
              this.waypoints[idx] = [pos.lat, pos.lng];
              this.onWaypointChange(this.waypoints);
              // Post-drag highlight (on release)
              this.onWaypointSelect?.(idx, false);
            }
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
        let layerToggledByLongPress = false;
        let manualDragMoved = false;

        // Long-press on overlapping waypoint toggles display level independently of track.
        // Selection is applied on release so the highlight does not appear while
        // the pointer/finger is still held down.
        const wpIdx = this.waypointMarkers.indexOf(marker);
        if (wpIdx >= 0 && this.stackedWaypointFlags?.[wpIdx]) {
          this._toggleWaypointLayer(wpIdx, { select: false });
          layerToggledByLongPress = true;
        }

        _dragModeActive = true;
        _justDragged = true; // Prevent subsequent click from triggering redundant highlight
        marker.getElement()?.classList.add('is-dragging');
        if (navigator.vibrate) navigator.vibrate(40);
        this.map.dragging.disable();

        this._startRubberBand(marker);

        let lastTouchClientX = null, lastTouchClientY = null;

        const onTouchMove = (ev) => {
          ev.preventDefault();
          manualDragMoved = true;
          const t = ev.touches[0];
          lastTouchClientX = t.clientX;
          lastTouchClientY = t.clientY;
          // 在手機版加入 Y 軸負偏移(-40px)，讓圖標浮在手指上方避免被遮擋
          const rect = this.map.getContainer().getBoundingClientRect();
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top - 40;
          const latlng = this.map.containerPointToLatLng([x, y]);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
          this.updateTrashZoneHover(t.clientX, t.clientY);
        };
        const onTouchEnd = (ev) => {
          const ct = ev?.changedTouches?.[0];
          const cx = ct?.clientX ?? lastTouchClientX;
          const cy = ct?.clientY ?? lastTouchClientY;
          const isOverTrash = this.isOverTrashZone(cx, cy);
          _dragModeActive = false;
          _isTouchActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this.hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          this.map.dragging.enable();
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
          const idx = this.waypointMarkers.indexOf(marker);
          if (layerToggledByLongPress && !manualDragMoved) {
            this._deferTopWaypointLayerHighlight(idx);
            return;
          }
          const pos = marker.getLatLng();
          if (idx >= 0) {
            if (isOverTrash) {
              if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
              this.removeWaypoint(idx);
            } else {
              this.waypoints[idx] = [pos.lat, pos.lng];
              this.onWaypointChange(this.waypoints);
              // Post-drag highlight (on release)
              this.onWaypointSelect?.(idx, false);
            }
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
      if (idx >= 0) {
        // Requirement 1: Toggle highlight on single click
        this._scheduleWaypointSelect(idx, false, true);
      }
    });

    // Double-click on marker: highlight and center
    marker.on('dblclick', (e) => {
      L.DomEvent.stopPropagation(e);
      this._clearWaypointClickTimeout();
      const idx = this.waypointMarkers.indexOf(marker);
      if (idx >= 0) {
        if (this.stackedWaypointFlags?.[idx]) {
          this._toggleWaypointLayer(idx, { select: false });
          this._deferTopWaypointLayerHighlight(idx);
        } else {
          this._deferWaypointSelect(idx, false, true);
        }
      }
    });

    // 綁定 Leaflet 內建拖曳功能 (Desktop 右鍵後觸發) 的事件
    marker.on('dragstart', () => {
      this._startRubberBand(marker);
    });
    marker.on('drag', (e) => {
      this._updateRubberBand(e.target.getLatLng());
      const oe = e.originalEvent;
      const cx = oe?.clientX ?? oe?.touches?.[0]?.clientX;
      const cy = oe?.clientY ?? oe?.touches?.[0]?.clientY;
      if (cx != null && cy != null) {
        this.updateTrashZoneHover(cx, cy);
      } else {
        // Fallback: derive screen coords from marker's lat/lng
        const cp = this.map.latLngToContainerPoint(e.target.getLatLng());
        const r = this.map.getContainer().getBoundingClientRect();
        this.updateTrashZoneHover(cp.x + r.left, cp.y + r.top);
      }
    });

    marker.on('dragend', (e) => {
      const oe = e.originalEvent;
      let dropX = oe?.clientX ?? oe?.changedTouches?.[0]?.clientX;
      let dropY = oe?.clientY ?? oe?.changedTouches?.[0]?.clientY;
      if (dropX == null || dropY == null) {
        const cp = this.map.latLngToContainerPoint(e.target.getLatLng());
        const r = this.map.getContainer().getBoundingClientRect();
        dropX = cp.x + r.left;
        dropY = cp.y + r.top;
      }
      const isOverTrash = this.isOverTrashZone(dropX, dropY);
      this._blockMapClick();
      this._stopRubberBand();
      this.hideTrashZone();
      const pos = e.target.getLatLng();
      const idx = this.waypointMarkers.indexOf(marker);
      _disableDrag();
      if (idx >= 0) {
        if (isOverTrash) {
          if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
          this.removeWaypoint(idx);
        } else {
          this.waypoints[idx] = [pos.lat, pos.lng];
          this.onWaypointChange(this.waypoints);
        }
      }
    });

    this.waypointMarkers.splice(idx, 0, marker);
    this._updateMarkerIcons();
    this.onWaypointChange(this.waypoints);
  }

  removeWaypoint(index) {
    this.map.removeLayer(this.waypointMarkers[index]);
    this.waypoints.splice(index, 1);
    this.waypointLayerSwapped.splice(index, 1);
    this.waypointMarkers.splice(index, 1);
    this.waypointWeather.splice(index, 1);
    this.waypointColors.splice(index, 1);
    this.waypointLabels.splice(index, 1);
    this.waypointMetadata.splice(index, 1);
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

    const tempLabel = this.waypointLabels[index];
    this.waypointLabels[index] = this.waypointLabels[newIndex];
    this.waypointLabels[newIndex] = tempLabel;

    const tempWeather = this.waypointWeather[index];
    this.waypointWeather[index] = this.waypointWeather[newIndex];
    this.waypointWeather[newIndex] = tempWeather;

    const tempColor = this.waypointColors[index];
    this.waypointColors[index] = this.waypointColors[newIndex];
    this.waypointColors[newIndex] = tempColor;

    const tempMetadata = this.waypointMetadata[index];
    this.waypointMetadata[index] = this.waypointMetadata[newIndex];
    this.waypointMetadata[newIndex] = tempMetadata;

    const tempSwapped = this.waypointLayerSwapped[index];
    this.waypointLayerSwapped[index] = this.waypointLayerSwapped[newIndex];
    this.waypointLayerSwapped[newIndex] = tempSwapped;

    this._updateMarkerIcons();
    this.onWaypointChange(this.waypoints);
  }

  moveWaypointTo(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.waypoints.length) return;
    const clampedTo = Math.max(0, Math.min(this.waypoints.length - 1, toIndex));
    if (fromIndex === clampedTo) return;
    const total = this.waypoints.length;

    const moveInArray = (arr) => {
      arr.length = total;
      const [item] = arr.splice(fromIndex, 1);
      arr.splice(clampedTo, 0, item);
    };

    moveInArray(this.waypoints);
    moveInArray(this.waypointMarkers);
    moveInArray(this.waypointWeather);
    moveInArray(this.waypointColors);
    moveInArray(this.waypointLabels);
    moveInArray(this.waypointMetadata);
    moveInArray(this.waypointLayerSwapped);

    this._updateMarkerIcons();
    this.onWaypointChange(this.waypoints);
  }

  clearWaypoints() {
    this.waypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = [];
    this.waypointColors = [];
    this.waypointLabels = [];
    this.waypointMetadata = [];
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

  setWaypointMetadata(index, meta) {
    if (index >= 0 && index < this.waypointMetadata.length) {
      this.waypointMetadata[index] = meta || {};
    }
  }

  getWaypointMetadata(index) {
    return this.waypointMetadata[index] || {};
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
          }, 300);
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

    // Compute leg IDs across the whole route — used for cycling overlapping
    // passes via dblclick. Segments are strictly defined as waypoint-to-waypoint.
    const legIds = this._computeLegIds(routeCoords, dists, isRoundTrip);
    this._currentRouteLegIds = legIds;
    this._currentRouteCum = dists;
    this._syncAllMarkerLegIds();

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
        pl1._legId = legIds[Math.floor((startI + splitIdx) / 2)] ?? 0;
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
        pl2._legId = legIds[Math.floor((splitIdx + endI) / 2)] ?? 0;
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
      pl._legId = legIds[Math.floor((startI + endI) / 2)] ?? 0;

      this._bindRouteHoverEvents(pl);
      this._bindGradientRouteEvents(pl);
      this.gradientPolylines.push(pl);
    }

    this._initializeLegStackOrder();
    this._applyRouteLegOrder();
    this._applyMarkerLegOrder();
  }

  _bringOutboundRouteSegmentsToFront() {
    this.gradientPolylines
      .filter((pl) => pl._isReturn === false)
      .forEach((pl) => pl.bringToFront());
  }

  _rebuildLegRank() {
    this.legRank = new Map(this.legStackOrder.map((legId, i) => [legId, i]));
  }

  _initializeLegStackOrder() {
    const seen = new Set();
    const routeOrder = [];
    const info = new Map();

    this.gradientPolylines.forEach((pl, order) => {
      const legId = pl._legId;
      if (legId === undefined) return;
      if (!seen.has(legId)) {
        seen.add(legId);
        routeOrder.push(legId);
      }
      const meta = info.get(legId) || { firstOrder: order, hasOutbound: false, hasReturn: false };
      meta.firstOrder = Math.min(meta.firstOrder, order);
      if (pl._isReturn === true) meta.hasReturn = true;
      if (pl._isReturn === false) meta.hasOutbound = true;
      info.set(legId, meta);
    });

    const hasReturnLegs = routeOrder.some((legId) => info.get(legId)?.hasReturn);
    if (hasReturnLegs) {
      const returnOnly = routeOrder.filter((legId) => {
        const meta = info.get(legId);
        return meta?.hasReturn && !meta?.hasOutbound;
      });
      const outboundOrMixed = routeOrder.filter((legId) => !returnOnly.includes(legId));
      this.legStackOrder = [...returnOnly, ...outboundOrMixed];
    } else {
      this.legStackOrder = routeOrder;
    }
    this._rebuildLegRank();
  }

  _ensureLegStackOrder() {
    const routeLegs = [];
    const seen = new Set();
    this.gradientPolylines.forEach((pl) => {
      if (pl._legId === undefined || seen.has(pl._legId)) return;
      seen.add(pl._legId);
      routeLegs.push(pl._legId);
    });

    const routeSet = new Set(routeLegs);
    this.legStackOrder = this.legStackOrder.filter((legId) => routeSet.has(legId));
    routeLegs.forEach((legId) => {
      if (!this.legStackOrder.includes(legId)) this.legStackOrder.push(legId);
    });
    this._rebuildLegRank();
  }

  _applyRouteLegOrder() {
    this._ensureLegStackOrder();
    this.legStackOrder.forEach((legId) => {
      this.gradientPolylines
        .filter((pl) => pl._legId === legId)
        .forEach((pl) => pl.bringToFront());
    });
  }

  _moveLegToBottomOfGroup(legId, groupLegs) {
    this._ensureLegStackOrder();
    const groupSet = new Set((groupLegs || []).filter((id) => this.legRank.has(id)));
    if (!groupSet.has(legId)) groupSet.add(legId);
    const currentGroupOrder = this.legStackOrder.filter((id) => groupSet.has(id));
    if (currentGroupOrder.length <= 1) return false;

    const nextGroupOrder = [
      legId,
      ...currentGroupOrder.filter((id) => id !== legId),
    ];

    let groupIdx = 0;
    this.legStackOrder = this.legStackOrder.map((id) => (
      groupSet.has(id) ? nextGroupOrder[groupIdx++] : id
    ));
    this._rebuildLegRank();
    return true;
  }

  _getOverlappingLegsAt(latlng, clickedLeg) {
    if (!latlng || !this.map) return clickedLeg !== undefined ? [clickedLeg] : [];
    const clickPx = this.map.latLngToContainerPoint(latlng);
    const PROX_PX = 10;
    const legs = new Set();

    this.gradientPolylines.forEach((pl) => {
      if (pl._legId === undefined) return;
      const coords = pl.getLatLngs();
      if (!coords.length) return;
      const sampleCount = Math.min(coords.length, 12);
      const step = sampleCount > 1 ? (coords.length - 1) / (sampleCount - 1) : 0;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.round(i * step);
        const px = this.map.latLngToContainerPoint(coords[idx]);
        if (Math.hypot(px.x - clickPx.x, px.y - clickPx.y) <= PROX_PX) {
          legs.add(pl._legId);
          break;
        }
      }
    });

    if (clickedLeg !== undefined) legs.add(clickedLeg);
    const order = this.legStackOrder.length ? this.legStackOrder : Array.from(legs);
    return order.filter((legId) => legs.has(legId));
  }

  /**
   * Compute leg IDs along a route. Segments are defined by the "main waypoints"
   * (this.waypoints). Handles outbound, return (if isRoundTrip), and O-loops.
   */
  _computeLegIds(routeCoords, cumDists, isRoundTrip) {
    const N = routeCoords.length;
    if (N < 2) return new Array(N).fill(0);
    const wps = this.waypoints;
    if (wps.length < 2) return new Array(N).fill(0);

    const distM = (a, b) => {
      const dLat = (b[0] - a[0]) * 111320;
      const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
      const dLng = (b[1] - a[1]) * 111320 * Math.cos(meanLat);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    };

    const boundaries = [0];
    let searchStart = 0;

    // 1. Forward Leg: Find waypoint indices WP0 -> WP1 -> ... -> WPN-1
    for (let i = 0; i < wps.length; i++) {
      let minD = Infinity, minIdx = searchStart;
      // Sequential search: find the first occurrence of each waypoint after the last one.
      // This correctly handles loops and self-intersections.
      for (let j = searchStart; j < N; j++) {
        const d = distM(wps[i], routeCoords[j]);
        if (d < minD) { minD = d; minIdx = j; }
        if (d < 5) break; // Close enough
      }
      if (minIdx > searchStart) boundaries.push(minIdx);
      searchStart = minIdx;
    }

    // 2. Return Leg (optional): WPN-1 -> WPN-2 -> ... -> WP0
    if (isRoundTrip) {
      for (let i = wps.length - 2; i >= 0; i--) {
        let minD = Infinity, minIdx = searchStart;
        for (let j = searchStart; j < N; j++) {
          const d = distM(wps[i], routeCoords[j]);
          if (d < minD) { minD = d; minIdx = j; }
          if (d < 5) break;
        }
        if (minIdx > searchStart) boundaries.push(minIdx);
        searchStart = minIdx;
      }
    } else {
      // Check for O-loop: does the route end back at the start waypoint?
      const endDistToStart = distM(routeCoords[N - 1], wps[0]);
      if (endDistToStart < 20 && searchStart < N - 10) {
        boundaries.push(N - 1);
      }
    }

    // Assign legId based on the boundary intervals
    const legIds = new Array(N).fill(0);
    let currentLeg = 0;
    for (let i = 0; i < N; i++) {
      while (currentLeg < boundaries.length - 1 && i >= boundaries[currentLeg + 1]) {
        currentLeg++;
      }
      legIds[i] = currentLeg;
    }
    return legIds;
  }

  clearGradientRoute() {
    this.gradientPolylines.forEach((pl) => this.map.removeLayer(pl));
    this.gradientPolylines = [];
    this.legStackOrder = [];
    this.legRank = new Map();
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
      marker._addOrder = this.intermediateMarkers.length;
      if (Number.isFinite(pt.cumDistM)) marker._cumDistM = pt.cumDistM;
      marker._isReturn = pt.isReturn;
      this._assignMarkerLegIds(marker);

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
    this._applyMarkerLegOrder();
  }

  clearIntermediateMarkers() {
    this.intermediateMarkers.forEach((m) => this.map.removeLayer(m));
    this.intermediateMarkers = [];
  }

  /**
   * Render markers for round-trip return-leg waypoints. Same size/shape as
   * outbound waypoint markers but with a dashed border, return-gradient
   * background, and a small "↩" badge so the two legs are easy to tell apart.
   * Markers whose lat/lng coincides with an outbound waypoint are anchor-
   * offset to the bottom-right and both ends get an `is-stacked` class so the
   * pair gets a yellow dotted halo to flag the overlap.
   *
   * @param {Array<{lat,lng,wpIndex,label,color,colIdx,weather,cumDistM,_cum}>} points
   */
  setReturnWaypoints(points) {
    this.clearReturnWaypoints();
    const list = points || [];

    const eq = (a, b) => Math.abs(a - b) < 1e-6;
    const newFlags = this.waypoints.map(([la, ln]) =>
      list.some((pt) => eq(pt.lat, la) && eq(pt.lng, ln))
    );
    const flagsChanged =
      newFlags.length !== this.stackedWaypointFlags.length ||
      newFlags.some((f, i) => f !== this.stackedWaypointFlags[i]);
    newFlags.forEach((isStacked, i) => {
      if (isStacked && !this.stackedWaypointFlags[i]) {
        this.waypointLayerSwapped[i] = true;
      }
    });
    this.stackedWaypointFlags = newFlags;
    if (flagsChanged) this._updateMarkerIcons();

    list.forEach((pt) => {
      const isStacked = this.waypoints.some(([la, ln]) => eq(la, pt.lat) && eq(ln, pt.lng));
      const icon = this._createReturnIcon(pt, isStacked);
      const marker = L.marker([pt.lat, pt.lng], { icon, interactive: true }).addTo(this.map);
      const cumDistM = Number.isFinite(pt.cumDistM)
        ? pt.cumDistM
        : (Number.isFinite(pt._cum) ? pt._cum : undefined);
      marker._colIdx = pt.colIdx;
      marker._wpIndex = pt.wpIndex;
      if (cumDistM !== undefined) marker._cumDistM = cumDistM;
      marker._isReturn = true;
      marker._stackOrderBias = 500 + (pt.wpIndex ?? 0);
      this._assignMarkerLegIds(marker);

      const outboundOnTop = this.waypointLayerSwapped[pt.wpIndex] ?? true;
      marker.setZIndexOffset(outboundOnTop ? 0 : 100);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        // Detect click on weather badge
        const target = e.originalEvent?.target;
        if (target && target.closest && target.closest('.wp-weather-badge')) {
          if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
          return;
        }
        if (pt.wpIndex !== undefined) this._scheduleWaypointSelect(pt.wpIndex, true);
      });

      marker.on('dblclick', (e) => {
        L.DomEvent.stopPropagation(e);
        this._clearWaypointClickTimeout();
        this._toggleWaypointLayer(marker._wpIndex, { select: false });
        this._deferTopWaypointLayerHighlight(marker._wpIndex);
      });

      // Long-press (500ms) to cycle overlapping layers
      let _lpTimer = null;
      let _startX = 0, _startY = 0;
      let _pendingLPHighlight = false;

      const cleanupLPListeners = () => {
        document.removeEventListener('mouseup', endLP);
        document.removeEventListener('touchend', endLP);
        document.removeEventListener('touchcancel', cancelLP);
      };

      const cancelLP = () => {
        if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
        _pendingLPHighlight = false;
        cleanupLPListeners();
      };

      const endLP = () => {
        if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
        if (_pendingLPHighlight) {
          _pendingLPHighlight = false;
          this._deferTopWaypointLayerHighlight(marker._wpIndex);
        }
        cleanupLPListeners();
      };
      
      const startLP = (e) => {
        if (this.isFrozen) return;
        const oe = e.originalEvent;
        if (oe.button !== undefined && oe.button !== 0) return;
        cancelLP();
        const touch = oe.touches ? oe.touches[0] : oe;
        _startX = touch.clientX;
        _startY = touch.clientY;
        
        _lpTimer = setTimeout(() => {
          _lpTimer = null;
          if (navigator.vibrate) navigator.vibrate(40);
          this._toggleWaypointLayer(marker._wpIndex, { select: false });
          _pendingLPHighlight = true;
        }, 500);

        document.addEventListener('mouseup', endLP);
        document.addEventListener('touchend', endLP);
        document.addEventListener('touchcancel', cancelLP);
      };
      
      const moveLP = (e) => {
        if (!_lpTimer) return;
        const oe = e.originalEvent;
        const touch = oe.touches ? oe.touches[0] : oe;
        if (Math.hypot(touch.clientX - _startX, touch.clientY - _startY) > 10) {
          clearTimeout(_lpTimer);
          _lpTimer = null;
        }
      };

      marker.on('mousedown touchstart', startLP);
      marker.on('mousemove touchmove', moveLP);
      marker.on('mouseup touchend', endLP);
      marker.on('mouseleave touchcancel', cancelLP);
      marker.on('contextmenu', (e) => {
        L.DomEvent.stop(e);
        this._toggleWaypointLayer(marker._wpIndex, { select: false });
        this._deferTopWaypointLayerHighlight(marker._wpIndex);
      });

      this.returnWaypointMarkers.push(marker);
    });
    this._applyMarkerLegOrder();
  }

  clearReturnWaypoints() {
    this.returnWaypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.returnWaypointMarkers = [];
    if (this.stackedWaypointFlags.some(Boolean)) {
      this.stackedWaypointFlags = this.waypoints.map(() => false);
      this._updateMarkerIcons();
    }
  }

  _createReturnIcon(pt, isStacked) {
    const total = this.waypoints.length;
    const isEndpoint = (pt.wpIndex === 0 || pt.wpIndex === total - 1) && total > 1;
    const size = isEndpoint ? 40 : 36;
    const num = (pt.wpIndex ?? 0) + 1;
    const weatherHtml = pt.weather ? `<div class="wp-weather-badge">${pt.weather}</div>` : '';
    const labelHtml = pt.label ? `<div class="marker-external-label">${pt.label}</div>` : '';
    const innerStyle = pt.color
      ? `style="background:${pt.color}; box-shadow: 0 2px 8px rgba(0,0,0,0.4), 0 0 0 2px ${pt.color}55;"`
      : '';
    const cls = `custom-waypoint-icon return-leg${isStacked ? ' is-stacked' : ''}`;
    return L.divIcon({
      className: cls,
      html:
        `<div class="wp-icon-inner" ${innerStyle}>${weatherHtml}` +
        `<span>${num}</span></div>${labelHtml}`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  clearAllRoutes() {
    this.routePolylines.forEach((pl) => this.map.removeLayer(pl));
    this.routePolylines = [];
    this.selectedRouteIndex = 0;
    this.clearHoverMarker();
    this.clearIntermediateMarkers();
    this.clearReturnWaypoints();
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
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.map.setView([lat, lng], Math.max(this.map.getZoom(), 14));
        // Drop a map cursor at the GPS fix instead of adding a waypoint —
        // user can long-press the cursor to set as waypoint / copy / show weather.
        this.setMapCursor(lat, lng);
      },
      () => { }
    );
  }

  setWaypointsFromImport(coords, metadata = null) {
    // Suppress per-waypoint callbacks — fire once at the end to avoid
    // repeated route recalculations and weather panel re-renders during import.
    const cb = this.onWaypointChange;
    this.onWaypointChange = () => { };
    // Clear waypoint markers only. Do NOT call clearWaypoints() here: it also
    // clears the route polyline, wiping the imported track that was drawn
    // just before this call in _applyImportedResultCore / restoreImportedTrack.
    this.waypointMarkers.forEach((m) => this.map.removeLayer(m));
    this.waypoints = [];
    this.waypointMarkers = [];
    this.waypointWeather = [];
    this.waypointColors = [];
    this.waypointLabels = [];
    this.waypointMetadata = [];
    coords.forEach((c, i) => {
      const [lat, lng] = Array.isArray(c) ? c : [c.lat, c.lng];
      const meta = (Array.isArray(c) ? null : c.meta) || (metadata ? metadata[i] : null);
      this.addWaypoint(lat, lng);
      if (meta) this.setWaypointMetadata(this.waypoints.length - 1, meta);
    });
    this.onWaypointChange = cb;
    this.fitToRoute();
    cb(this.waypoints);
  }

  _createIcon(index) {
    const total = this.waypoints.length;
    let cls = '';
    if (index === 0 && total > 1) cls = 'start';
    else if (index === total - 1 && total > 1) cls = 'end';
    if (this.stackedWaypointFlags?.[index]) cls += (cls ? ' ' : '') + 'is-stacked';

    const weather = this.waypointWeather[index];
    const weatherHtml = weather ? `<div class="wp-weather-badge">${weather}</div>` : '';

    const isEndpoint = (index === 0 || index === total - 1) && total > 1;
    const size = isEndpoint ? 40 : 36;
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
      marker._wpIndex = i;
      marker._stackOrderBias = i;
      marker.setIcon(this._createIcon(i));
      this._applyColorToMarker(marker, i);
    });
    this._restoreWaypointHighlightClass();
    this._applyMarkerLegOrder();
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
    let lpTimer = null;
    let lpTriggered = false;
    let startX = 0, startY = 0;

    polyline.on('mousedown touchstart', (e) => {
      if (this.isFrozen) return;
      const oe = e.originalEvent;
      if (oe.button !== undefined && oe.button !== 0) return;
      lpTriggered = false;
      const touch = oe.touches ? oe.touches[0] : oe;
      startX = touch.clientX;
      startY = touch.clientY;

      lpTimer = setTimeout(() => {
        lpTimer = null;
        lpTriggered = true;
        if (navigator.vibrate) navigator.vibrate(40);
        this._cycleOverlappingLayers(polyline, e.latlng);
      }, 500);
    });

    polyline.on('mousemove touchmove', (e) => {
      if (!lpTimer) return;
      const oe = e.originalEvent;
      const touch = oe.touches ? oe.touches[0] : oe;
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
    });

    polyline.on('mouseup touchend mouseleave touchcancel', () => {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
    });

    polyline.on('click', (e) => {
      L.DomEvent.stop(e);
      if (this.isFrozen || lpTriggered) return;

      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      } else {
        this._clickTimeout = setTimeout(() => {
          this._clickTimeout = null;
          // 單擊恢復為新增航點
          const insertIdx = this._findInsertionIndex(e.latlng);
          this.addWaypoint(e.latlng.lat, e.latlng.lng, insertIdx);
        }, 300);
      }
    });

    polyline.on('dblclick', (e) => {
      L.DomEvent.stop(e);
      if (this._clickTimeout) {
        clearTimeout(this._clickTimeout);
        this._clickTimeout = null;
      }
      // 雙擊保留切換功能
      this._cycleOverlappingLayers(polyline, e.latlng);
    });
  }

  /**
   * Look up the leg id at a given cumulative distance along the current route.
   * Uses binary search on this._currentRouteCum (cumulative distance per coord).
   */
  _legIdAtCumDist(cumDistM) {
    const cum = this._currentRouteCum;
    const legs = this._currentRouteLegIds;
    if (!cum || !legs || !Number.isFinite(cumDistM)) return undefined;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < cumDistM) lo = mid + 1;
      else hi = mid;
    }
    return legs[lo] ?? 0;
  }

  _allRouteAwareMarkers() {
    return [
      ...this.intermediateMarkers,
      ...this.waypointMarkers,
      ...this.returnWaypointMarkers,
    ];
  }

  _mainWaypointStackAt(latlng) {
    if (!latlng) return [];
    const all = [...this.waypointMarkers, ...this.returnWaypointMarkers];
    return all.filter((m) => {
      const pos = m.getLatLng?.();
      return pos && pos.distanceTo(latlng) <= 1.5;
    });
  }

  _markerLegIds(marker) {
    if (Array.isArray(marker?._legIds) && marker._legIds.length) return marker._legIds;
    return marker?._legId !== undefined ? [marker._legId] : [];
  }

  _markerLegRank(marker) {
    const ids = this._markerLegIds(marker);
    let rank = -1;
    ids.forEach((legId) => {
      const r = this.legRank.get(legId);
      if (r !== undefined) rank = Math.max(rank, r);
    });
    return rank >= 0 ? rank : 0;
  }

  _markerTieBreak(marker) {
    if (Number.isFinite(marker?._wpIndex) && this.stackedWaypointFlags?.[marker._wpIndex]) {
      const outboundOnTop = this.waypointLayerSwapped[marker._wpIndex] ?? true;
      return marker._isReturn
        ? (outboundOnTop ? 0 : 500)
        : (outboundOnTop ? 500 : 0);
    }
    if (Number.isFinite(marker?._stackOrderBias)) return marker._stackOrderBias;
    if (Number.isFinite(marker?._wpIndex)) return marker._wpIndex;
    if (Number.isFinite(marker?._addOrder)) return marker._addOrder;
    return 0;
  }

  _markerDisplayRank(marker) {
    return this._markerLegRank(marker) * 1000 + this._markerTieBreak(marker);
  }

  _assignMarkerLegIds(marker) {
    const cum = this._currentRouteCum;
    const legs = this._currentRouteLegIds;
    if (!cum || !legs || !Number.isFinite(marker?._cumDistM)) {
      delete marker._legId;
      delete marker._legIds;
      return;
    }

    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < marker._cumDistM) lo = mid + 1;
      else hi = mid;
    }

    const ids = new Set();
    ids.add(legs[lo] ?? 0);
    if (lo > 0 && Math.abs(marker._cumDistM - cum[lo]) < 2.0) {
      ids.add(legs[lo - 1] ?? 0);
    }
    if (lo < cum.length - 1 && Math.abs(marker._cumDistM - cum[lo]) < 2.0) {
      ids.add(legs[lo + 1] ?? legs[lo] ?? 0);
    }

    marker._legId = legs[lo] ?? 0;
    marker._legIds = Array.from(ids);
  }

  _applyMarkerLegOrder() {
    this._ensureLegStackOrder();
    this._allRouteAwareMarkers().forEach((marker) => {
      marker.setZIndexOffset(this._markerDisplayRank(marker));
    });
  }

  _cycleMarkerStackAt(latlng) {
    const stack = this._mainWaypointStackAt(latlng);
    if (stack.length <= 1) return false;

    const topMarker = stack.reduce((best, marker) => (
      !best || this._markerDisplayRank(marker) > this._markerDisplayRank(best) ? marker : best
    ), null);
    if (!topMarker) return false;

    const topLeg = this._markerLegIds(topMarker)
      .sort((a, b) => (this.legRank.get(b) ?? -1) - (this.legRank.get(a) ?? -1))[0];
    if (topLeg === undefined) return false;

    const stackLegs = new Set();
    stack.forEach((marker) => this._markerLegIds(marker).forEach((legId) => stackLegs.add(legId)));
    this._getOverlappingLegsAt(latlng, topLeg).forEach((legId) => stackLegs.add(legId));

    if (!this._moveLegToBottomOfGroup(topLeg, Array.from(stackLegs))) return false;
    this._applyRouteLegOrder();
    this._applyMarkerLegOrder();
    return true;
  }

  _topWaypointMarkerAt(latlng) {
    return this._mainWaypointStackAt(latlng).reduce((best, marker) => (
      !best || this._markerDisplayRank(marker) > this._markerDisplayRank(best) ? marker : best
    ), null);
  }

  /**
   * On dblclick: send the entire leg the clicked chunk belongs to (all chunks
   * sharing the same _legId) to the back, exposing whatever leg sat underneath.
   * Repeated dblclicks rotate through any number of overlapping passes — round
   * trips, multi-turnaround, figure-8, repeated laps, arbitrary self-crossings.
   * Falls back to spatial proximity grouping if leg ids weren't computed.
   */
  _cycleOverlappingLayers(clickedObject, latlng) {
    if (!this.gradientPolylines.length) return;
    const targetLeg = clickedObject._legId;

    // Refresh leg IDs on all markers to ensure they match current route state
    this._syncAllMarkerLegIds();
    this._ensureLegStackOrder();

    if (targetLeg !== undefined) {
      const overlapLegs = this._getOverlappingLegsAt(latlng, targetLeg);
      this._moveLegToBottomOfGroup(targetLeg, overlapLegs);
      this._applyRouteLegOrder();
      this._applyMarkerLegOrder();
      return;
    }

    const overlapLegs = this._getOverlappingLegsAt(latlng);
    const topLeg = overlapLegs
      .slice()
      .sort((a, b) => (this.legRank.get(b) ?? -1) - (this.legRank.get(a) ?? -1))[0];
    if (topLeg === undefined) return;
    this._moveLegToBottomOfGroup(topLeg, overlapLegs);
    this._applyRouteLegOrder();
    this._applyMarkerLegOrder();
  }

  /**
   * Send all markers belonging to a specific leg (or direction flag) to the 
   * back by lowering their z-index relative to all other markers.
   * @param {number|boolean} idOrFlag
   * @param {L.LatLng} clickLatLng - optional proximity check for boundary waypoints
   */
  _sendLegMarkersToBack(idOrFlag, clickLatLng = null) {
    this._syncAllMarkerLegIds();
    if (typeof idOrFlag === 'number') {
      this._moveLegToBottomOfGroup(idOrFlag, this._getOverlappingLegsAt(clickLatLng, idOrFlag));
    } else {
      const legs = Array.from(new Set(
        this.gradientPolylines
          .filter((pl) => pl._isReturn === idOrFlag && pl._legId !== undefined)
          .map((pl) => pl._legId)
      ));
      const topLeg = legs
        .slice()
        .sort((a, b) => (this.legRank.get(b) ?? -1) - (this.legRank.get(a) ?? -1))[0];
      if (topLeg !== undefined) this._moveLegToBottomOfGroup(topLeg, legs);
    }
    this._applyRouteLegOrder();
    this._applyMarkerLegOrder();
    return;

    const allMarkers = [
      ...this.intermediateMarkers,
      ...this.waypointMarkers,
      ...this.returnWaypointMarkers
    ];

    const stackedWaypointIndex = (m) => {
      const idx = m._wpIndex ?? this.waypointMarkers.indexOf(m);
      return idx >= 0 && this.stackedWaypointFlags?.[idx] ? idx : -1;
    };
    
    // Explicit comparison to handle numeric leg IDs and boolean direction flags correctly.
    // Also checks m._legIds (plural) for markers that sit at leg boundaries.
    const isTarget = (m) => {
      const stackedIdx = stackedWaypointIndex(m);
      if (stackedIdx >= 0) {
        if (typeof idOrFlag === 'boolean') return m._isReturn === idOrFlag;
        if (m._legId === idOrFlag) return true;
        if (m._legIds?.includes(idOrFlag)) return true;
        if (m._legId !== undefined || m._legIds) return false;
      }

      // 1. Primary match (flag or specific ID)
      if (typeof idOrFlag === 'boolean' && m._isReturn === idOrFlag) return true;
      if (m._legId === idOrFlag) return true;
      if (m._legIds && m._legIds.includes(idOrFlag)) return true;

      // 2. If the marker already has an explicit, non-matching leg affinity,
      // it belongs to the leg that just rose to the top — do NOT sweep it
      // via proximity. Without this guard, two stacked markers from opposing
      // legs would both go to back and never visually swap.
      if (m._legId !== undefined) return false;

      // 3. Proximity fallback for markers without leg info (legacy / edge cases).
      if (clickLatLng) {
        const dist = m.getLatLng().distanceTo(clickLatLng);
        if (dist < 15) return true; // 15 meters tolerance
      }

      return false;
    };

    const sameLeg = allMarkers.filter(isTarget);
    if (!sameLeg.length) return;

    this._syncStackedWaypointLayerForBack(idOrFlag, isTarget);

    // Check if there are markers NOT in this group to avoid unnecessary z-index reduction
    const othersExist = allMarkers.some(m => !isTarget(m));
    if (!othersExist) return;

    let minOffset = 0;
    for (const m of allMarkers) {
      const off = m.options.zIndexOffset || 0;
      if (off < minOffset) minOffset = off;
    }
    sameLeg.forEach(m => m.setZIndexOffset(minOffset - 100));
  }

  /**
   * Keep colocated outbound/return waypoint pairs visually aligned with the
   * route leg being sent behind. Route cycling used to lower polylines and
   * generic markers only; stacked main waypoints kept their old per-waypoint
   * swap state, so the visible waypoint could disagree with the visible track.
   */
  _syncStackedWaypointLayerForBack(idOrFlag, isTarget) {
    this._applyMarkerLegOrder();
    return;

    if (!this.stackedWaypointFlags?.some(Boolean)) return;
    this.waypointMarkers.forEach((outbound, idx) => {
      if (!this.stackedWaypointFlags[idx]) return;
      const ret = this.returnWaypointMarkers.find((m) => m._wpIndex === idx);
      if (!outbound || !ret) return;

      const isPrimaryTarget = (m) => {
        if (typeof idOrFlag === 'boolean') return m._isReturn === idOrFlag;
        if (m._legId === idOrFlag) return true;
        if (m._legIds?.includes(idOrFlag)) return true;
        if (m._legId !== undefined || m._legIds) return false;
        return isTarget(m);
      };

      const outboundMovesBack = isPrimaryTarget(outbound);
      const returnMovesBack = isPrimaryTarget(ret);
      if (outboundMovesBack === returnMovesBack) return;

      // true means outbound rests above return; false means return rests above outbound.
      this.waypointLayerSwapped[idx] = returnMovesBack;
      outbound.setZIndexOffset(returnMovesBack ? 100 : 0);
      ret.setZIndexOffset(returnMovesBack ? 0 : 100);
    });
  }

  /**
   * Update the cumulative distances for outbound waypoints and sync their leg IDs.
   * Called by main.js when route calculation finishes.
   */
  setWaypointDistances(dists) {
    this.waypointMarkers.forEach((m, i) => {
      if (Number.isFinite(dists[i])) {
        m._cumDistM = dists[i];
      } else {
        delete m._cumDistM;
        delete m._legId;
        delete m._legIds;
      }
      m._isReturn = false;
    });
    this._syncAllMarkerLegIds();
  }

  /**
   * Refresh _legId on all markers (waypoint, return, intermediate) based on their 
   * stored _cumDistM and the current route's leg ID mapping.
   */
  _syncAllMarkerLegIds() {
    const all = [...this.waypointMarkers, ...this.returnWaypointMarkers, ...this.intermediateMarkers];
    const cum = this._currentRouteCum;
    const legs = this._currentRouteLegIds;
    if (!cum || !legs) return;

    all.forEach(m => this._assignMarkerLegIds(m));
    this._applyMarkerLegOrder();
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

  /** Reset all waypoint markers to their resting z-index offset and remove
   *  any .is-selected class. Outbound rests at 0; return rests at 100 so that
   *  by default the (dashed) return circle is the one the user sees at stacked
   *  locations — only when an outbound marker is highlighted does it rise
   *  above its return counterpart. */
  _toggleWaypointLayer(idx, { select = true } = {}) {
    if (idx === undefined || idx < 0) return;
    const anchor = this.waypointMarkers[idx]?.getLatLng()
      || this.returnWaypointMarkers.find((m) => m._wpIndex === idx)?.getLatLng();
    if (!anchor) return;

    const changed = this._cycleMarkerStackAt(anchor);
    if (!changed && this.stackedWaypointFlags?.[idx]) {
      this.waypointLayerSwapped[idx] = !this.waypointLayerSwapped[idx];
      this._applyMarkerLegOrder();
    }

    if (select) this._highlightTopWaypointLayer(idx);
  }

  _clearWaypointClickTimeout() {
    if (this._waypointClickTimeout) {
      clearTimeout(this._waypointClickTimeout);
      this._waypointClickTimeout = null;
    }
  }

  _scheduleWaypointSelect(wpIndex, isReturn = false, shouldToggle = false) {
    this._clearWaypointClickTimeout();
    this._waypointClickTimeout = setTimeout(() => {
      this._waypointClickTimeout = null;
      this.onWaypointSelect?.(wpIndex, isReturn, shouldToggle);
    }, 250);
  }

  _deferWaypointSelect(wpIndex, isReturn = false, shouldToggle = false) {
    this._clearWaypointClickTimeout();
    setTimeout(() => this.onWaypointSelect?.(wpIndex, isReturn, shouldToggle), 0);
  }

  _deferTopWaypointLayerHighlight(idx) {
    this._clearWaypointClickTimeout();
    setTimeout(() => this._highlightTopWaypointLayer(idx), 0);
  }

  _highlightTopWaypointLayer(idx) {
    if (idx === undefined || idx < 0) return;

    const anchor = this.waypointMarkers[idx]?.getLatLng()
      || this.returnWaypointMarkers.find((m) => m._wpIndex === idx)?.getLatLng();
    const topMarker = this._topWaypointMarkerAt(anchor);
    if (topMarker?._isReturn) {
      const topIdx = topMarker._wpIndex;
      this.highlightReturnWaypoint(topIdx, true);
      this.onWaypointSelect?.(topIdx, true);
      return;
    }
    const topIdx = topMarker ? this.waypointMarkers.indexOf(topMarker) : idx;
    const resolvedIdx = topIdx >= 0 ? topIdx : idx;
    this.highlightWaypoint(resolvedIdx);
    this.onWaypointSelect?.(resolvedIdx, false);
  }

  /**
   * Reset all marker z-indices to their default stack order.
   * Default: outbound leg (100) is above return leg (0).
   * Overridden by waypointLayerSwapped[idx].
   */
  _resetWaypointMarkerZ() {
    this._clearWaypointSelectionClasses();
    this._applyMarkerLegOrder();
  }

  _clearWaypointSelectionClasses() {
    this.waypointMarkers.forEach((m) => {
      m.getElement()?.classList.remove('is-selected');
    });
    this.returnWaypointMarkers.forEach((m) => {
      m.getElement()?.classList.remove('is-selected');
    });
  }

  _restoreWaypointHighlightClass() {
    this._clearWaypointSelectionClasses();
    if (this.highlightedWpIndex < 0) return;
    const marker = this.highlightedIsReturn
      ? this.returnWaypointMarkers.find((x) => x._wpIndex === this.highlightedWpIndex)
      : this.waypointMarkers[this.highlightedWpIndex];
    marker?.getElement()?.classList.add('is-selected');
  }

  /** Highlight an outbound waypoint marker by index without changing z-order. */
  highlightWaypoint(wpIndex) {
    this._clearWaypointSelectionClasses();
    this.highlightedWpIndex = wpIndex;
    this.highlightedIsReturn = false;
    const m = this.waypointMarkers[wpIndex];
    if (m) {
      m.getElement()?.classList.add('is-selected');
    }
    this._applyMarkerLegOrder();
  }

  /** Highlight a return-leg waypoint marker by wpIndex. */
  highlightReturnWaypoint(wpIndex) {
    this._clearWaypointSelectionClasses();
    this.highlightedWpIndex = wpIndex;
    this.highlightedIsReturn = true;
    const m = this.returnWaypointMarkers.find((x) => x._wpIndex === wpIndex);
    if (m) {
      m.getElement()?.classList.add('is-selected');
    }
    this._applyMarkerLegOrder();
  }

  /** Remove all waypoint selection highlights (outbound + return). */
  clearWaypointHighlight() {
    this.highlightedWpIndex = -1;
    this.highlightedIsReturn = false;
    this._clearWaypointSelectionClasses();
    this._applyMarkerLegOrder();
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
