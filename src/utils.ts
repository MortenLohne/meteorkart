/**
 *
 * @param ts Timestamp in seconds
 * @description Formats a timestamp in seconds to a string in the format "YYYY-MM-DD HH:MM".
 * If the input is not a valid number or results in an invalid date, it returns "--".
 * @returns Formatted date string or "--" for invalid input.
 */
export function formatTimestamp(ts: number): string {
  if (typeof ts !== "number" || isNaN(ts)) return "--";
  const date = new Date(ts * 1000);
  if (isNaN(date.getTime())) return "--";
  return (
    date.toISOString().split("T")[0] +
    " " +
    date.toISOString().split("T")[1].slice(0, 5)
  );
}

/**
 * WGS-84 to Web Mercator conversion
 * @param lng Longitude in WGS-84
 * @param lat Latitude in WGS-84
 * @returns Object with x and y coordinates in Web Mercator projection
 */
export function wgs84ToWebMercator(
  lng: number,
  lat: number
): { x: number; y: number } {
  const s = 20037508.34;
  const x = (lng * s) / 180;
  const y =
    ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * s) /
    180;
  return { x, y };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates the bearing from one geographic coordinate to another.
 *
 * @returns The bearing in degrees from the start point to the end point.
 */
export function calculateBearing(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): number {
  // Convert degrees to radians
  const lat1 = toRadians(startLat);
  const lat2 = toRadians(endLat);
  const deltaLon = toRadians(endLon - startLon);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearingRad = Math.atan2(y, x);
  let bearingDeg = toDegrees(bearingRad);
  return (bearingDeg + 360) % 360; // Normalize to 0-360
}
