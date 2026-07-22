/** site anchor — simulation state is kept in local ENU meters so any
 *  renderer (Cesium today, PlayCanvas field view later) can consume it */
export const SITE_LON = 127.02;
export const SITE_LAT = 37.31;

export const M_PER_DEG_LAT = 111320;
export const M_PER_DEG_LON = 111320 * Math.cos((SITE_LAT * Math.PI) / 180);

export const lonOf = (x: number): number => SITE_LON + x / M_PER_DEG_LON;
export const latOf = (y: number): number => SITE_LAT + y / M_PER_DEG_LAT;
export const xOfLon = (lon: number): number => (lon - SITE_LON) * M_PER_DEG_LON;
export const yOfLat = (lat: number): number => (lat - SITE_LAT) * M_PER_DEG_LAT;
