import * as Cesium from 'cesium';
import { latOf, lonOf, SITE_LAT, SITE_LON, M_PER_DEG_LAT, M_PER_DEG_LON } from '../sim/geo';
import { mulberry32, paintSiteTexture, SITE_HALF } from '../site/siteTexture';

export async function addImagery(viewer: Cesium.Viewer): Promise<void> {
  // global muted base so the horizon isn't a black void
  const base = document.createElement('canvas');
  base.width = 16;
  base.height = 16;
  const bctx = base.getContext('2d')!;
  bctx.fillStyle = '#46543f';
  bctx.fillRect(0, 0, 16, 16);
  const globalLayer = await Cesium.SingleTileImageryProvider.fromUrl(base.toDataURL(), {
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
  });
  viewer.imageryLayers.addImageryProvider(globalLayer);

  const dLon = SITE_HALF / M_PER_DEG_LON;
  const dLat = SITE_HALF / M_PER_DEG_LAT;
  const site = await Cesium.SingleTileImageryProvider.fromUrl(paintSiteTexture(2048).toDataURL(), {
    rectangle: Cesium.Rectangle.fromDegrees(SITE_LON - dLon, SITE_LAT - dLat, SITE_LON + dLon, SITE_LAT + dLat),
  });
  viewer.imageryLayers.addImageryProvider(site);
}

const cart = (x: number, y: number, alt: number): Cesium.Cartesian3 =>
  Cesium.Cartesian3.fromDegrees(lonOf(x), latOf(y), alt);

/** 3D landmarks: facility buildings, comms tower, perimeter fence, trees */
export function addEnvironment(viewer: Cesium.Viewer): void {
  const rnd = mulberry32(777);
  const e = viewer.entities;

  const building = (x: number, y: number, w: number, d: number, h: number, color: string): void => {
    e.add({
      position: cart(x, y, h / 2),
      box: {
        dimensions: new Cesium.Cartesian3(w, d, h),
        material: Cesium.Color.fromCssColorString(color),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#222c33'),
      },
    });
  };
  // facility compound
  building(-40, 20, 90, 42, 18, '#9aa4ad');
  building(55, -45, 46, 30, 11, '#8d99a4');
  building(-90, -60, 30, 22, 8, '#7f8a94');
  // comms tower + beacon
  e.add({
    position: cart(20, 62, 20),
    cylinder: {
      length: 40,
      topRadius: 1.2,
      bottomRadius: 2.6,
      material: Cesium.Color.fromCssColorString('#b8bfc7'),
    },
  });
  e.add({
    position: cart(20, 62, 42),
    point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#ff5f5f') },
  });

  // protected-site marker ring
  e.add({
    position: cart(0, 0, 0),
    ellipse: {
      semiMajorAxis: 210,
      semiMinorAxis: 210,
      height: 0.4,
      material: Cesium.Color.fromCssColorString('#4db8ff').withAlpha(0.05),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#4db8ff').withAlpha(0.5),
    },
  });

  // perimeter fence
  const F = 430;
  const fencePts: Cesium.Cartesian3[] = [
    cart(-F, -350, 1.2),
    cart(F, -350, 1.2),
    cart(F, 350, 1.2),
    cart(-F, 350, 1.2),
    cart(-F, -350, 1.2),
  ];
  e.add({
    polyline: {
      positions: fencePts,
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString('#c3cad1').withAlpha(0.8),
        dashLength: 12,
      }),
    },
  });

  // trees (trunk + crown), kept off the compound
  let placed = 0;
  let guard = 0;
  while (placed < 26 && guard++ < 300) {
    const x = (rnd() * 2 - 1) * 900;
    const y = (rnd() * 2 - 1) * 800;
    if (Math.hypot(x, y) < 260) continue;
    placed++;
    const s = 0.8 + rnd() * 0.9;
    e.add({
      position: cart(x, y, 3.2 * s),
      cylinder: {
        length: 6.4 * s,
        topRadius: 0.5 * s,
        bottomRadius: 0.7 * s,
        material: Cesium.Color.fromCssColorString('#6d5236'),
      },
    });
    e.add({
      position: cart(x, y, 8.5 * s),
      ellipsoid: {
        radii: new Cesium.Cartesian3(4.6 * s, 4.6 * s, 5.4 * s),
        material: Cesium.Color.fromCssColorString(['#3f6e38', '#4c7c40', '#57894a'][placed % 3]),
      },
    });
  }
}
