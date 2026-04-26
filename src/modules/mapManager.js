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
    this.returnWaypointMarkers = []; // Markers for round-trip return waypoints (same shape as outbound, dashed border)
    this.stackedWaypointFlags = []; // Per-waypoint flag: outbound marker shares lat/lng with a return marker
    this.ignoreMapClick = false;
    this.dragLine = null;
    this.dragLine = null;
    this._dragWpIndex = undefined;
    this._weatherPopups = new Map(); // Leaflet popups for weather cards (colIdx -> popup)
    this._clickTimeout = null; // Global debunking for map/track clicks to avoid dual triggering with dblclick
    // Map cursor — placed by GPS button (goToMyLocation). Long-press / click
    // on the cursor opens an action menu (set as waypoint / copy coords / weather).
    this._mapCursor = null;
    this._mapCursorLatLng = null;
    this._mapCursorMenuPopup = null;
    this.onMapCursorAction = null; // callback(action, lat, lng)

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

  _ensureTrashZone() {
    if (this._trashZoneEl) return this._trashZoneEl;
    const el = document.createElement('div');
    el.className = 'waypoint-trash-zone hidden';
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">' +
      '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>' +
      '</svg>' +
      '<span class="waypoint-trash-label">拖曳至此刪除</span>';
    document.body.appendChild(el);
    this._trashZoneEl = el;
    return el;
  }

  _showTrashZone() {
    const el = this._ensureTrashZone();
    el.classList.remove('hidden', 'is-hover');
  }

  _hideTrashZone() {
    if (!this._trashZoneEl) return;
    this._trashZoneEl.classList.add('hidden');
    this._trashZoneEl.classList.remove('is-hover');
  }

  _isOverTrashZone(clientX, clientY) {
    if (clientX == null || clientY == null) return false;
    if (!this._trashZoneEl || this._trashZoneEl.classList.contains('hidden')) return false;
    const rect = this._trashZoneEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const radius = Math.max(rect.width, rect.height) / 2 + 16;
    return dx * dx + dy * dy <= radius * radius;
  }

  _updateTrashZoneHover(clientX, clientY) {
    const isOver = this._isOverTrashZone(clientX, clientY);
    if (this._trashZoneEl) this._trashZoneEl.classList.toggle('is-hover', isOver);
    return isOver;
  }

  // ===== Map cursor (placed by GPS button — not a waypoint) =====

  setMapCursor(lat, lng) {
    this._mapCursorLatLng = [lat, lng];
    this._closeMapCursorMenu();
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
    if (this._mapCursor) {
      this.map.removeLayer(this._mapCursor);
      this._mapCursor = null;
    }
    this._mapCursorLatLng = null;
  }

  _createMapCursorIcon() {
    return L.divIcon({
      className: 'map-cursor-icon',
      html:
        '<div class="map-cursor-pulse"></div>' +
        '<div class="map-cursor-ring"></div>' +
        '<div class="map-cursor-cross"></div>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
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
        `<div class="map-cursor-coords">${latStr}, ${lngStr}</div>` +
        '<button class="cursor-menu-btn" data-action="waypoint">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
            '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/>' +
          '</svg>' +
          '<span>設為航點</span>' +
        '</button>' +
        '<button class="cursor-menu-btn" data-action="copy">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
            '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/>' +
          '</svg>' +
          '<span>複製座標</span>' +
        '</button>' +
        '<button class="cursor-menu-btn" data-action="weather">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
            '<path d="M19.36 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.64-4.96z" fill="currentColor"/>' +
          '</svg>' +
          '<span>顯示大格天氣卡</span>' +
        '</button>' +
        '<button class="cursor-menu-btn cursor-menu-cancel" data-action="dismiss">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
            '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>' +
          '</svg>' +
          '<span>取消</span>' +
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

    wrapper.querySelectorAll('.cursor-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.dataset.action;
        this._closeMapCursorMenu();
        if (action === 'dismiss') {
          this.clearMapCursor();
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
        this._showTrashZone();

        const onMove = (ev) => {
          const latlng = this.map.mouseEventToLatLng(ev);
          marker.setLatLng(latlng);
          this._updateRubberBand(latlng);
          this._updateTrashZoneHover(ev.clientX, ev.clientY);
        };
        const onUp = (ev) => {
          const isOverTrash = this._isOverTrashZone(ev?.clientX, ev?.clientY);
          _dragModeActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this._hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          this.map.dragging.enable();
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const pos = marker.getLatLng();
          const idx = this.waypointMarkers.indexOf(marker);
          if (idx >= 0) {
            if (isOverTrash) {
              if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
              this.removeWaypoint(idx);
            } else {
              this.waypoints[idx] = [pos.lat, pos.lng];
              this.onWaypointChange(this.waypoints);
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
        _dragModeActive = true;
        marker.getElement()?.classList.add('is-dragging');
        if (navigator.vibrate) navigator.vibrate(40);
        this.map.dragging.disable();

        this._startRubberBand(marker);
        this._showTrashZone();

        let lastTouchClientX = null, lastTouchClientY = null;

        const onTouchMove = (ev) => {
          ev.preventDefault();
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
          this._updateTrashZoneHover(t.clientX, t.clientY);
        };
        const onTouchEnd = (ev) => {
          const ct = ev?.changedTouches?.[0];
          const cx = ct?.clientX ?? lastTouchClientX;
          const cy = ct?.clientY ?? lastTouchClientY;
          const isOverTrash = this._isOverTrashZone(cx, cy);
          _dragModeActive = false;
          _isTouchActive = false;
          _justDragged = true;
          this._blockMapClick();
          this._stopRubberBand();
          this._hideTrashZone();
          setTimeout(() => { _justDragged = false; }, 150);
          marker.getElement()?.classList.remove('is-dragging');
          this.map.dragging.enable();
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
          const pos = marker.getLatLng();
          const idx = this.waypointMarkers.indexOf(marker);
          if (idx >= 0) {
            if (isOverTrash) {
              if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
              this.removeWaypoint(idx);
            } else {
              this.waypoints[idx] = [pos.lat, pos.lng];
              this.onWaypointChange(this.waypoints);
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
      if (idx >= 0) this.onWaypointSelect?.(idx);
    });

    // 綁定 Leaflet 內建拖曳功能 (Desktop 右鍵後觸發) 的事件
    marker.on('dragstart', () => {
      this._startRubberBand(marker);
      this._showTrashZone();
    });
    marker.on('drag', (e) => {
      this._updateRubberBand(e.target.getLatLng());
      const oe = e.originalEvent;
      const cx = oe?.clientX ?? oe?.touches?.[0]?.clientX;
      const cy = oe?.clientY ?? oe?.touches?.[0]?.clientY;
      if (cx != null && cy != null) {
        this._updateTrashZoneHover(cx, cy);
      } else {
        // Fallback: derive screen coords from marker's lat/lng
        const cp = this.map.latLngToContainerPoint(e.target.getLatLng());
        const r = this.map.getContainer().getBoundingClientRect();
        this._updateTrashZoneHover(cp.x + r.left, cp.y + r.top);
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
      const isOverTrash = this._isOverTrashZone(dropX, dropY);
      this._blockMapClick();
      this._stopRubberBand();
      this._hideTrashZone();
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

    // Compute leg IDs across the whole route — used for cycling overlapping
    // passes via dblclick. A leg boundary is detected at U-turns and at points
    // where the route revisits previously-traversed territory (laps, figure-8).
    const legIds = this._computeLegIds(routeCoords, dists);
    this._currentRouteLegIds = legIds;
    this._currentRouteCum = dists;

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
  }

  /**
   * Compute leg IDs along a route. A leg boundary is detected at:
   *   1) U-turns: heading change > 120° within a ~25m window.
   *   2) Loop closes: the route revisits territory (within 30m) that was
   *      previously traversed in the same leg, with sufficient gap (>250m)
   *      so tight switchbacks don't trip it.
   * Returns an array of integers (one per coord) where chunks/markers within
   * the same leg share the same id.
   */
  _computeLegIds(routeCoords, cumDists) {
    const N = routeCoords.length;
    if (N < 6) return new Array(N).fill(0);

    // Equirectangular meters approximation — good enough for short distances.
    const distM = (a, b) => {
      const dLat = (b[0] - a[0]) * 111320;
      const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
      const dLng = (b[1] - a[1]) * 111320 * Math.cos(meanLat);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    };
    const cum = cumDists;
    const legIds = new Array(N).fill(0);
    let currentLeg = 0;

    const WINDOW_M = 25;
    const U_TURN_DEG = 120;
    const LOOP_PROX_M = 35;
    const LOOP_MIN_GAP_M = 250;
    const SAMPLE_INTERVAL_M = 40;
    const MIN_LEG_LEN_M = 30;

    const idxBack = (i, d) => {
      let j = i - 1;
      while (j > 0 && cum[i] - cum[j] < d) j--;
      return j;
    };
    const idxFwd = (i, d) => {
      let j = i + 1;
      while (j < N - 1 && cum[j] - cum[i] < d) j++;
      return j;
    };

    const samples = [];
    let lastSampleCum = -Infinity;
    let lastBoundaryCum = -Infinity;

    for (let i = 0; i < N; i++) {
      let isBoundary = false;

      // U-turn detection
      if (i > 0 && i < N - 1) {
        const ja = idxBack(i, WINDOW_M);
        const jb = idxFwd(i, WINDOW_M);
        if (cum[i] - cum[ja] >= WINDOW_M * 0.6 && cum[jb] - cum[i] >= WINDOW_M * 0.6) {
          const a = routeCoords[ja], b = routeCoords[i], c = routeCoords[jb];
          const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
          let diff = (h2 - h1) * 180 / Math.PI;
          while (diff > 180) diff -= 360;
          while (diff < -180) diff += 360;
          if (Math.abs(diff) > U_TURN_DEG) isBoundary = true;
        }
      }

      // Loop close detection (only against same-leg samples that are far enough behind)
      if (!isBoundary) {
        for (let s = samples.length - 1; s >= 0; s--) {
          const sample = samples[s];
          if (sample.leg !== currentLeg) break;
          if (cum[i] - sample.cum < LOOP_MIN_GAP_M) continue;
          if (distM(routeCoords[i], sample.coord) < LOOP_PROX_M) {
            isBoundary = true;
            break;
          }
        }
      }

      if (isBoundary && cum[i] - lastBoundaryCum >= MIN_LEG_LEN_M) {
        currentLeg++;
        lastBoundaryCum = cum[i];
      }
      legIds[i] = currentLeg;

      if (cum[i] - lastSampleCum >= SAMPLE_INTERVAL_M) {
        samples.push({ coord: routeCoords[i], idx: i, cum: cum[i], leg: currentLeg });
        lastSampleCum = cum[i];
      }
    }

    return legIds;
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
      marker._addOrder = this.intermediateMarkers.length;
      marker._legId = this._legIdAtCumDist(pt.cumDistM);

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

  /**
   * Render markers for round-trip return-leg waypoints. Same size/shape as
   * outbound waypoint markers but with a dashed border, return-gradient
   * background, and a small "↩" badge so the two legs are easy to tell apart.
   * Markers whose lat/lng coincides with an outbound waypoint are anchor-
   * offset to the bottom-right and both ends get an `is-stacked` class so the
   * pair gets a yellow dotted halo to flag the overlap.
   *
   * @param {Array<{lat,lng,wpIndex,label,color,colIdx,weather}>} points
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
    this.stackedWaypointFlags = newFlags;
    if (flagsChanged) this._updateMarkerIcons();

    list.forEach((pt) => {
      const isStacked = this.waypoints.some(([la, ln]) => eq(la, pt.lat) && eq(ln, pt.lng));
      const icon = this._createReturnIcon(pt, isStacked);
      const marker = L.marker([pt.lat, pt.lng], { icon, interactive: true }).addTo(this.map);
      marker._colIdx = pt.colIdx;
      marker._wpIndex = pt.wpIndex;
      // Sit on top of the (now hidden) outbound marker at stacked locations so
      // clicks land on the return circle.
      marker.setZIndexOffset(100);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (pt.colIdx !== undefined) this.onWeatherBadgeClick?.(pt.colIdx, true);
      });

      this.returnWaypointMarkers.push(marker);
    });
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

  setWaypointsFromImport(coords) {
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
    if (!cum || !legs || cumDistM == null) return 0;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < cumDistM) lo = mid + 1;
      else hi = mid;
    }
    return legs[lo] ?? 0;
  }

  /**
   * On dblclick: send the entire leg the clicked chunk belongs to (all chunks
   * sharing the same _legId) to the back, exposing whatever leg sat underneath.
   * Repeated dblclicks rotate through any number of overlapping passes — round
   * trips, multi-turnaround, figure-8, repeated laps, arbitrary self-crossings.
   * Falls back to spatial proximity grouping if leg ids weren't computed.
   */
  _cycleOverlappingLayers(clickedPolyline, latlng) {
    if (!this.gradientPolylines.length) return;
    const targetLeg = clickedPolyline._legId;

    if (targetLeg !== undefined) {
      const sameLegPolylines = this.gradientPolylines.filter(pl => pl._legId === targetLeg);
      const otherLegsExist = this.gradientPolylines.some(pl => pl._legId !== targetLeg);
      if (otherLegsExist) {
        sameLegPolylines.forEach(pl => pl.bringToBack());
      }
      this._sendLegMarkersToBack(targetLeg);
      return;
    }

    // Fallback (no leg ids available): spatial contiguous-run grouping.
    const clickPx = this.map.latLngToContainerPoint(latlng);
    const PROX_PX = 10;
    const passesNear = (pl) => {
      const coords = pl.getLatLngs();
      if (!coords.length) return false;
      const sampleCount = Math.min(coords.length, 12);
      const step = sampleCount > 1 ? (coords.length - 1) / (sampleCount - 1) : 0;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.round(i * step);
        const px = this.map.latLngToContainerPoint(coords[idx]);
        if (Math.hypot(px.x - clickPx.x, px.y - clickPx.y) <= PROX_PX) return true;
      }
      return false;
    };
    const overlapSet = new Set(this.gradientPolylines.filter(passesNear));
    overlapSet.add(clickedPolyline);
    const idx = this.gradientPolylines.indexOf(clickedPolyline);
    if (idx < 0) return;
    let lo = idx, hi = idx;
    while (lo > 0 && overlapSet.has(this.gradientPolylines[lo - 1])) lo--;
    while (hi < this.gradientPolylines.length - 1 && overlapSet.has(this.gradientPolylines[hi + 1])) hi++;
    if (overlapSet.size === (hi - lo + 1)) return;
    for (let i = lo; i <= hi; i++) this.gradientPolylines[i].bringToBack();
  }

  /**
   * Push every intermediate marker on `legId` below all others on the map by
   * dropping its zIndexOffset under the current minimum. Repeated calls cycle
   * across legs naturally because the most recently demoted leg ends up at the
   * very bottom while the others rise relative to it.
   */
  _sendLegMarkersToBack(legId) {
    const sameLeg = this.intermediateMarkers.filter(m => m._legId === legId);
    if (!sameLeg.length) return;
    const otherLegsExist = this.intermediateMarkers.some(m => m._legId !== legId);
    if (!otherLegsExist) return;
    let minOffset = Infinity;
    for (const m of this.intermediateMarkers) {
      const off = m.options.zIndexOffset || 0;
      if (off < minOffset) minOffset = off;
    }
    sameLeg.forEach(m => m.setZIndexOffset(minOffset - 100));
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
  _resetWaypointMarkerZ() {
    this.waypointMarkers.forEach((m) => {
      m.getElement()?.classList.remove('is-selected');
      m.setZIndexOffset(0);
    });
    this.returnWaypointMarkers.forEach((m) => {
      m.getElement()?.classList.remove('is-selected');
      m.setZIndexOffset(100);
    });
  }

  /** Highlight an outbound waypoint marker by index. Bumps the marker's
   *  Leaflet zIndexOffset so it rises above any colocated return marker
   *  (which sits at +100 by default). */
  highlightWaypoint(wpIndex) {
    this._resetWaypointMarkerZ();
    const m = this.waypointMarkers[wpIndex];
    if (m) {
      m.getElement()?.classList.add('is-selected');
      m.setZIndexOffset(1000);
    }
  }

  /** Highlight a return-leg waypoint marker by wpIndex. */
  highlightReturnWaypoint(wpIndex) {
    this._resetWaypointMarkerZ();
    const m = this.returnWaypointMarkers.find((x) => x._wpIndex === wpIndex);
    if (m) {
      m.getElement()?.classList.add('is-selected');
      m.setZIndexOffset(1000);
    }
  }

  /** Remove all waypoint selection highlights (outbound + return). */
  clearWaypointHighlight() {
    this._resetWaypointMarkerZ();
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
