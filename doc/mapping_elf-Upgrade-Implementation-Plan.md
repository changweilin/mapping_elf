# 3D Geospatial Reconstruction Upgrade and Improvement Plan

<!-- AGENT-READABLE STATUS BLOCK — keep in sync when a task's state changes. -->
```yaml
doc: mapping_elf 3D upgrade plan
last_updated: 2026-07-02
branch: codex/optimized_restructuring
impl_file: src/modules/terrainViewer.js
export_file: src/modules/terrainExporter.js
legend:
  DONE: implemented + builds + smoke-checked
  PARTIAL: partially implemented; see Notes for what remains
  TODO: not started (feasible in current stack)
  DEFERRED: out of scope for the current Three.js + Open-Meteo + Overpass stack
status:
  DONE:     [I-4, II-1, II-2, II-3, II-4, III-1, III-2, III-3, III-4, IV-1, IV-2, IV-3]
  PARTIAL:  []
  TODO:     []
  DEFERRED: [I-1, I-2, I-3, V-1, V-2, V-3]
verification:
  - "vite build: pass (terrainExporter split into a lazy 5.6 kB chunk; jszip stays in the zip chunk)"
  - "npm run test:numeric: pass"
  - "static helper unit checks (_parseLengthM/_buildingHeight/_roofInfo/_classifyPoint/_roofPositions): pass"
  - "exporter smoke checks (binary STL triangle-count + finiteness; 3MF OPC zip: content-types/rels/model, basematerials, per-triangle p1 family colours, route object): pass"
  - "browser/GUI QA: PASS 2026-07-02 (Playwright live run, Jiufen route: 3D model built; 懸空 toggles drop-stems visible/hidden; 揭示 clamps tube drawRange + line instanceCount to progress and restores in full; STL export 43560 tris binary-valid + finite; 3MF export OPC-valid with basematerials/p1/2 objects; peak/tree/tower/viewpoint models render; gabled/skillion/hipped roof meshes build + render, ridge/mono-pitch/apex structure re-verified offline via _roofPositions)"
```

## 0. Implementation Status Ledger

Stable IDs (`§-n`) cross-reference the tagged bullets in each section below.

