/**
 * Spatial constants for the SkylineYear camera grammar.
 *
 * Extracted verbatim from the original monolith. Where a value is currently a
 * fixed number tuned against a 7-day-deep grid, the comment notes how it could
 * become geometry-derived in a later pass — but the numeric value is preserved
 * for now so the parity snapshot stays byte-identical.
 */

/**
 * Z floor — camera never goes closer than this in Z so it doesn't clip into
 * bars (bars span Z ±3.45 with originZ=-3 and cellSize=0.9 → far edge ≈ 3.5).
 * 13.5 keeps the camera ~10 units from bar faces — cinematic "street-level"
 * without going inside the geometry.
 */
export const Z_FLOOR = 13.5;

/**
 * Maximum cruise Z. The camera arrives at F150 with Z = Z_FLOOR + 2.5 = 16.
 * Capping the cruise maximum here prevents the camera from pulling further back
 * on sparse sections than it started — the swing is now 13.5..16.5 (22%),
 * was 13.5..19 (40%). Fixed regardless of data because it's relative to Z_FLOOR.
 */
export const CRUISE_Z_MAX = 16.5;

/** Bar build-in: how far ahead of the camera the wave extends, in world units. */
export const BUILD_LEAD = 9;

/**
 * Orbit height above the skyline base. BAR_MAX_HEIGHT=6 (from grid.ts), so
 * ORBIT_H=9 gives 3 units clearance above any bar for any data set.
 */
export const ORBIT_H = 9;

/**
 * Orbit Z radius. Fixed because skyline depth = 7 days × stride≈1 = 7 units —
 * constant for any year. ORBIT_RZ=30 gives 4× the skyline depth, a comfortable
 * perspective distance from both front and back of the grid.
 */
export const ORBIT_RZ = 30;

/** Orbit X radius is data-adaptive: clamp(halfActiveSpan * SCALE, MIN, MAX). */
export const ORBIT_RX_MIN = 20;
export const ORBIT_RX_MAX = 42;
export const ORBIT_RX_SCALE = 1.2;

/**
 * Orbit focal point X is biased this fraction of the way from the active centre
 * toward the peak column, so the orbit frames the busiest district without
 * staring off the edge of the skyline.
 */
export const ORBIT_FOCAL_BIAS = 0.35;
