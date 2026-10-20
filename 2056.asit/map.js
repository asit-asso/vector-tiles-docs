import DragRotateAndZoom from 'https://cdn.jsdelivr.net/npm/ol@10.4.0/interaction/DragRotateAndZoom.js';
import {defaults as defaultInteractions} from 'https://cdn.jsdelivr.net/npm/ol@10.4.0/interaction/defaults.js'

// ── 1. EPSG:2056 projection ──────────────────────────────────────
proj4.defs(
	'EPSG:2056',
	'+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 ' +
	'+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel ' +
	'+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs'
);
ol.proj.proj4.register(proj4);
const proj2056 = ol.proj.get('EPSG:2056');


// ── 2a. Tiling scheme (LV95tilingSchemeASIT) ───────────────────────
// Stop at zoom level 17 since the vector tiles stop at zoom level 17 (resolution = 0.5)
const lv95Resolutions = [65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5];

const tileGrid = new ol.tilegrid.TileGrid({
	origin: [2420000, 1350000],
	resolutions: lv95Resolutions,
	sizes: [
		[1, 1],
		[1, 1],
		[1, 1],
		[1, 1],
		[1, 1],
		[1, 1],
		[2, 2],
		[4, 3],
		[8, 6],
		[16, 12],
		[32, 24],
		[63, 48],
		[126, 96],
		[252, 191],
		[503, 381],
		[1006, 762],
		[2012, 1524]
	],
	tileSize: 512,
});

// ── 2b. swisstopo WMTS tiling scheme (TileMatrixSet "2056_26") ──
// Official swisstopo LV95 pyramid, fetched from wmts.geo.admin.ch's capabilities:
// different origin/resolutions/matrix sizes than the vector tiles tileGrid above.
// This tilegrid is used for raster layer coming from swisstopo wmts (relief and orthophoto layers)
const reliefResolutions = [
	4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250,
	1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1
];

const wmtsTileGrid = new ol.tilegrid.TileGrid({
	origin: [2420000, 1350000],
	resolutions: reliefResolutions,
	sizes: [
		[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1],
		[2, 1], [2, 1], [2, 1],
		[2, 2],
		[3, 2], [3, 2],
		[4, 3],
		[8, 5],
		[19, 13],
		[38, 25],
		[94, 63],
		[188, 125],
		[375, 250],
		[750, 500],
		[938, 625],
		[1250, 834],
		[1875, 1250],
		[3750, 2500],
		[7500, 5000],
		[18750, 12500]
	],
	tileSize: 256,
});

// ── 3. Map ───────────────────────────────────────────────────────
// Here, the zoom level go futher than 10 allowing maximum zoom on the map
// and performing overzoon on the vector tiles
const map = new ol.Map({
	interactions: defaultInteractions().extend([new DragRotateAndZoom()]),
	target: 'map',
	pixelRatio: 2,
	view: new ol.View({
		projection: proj2056,
		center: [2660000, 1190000],
		zoom: 3,
		resolutions: [65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625]
	}),
});

// ── 4. Apply MapLibre style, then rebuild VT layers ────────────────
// By default, OLMS uses web mercator zoom levels. The olmsOptions.resolution specifies the plugin to use custom
// zoom levels (EPSG:2056).
// Raster layers from swisstopo WMTS (relief and orthophoto) are handled separately and entirely overridden in pure JS
const olmsOptions = {
	resolutions: [65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625],
};

// Key of the relief layer's `change:resolution` listener, tracked outside loadBasemap so it
// can be unregistered before the next basemap swap (otherwise listeners stack up across switches).
let reliefResolutionListenerKey = null;