| ID | Task (short) | Status | Code anchor (`terrainViewer.js`) | Notes / next step |
|----|--------------|--------|----------------------------------|-------------------|
| I-1  | Copernicus GLO-30 source | DEFERRED | `_fetchElevationGrid`, `ELEVATION_API` | Open-Meteo elevation is already Copernicus-DEM-backed; explicit source swap needs a new tiled DEM provider. |
| I-2  | ArcticDEM high-latitude | DEFERRED | `_fetchElevationGrid` | Needs a second regional DEM source + latitude routing. |
| I-3  | Geoid↔ellipsoid calibration | DEFERRED | `_latLngToLocal` | Open-Meteo returns orthometric (geoid) heights already; no ellipsoid conversion currently applied. |
| I-4  | Smoother render field | DONE | `SUBDIV`, `_buildFineField`, `_sampleSmooth` | `SUBDIV` 4→6 (FIELD_SIZE 97→145). No extra download, cache-compatible. |
| II-1 | CZML-style time-dynamic path | DONE | `setRouteRevealMode`, `_applyRouteReveal`, `_updatePlayerPosition` | 軌跡揭示 toggle reveals the tube (index `setDrawRange`) + overlay line (`instanceCount`) up to the player's progress; updated per-frame during playback. |
| II-2 | Non-linear interp + resampling | DONE | `_createRoutePath` | Centripetal Catmull-Rom (Hermite-family) + `getSpacedPoints` arc-length resample; overlay line now shares the smooth curve (no corner cutting). |
| II-3 | Dynamic offset vs Z-fighting | DONE | `_createRoutePath` (`routeLift`) | Fixed +5 m → `max(5, relief×0.01)`. |
| II-4 | Absolute elevation mode | DONE | `setAbsoluteElevation`, `_buildRouteStems` | 懸空 toggle draws vertical drop-stems from the true-elevation track down to the terrain surface, so the suspension in 3D space reads explicitly. Prebuilt geometry, visibility flip only. |
| III-1| Tag mapping (pt/line/poly→3D) | DONE | `_classifyPoint`, `_buildPointModel`, `_fetchMapFeatures`/`_buildMapFeatures` | Lines/areas/buildings + `building:part`, and now point landmarks: peaks (cairn+pennant), trees, towers/lighthouse, viewpoints/monuments → directional procedural models, capped (trees harder). |
| III-2| Height derivation hierarchy | DONE | `_buildingHeight`, `_parseLengthM`, `_buildingMinHeight` | `height`→`levels×3`(+roof levels)→type-statistical default; unit-aware; `min_height` stepped massing. |
| III-3| `building:part` parsing | DONE | `_classifyFeature`, `_fetchMapFeatures`, `_buildMapFeatures` (`hasSubParts`) | Parent shell with parts renders label-only (OSM Simple-3D rule). |
| III-4| Straight-skeleton roofs | DONE | `_roofPositions`, `_buildMapFeatures` | `gabled`/`gambrel` → PCA long-axis ridge (simplified straight-skeleton for the rectangular case); `skillion` → mono-pitch plane; hip/pyramidal/dome/mansard → apex fan. All built from the wall-top ring so they never self-intersect. |
| IV-1 | Printable ridge path sweep | DONE | `terrainExporter.js` `assembleRidge`, `getExportSource`/`_exportRouteSamples` | Route draped on the surface, swept into a closed triangular ridge prism, merged into the watertight terrain solid for binary STL. |
| IV-2 | 3MF export + AMS multicolor | DONE | `terrainExporter.js` `build3MF`, `encode3mfModelXml` | OPC-zip 3MF (content-types + rels + `3D/3dmodel.model`) with a `basematerials` palette; terrain + route are separate coloured objects for per-filament/AMS assignment. |
| IV-3 | Feature-based color blocking | DONE | `getExportSource` (family grid), `assembleTerrain` per-triangle `p1` | Land-cover family (land/vegetation/soil/urban) + rasterised water drive a per-triangle 3MF material, so water/vegetation/etc. print as distinct colour blocks. |
| V-1  | License/patent review | DEFERRED | project-wide | Non-code; audit task. |
| V-2  | LiDAR/point-cloud experiment | DEFERRED | new module | Research spike. |
| V-3  | 3D Gaussian Splatting | DEFERRED | new module | Research spike. |

---

## I. Terrain and Elevation Data Source Optimization

Terrain serves as the structural foundation of a 3D map. The current DEM (Digital Elevation Model) resolution and coordinate system processing require further enhancement.

- **[I-1 · 🔒 DEFERRED]** Integrate the Copernicus GLO-30 data source to supplement or replace existing SRTM data, providing a higher precision global elevation model. _(Open-Meteo elevation is already Copernicus-DEM-backed; explicit swap needs a tiled-DEM provider.)_
- **[I-2 · 🔒 DEFERRED]** Introduce the ArcticDEM database to specifically address the extreme high-precision requirements (2 to 10 meters resolution) for high-latitude and Arctic regions.
- **[I-3 · 🔒 DEFERRED]** Calibrate the deviation between the Geoid and the ellipsoid height to ensure accurate elevation calculations, thereby improving the draping precision between the flight trajectory and the real-world terrain. _(Open-Meteo already returns orthometric heights.)_
- **[I-4 · ✅ DONE]** _(added)_ Increase the shared render/contour field density (`SUBDIV` 4→6, `FIELD_SIZE` 97→145) for a smoother surface and iso-lines with no extra download and full elevation-cache compatibility.

---

## II. Trajectory Processing and Visualization Upgrade

Enhance the spatiotemporal visual representation and rendering logic of trajectories to resolve artifact issues and rough edges.

