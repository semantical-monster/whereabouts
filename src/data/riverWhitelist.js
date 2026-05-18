// Rivers that bypass length filters due to historical or cultural significance.
// These rivers may be short, heavily fragmented in OSM, or clipped at state borders
// but are important enough to always appear in the quiz.
//
// Stored as lowercase base names with " river" stripped so matching is flexible
// (e.g. "Jordan River" → "jordan", "Los Angeles River" → "los angeles").
export const RIVER_WHITELIST = [
  'jordan',        // Jordan River, UT — 82 km, historically/culturally central to Salt Lake Valley
  'chicago',       // Chicago River, IL — reversed flow, major urban landmark
  'potomac',       // Potomac River — may be clipped short at the MD/VA/WV border junction
  'san antonio',   // San Antonio River, TX — short urban river, heavily significant historically
  'los angeles',   // Los Angeles River, CA — channelized but historically + culturally significant
  'truckee',       // Truckee River, NV — crosses from CA; short NV segment still quiz-worthy
];

export function isWhitelisted(riverName) {
  const base = riverName.toLowerCase().replace(/\s*river$/i, '').trim();
  return RIVER_WHITELIST.includes(base);
}