function loadBasemap(styleUrl, tilesUrl) {
	if (reliefResolutionListenerKey) {
		ol.Observable.unByKey(reliefResolutionListenerKey);
		reliefResolutionListenerKey = null;
	}
	map.getLayers().clear();

	olms.apply(map, styleUrl, olmsOptions).then(() => {
		const layers = map.getLayers();

		// Snapshot indices first — we'll replace in place to preserve draw order
		layers.getArray().slice().forEach((layer, index) => {
			const source = layer.getSource?.();
			if (!(source instanceof ol.source.VectorTile)) return;

			// Capture everything OLMS configured on this layer before discarding it
			const style = layer.getStyle();       // style function OLMS derived from the MapLibre style.json
			const declutter = layer.getDeclutter?.() ?? false;
			const opacity = layer.getOpacity();
			const visible = layer.getVisible();
			const minZoom = layer.getMinZoom();
			const maxZoom = layer.getMaxZoom();
			const zIndex = layer.getZIndex();
			const properties = layer.getProperties(); // includes OLMS's internal 'mapbox-layers' etc.

			const newLayer = new ol.layer.VectorTile({
				source: new ol.source.VectorTile({
					format: new ol.format.MVT(),
					projection: proj2056,
					tileGrid,
					url: tilesUrl,
				}),
				style,
				declutter,
				opacity,
				visible,
				minZoom,
				maxZoom,
				zIndex,
				renderMode: "hybrid",
				properties,
			});

			// Swap at the same position to keep layer order intact
			layers.removeAt(index);
			layers.insertAt(index, newLayer);
		});

		// Drop the "relief" layer OLMS built from style.json entirely — its source
		// uses a tile grid derived from the projection's extent, which doesn't
		// match swisstopo's WMTS tile matrix set, and its opacity is a one-time
		// snapshot that never updates as the map moves. Rebuild it from scratch:
		// swisstopo's own tile grid, and opacity re-evaluated live from
		// style.json's "raster-opacity" stops against the map's actual resolution.
		const reliefIndex = layers.getArray().findIndex((layer) => layer.get('mapbox-source') === 'relief');
		if (reliefIndex !== -1) {
			layers.removeAt(reliefIndex);

			const reliefOpacityStops = [[0, 0.2], [10, 0.15], [12, 0]]; // "raster-opacity" from style.json
			const reliefOpacityForResolution = (resolution) => {
				const view = map.getView();
				for (let i = 0; i < reliefOpacityStops.length - 1; i++) {
					const [z0, o0] = reliefOpacityStops[i];
					const [z1, o1] = reliefOpacityStops[i + 1];
					const r0 = view.getResolutionForZoom(z0);
					const r1 = view.getResolutionForZoom(z1);
					if (resolution >= r1) {
						const t = Math.min(1, Math.max(0, (r0 - resolution) / (r0 - r1)));
						return o0 + t * (o1 - o0);
					}
				}
				return reliefOpacityStops[reliefOpacityStops.length - 1][1];
			};

			const reliefLayer = new ol.layer.Tile({
				source: new ol.source.XYZ({
					crossOrigin: 'anonymous',
					projection: proj2056,
					tileGrid: wmtsTileGrid,
					url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/2056/{z}/{x}/{y}.png",
				}),
				opacity: reliefOpacityForResolution(map.getView().getResolution()),
			});
			reliefLayer.set('mapbox-source', 'relief');

			reliefResolutionListenerKey = map.getView().on('change:resolution', () => {
				reliefLayer.setOpacity(reliefOpacityForResolution(map.getView().getResolution()));
			});

			// Insert at the same position the OLMS relief layer occupied, to keep draw order intact
			layers.insertAt(reliefIndex, reliefLayer);
		}

		// Drop the "aerail" layer OLMS built from style.json entirely — its source
		// uses a tile grid derived from the projection's extent, which doesn't
		// match swisstopo's WMTS tile matrix set.
		const aerialIndex = layers.getArray().findIndex((layer) => layer.get('mapbox-source') === 'aerial');
		if (aerialIndex !== -1) {
			layers.removeAt(aerialIndex);

			const aerialLayer = new ol.layer.Tile({
				source: new ol.source.XYZ({
					crossOrigin: 'anonymous',
					projection: proj2056,
					tileGrid: wmtsTileGrid,
					url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/current/2056/{z}/{x}/{y}.jpeg",
				})
			});
			aerialLayer.set('mapbox-source', 'aerial');

			// Insert at the same position the OLMS relief layer occupied, to keep draw order intact
			layers.insertAt(aerialIndex, aerialLayer);
		}
	});
}

loadBasemap(
	"https://vt.asit-asso.ch/styles-dev/2056.asit/asit.cadastral/style.json",
	"https://vt.asit-asso.ch/tiles-dev/asit.cadastral.hires/v0.1/2056.asit/{z}/{x}/{y}.mvt"
);

// ── 5. Basemap switcher ─────────────────────────────────────────
const switcher = document.getElementById("basemapSwitcher");
const buttons = switcher.querySelectorAll(".basemap-option");

buttons.forEach(opt => {
	opt.addEventListener("click", () => {
		const styleUrl = opt.getAttribute("data-style");
		const tilesUrl = opt.getAttribute("data-tiles-url");
		loadBasemap(styleUrl, tilesUrl);

		buttons.forEach(o => o.classList.remove("active"));
		opt.classList.add("active");
	});
});