- **[II-1 · ✅ DONE]** Develop a time-dynamic visualization feature supporting formats similar to [CZML Path], allowing for more complex time-series displays to replace purely static line segment rendering. _(軌跡揭示 toggle progressively reveals the tube + overlay line up to the player's position via index `setDrawRange` / `instanceCount`, updated each frame.)_
- **[II-2 · ✅ DONE]** Implement non-linear interpolation (e.g., Hermite interpolation) and linear resampling smoothing algorithms to resolve the straight-line cutting anomaly caused by insufficient sampling at sharp turns. _(Centripetal Catmull-Rom + arc-length `getSpacedPoints`; overlay line now shares the smooth curve.)_
- **[II-3 · ✅ DONE]** Add dynamic minor offset calculations for terrain-draping trajectories to fundamentally resolve Z-fighting (depth conflict) issues. _(`routeLift = max(5, relief×0.01)`.)_
- **[II-4 · ✅ DONE]** Develop an Absolute Elevation visualization mode, allowing flight trajectories to be accurately suspended and displayed within the 3D terrain space. _(懸空 toggle draws vertical drop-stems from the true-elevation track down to the terrain surface so the suspension is legible; `_buildRouteStems`.)_

---

## III. OSM Data Semantic Parsing and Procedural Building Modeling

Referencing the architecture of [OSM2World], introduce richer tag parsing capabilities and building extrusion algorithms.

- **[III-1 · ✅ DONE]** Establish a dedicated Tag Mapping System to convert OpenStreetMap point, line, and polygon elements into directional 3D models and road meshes. _(Lines/areas/buildings in `_classifyFeature`; point landmarks in `_classifyPoint` → `_buildPointModel`: peaks, trees, towers/lighthouse, viewpoints/monuments, capped per type.)_
- **[III-2 · ✅ DONE]** Implement automatic building height derivation logic: prioritize reading the `height` tag, secondly calculate based on `building:levels` (deriving with a constant 3 meters per level), and finally apply regional statistical random heights. _(`_buildingHeight`; unit-aware `_parseLengthM`; `min_height` stepped massing.)_
- **[III-3 · ✅ DONE]** Develop `building:part` tag parsing capabilities, allowing a single complex building to be broken down into multiple height and shape blocks for refined and detailed modeling. _(Parent shell with parts renders label-only per OSM Simple-3D rule.)_
- **[III-4 · ✅ DONE]** Introduce the Straight Skeleton algorithm to automatically generate complex roof geometries such as Gabled and Hipped roofs. _(`_roofPositions`: gabled/gambrel get a PCA long-axis ridge, skillion a mono-pitch plane, hip/pyramidal/dome/mansard an apex fan — a simplified straight-skeleton that never self-intersects on messy OSM footprints.)_

---

## IV. 3D Printing and Physical Export Optimization

Maintain and enhance the project's core advantage in physical-oriented output, improving print quality and user experience.

- **[IV-1 · ✅ DONE]** Optimize the "Path Sweeping" algorithm to ensure the generated trajectory forms a Printable Ridge mesh entity suitable for 3D printing. _(`terrainExporter.js` `assembleRidge` sweeps the surface-draped route into a closed triangular ridge prism, merged with the watertight terrain solid for binary STL.)_
- **[IV-2 · ✅ DONE]** Upgrade the 3MF format export function and fully support data allocation for multi-color printing systems (e.g., AMS). _(`build3MF` emits an OPC-zip 3MF with a `basematerials` palette and separate coloured objects for terrain and route so each maps to a filament/AMS slot.)_
- **[IV-3 · ✅ DONE]** Implement an automatic color-blocking mechanism based on map features (e.g., water bodies, vegetation) to improve the visual recognition and aesthetics of the 3D printed physical models. _(Land-cover family grid + rasterised water drive a per-triangle 3MF material `p1`, so water / vegetation / soil / urban / land print as distinct colour blocks.)_

---

## V. Forward-Looking Technology Integration and Compliance Risk Management

Layout future sensor fusion technologies and ensure the legality of the project's open-source and commercial use.

- **[V-1 · 🔒 DEFERRED]** Review all 3D model generation algorithms within the project, prioritizing open-licensed visualization methods to avoid risks associated with specific companies' design patents or copyright claims. _(Non-code audit task.)_
- **[V-2 · 🔒 DEFERRED]** Establish an experimental module to test the integration of LiDAR and point cloud data to compensate for the insufficient resolution of traditional DEMs, achieving centimeter-level high terrain precision. _(Research spike.)_
- **[V-3 · 🔒 DEFERRED]** Evaluate the application potential of 3D Gaussian Splatting (3DGS) rendering technology and explore the feasibility of using it as a next-generation alternative for trajectory background generation. _(Research spike.)_

---

## VI. Reference Sources and Technical Links

The following is a list of reference sources corresponding to the technical optimizations and implementations in this plan. Use these references for indexing during subsequent development and algorithm design:

[OSM2World]: https://osm2world.org/
[CesiumJS – Cesium]: https://cesium.com/platform/cesiumjs/
[How to use Cesium JS: step-by-step tutorial - MapTiler documentation]: https://docs.maptiler.com/cesium/examples/how-to-use-cesium/
[CesiumJS for Terrain and Geology - Bathyl]: https://www.bathyl.com/en/blog/cesiumjs-for-terrain-and-geology
[Cesium vs Mapbox: 3D Geospatial and Web Maps Compared - Atlas]: https://atlas.co/comparisons/cesium-vs-mapbox/
[Visualizing Imagery - Cesium]: https://cesium.com/learn/cesiumjs-learn/cesiumjs-imagery/
[USING OPENSTREETMAP DATA TO GENERATE BUILDING MODELS WITH THEIR INNER STRUCTURES FOR 3D MAPS]: https://d-nb.info/1143874226/34
[I'm a helicopter pilot and I 3D print the terrain of my flights straight from the GPS log - Reddit]: https://www.reddit.com/r/3Dprinting/comments/1u248qe/im_a_helicopter_pilot_and_i_3d_print_the_terrain/
[Cesium World Terrain]: https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/
[6 clever ways to 3D print photos (and why lithophanes are just the start) - How-To Geek]: https://www.howtogeek.com/clever-ways-to-3d-print-photos-and-why-lithophanes-are-just-the-start/
[CZML Path | Sandcastle | CesiumJS]: https://sandcastle.cesium.com/?src=CZML%20Path.html
[CesiumJS 3D Tiles Viewer: What It Is & How to Use It - Swyvl]: https://swyvl.io/blog/cesium-3d-tiles-viewer/
[Personalized 3D Map - Free 3D Print Model - MakerWorld]: https://makerworld.com/en/models/1502820-personalized-3d-map
[CZML History visualization details · CesiumGS/cesium Wiki - GitHub]: https://github.com/CesiumGS/cesium/wiki/CZML-History-visualization-details
[I built a web app for designing 3D printable maps! : r/BambuLab - Reddit]: https://www.reddit.com/r/BambuLab/comments/1rnamm1/i_built_a_web_app_for_designing_3d_printable_maps/
[Screenshots - OSM2World]: https://osm2world.org/screens/
[OSM2World (PDF)]: https://fosdem.org/2026/events/attachments/BMMGNT-osm2world_3d_rendering_openstreetmap_data/slides/267176/osm2world_49jn01v.pdf
[Blosm for Blender: OpenStreetMap, Google 3D cities, terrain - GitHub]: https://github.com/vvoovv/blosm
[Prototype Fund OSM-3D-Edit roadmap - OSM2World]: https://osm2world.org/blog/2025/09/24/ptf-roadmap-2025-osm-3d-edit/
[Map2Model: Web generator created by Bambu Labs MakerWorld community for 3D printable maps of real-world locations - 3Druck.com]: https://3druck.com/en/case-studies/map2model-web-generator-in-bambu-lab-makerworld-community-creates-3d-printable-maps-from-real-locations-15159180/
[Map2Model has been shut down]: https://map2model.com/
[Blosm - Blender addons]: https://blender-addons.org/blosm/
[3D Map Maker - Generate Map with Topography - Free 3D Print Model - MakerWorld]: https://makerworld.com/en/models/1562594-3d-map-maker-generate-map-with-topography
[Using OSM2World as a library on the Web]: https://osm2world.org/docs/library-web/
[6.3 Importing a Satellite Scan model (3D City Map with Blosm for Blender)]: https://support.cmbuilder.io/hc/en-us/articles/19806258974875-6-3-Importing-a-Satellite-Scan-model-3D-City-Map-with-Blosm-for-Blender
[Map2Models Gone : r/3Dprinting - Reddit]: https://www.reddit.com/r/3Dprinting/comments/1ug0m56/map2models_gone/
[Industrial LiDAR & mmWave Radar: Open-Source Stacks Enabling 3D Perception, Mapping and Autonomous Navigation - Eurthtech]: https://www.eurthtech.com/post/industrial-lidar-mmwave-radar-open-source-stacks-enabling-3d-perception-mapping-and-autonomous-n
[Top 7 LiDAR Visualization Tools for 2025 - Anvil Labs]: https://anvil.so/post/lidar-visualization-tools
