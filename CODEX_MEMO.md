## CURRENT_TASK
Visible-shore detector is now viewpoint-based again, with optional live auto-apply while dragging the center point.

## CURRENT_SUBTASK
Await user feedback after adding live visible-shore flattening.

## STABLE_INSIGHTS
- Repo initially contained only `visu1.m` and `visu1.png`.
- `visu1.m` displays one composite view: left side is a `1200px`-wide polar-log unwrap plus a `120px` profile editor; right side is a half-resolution overview image.
- Overview coordinates `(a, b)` live in the half-resolution image; sampling happens from the full-resolution image around `(2a, 2b)`.
- Unwrap sampling uses `radius = 4 * exp(4 * (r + R0(theta)) / imageHeight)` with angle columns spanning `0..2pi`.
- Original interactions by zone:
- Overview click sets the unwrap center.
- Unwrap click rotates the angular alignment.
- Profile click edits `R0` with a wrapped Gaussian brush.
- The MATLAB preview marks the center plus two small heading markers on the overview image to show current angular orientation.
- The web port keeps the same three logical zones but improves the interaction model:
- Overview uses click-drag for center changes.
- Unwrap uses click-drag rotation instead of MATLAB's click-only shift.
- Profile editing shows the editable curve directly instead of the original binary/eroded helper strip.
- The profile state is now stored as a zero-centered offset curve, not as absolute radii. Effective sampling radius is `baseRadius + offset(theta)`.
- `Zero curve` fills that offset array with `0`, so the reference radius becomes a literal neutral baseline.
- `Smooth curve` applies wrapped multi-pass smoothing, so continuity is preserved across the left/right seam of the unwrap.
- There is now a separate segmentation tool panel with a dark-water threshold slider, a visible-shore preview, a `Flatten visible shoreline` action, and an `Auto-apply while moving viewpoint` toggle.
- The active viewpoint is the same purple point shown in the overview and segmentation preview; the detector no longer recenters anything on its own.
- The current shoreline detector uses the thresholded connected component containing the chosen viewpoint, hole-fills it, and samples the first stable exit along each ray from that viewpoint. That gives the visible shoreline rather than the full component boundary.
- The preview polyline should use the raw visible-shore hits; the baseline generation can use a smoothed-and-gap-filled version of the same curve.
- Missing shoreline sectors are filled by rotating the largest gap to the seam and extending/interpolating from the nearest valid endpoints, which avoids wraparound artifacts from open coastlines.
- The live auto-apply mode is intentionally frame-based: moving the viewpoint marks the shoreline dirty and applies the flattening curve during the next render, so dragging stays responsive.

## IMPLEMENTATION_NOTES
- A plain TypeScript + canvas app is the right fit here; no framework is needed.
- Keep the default image available as a static asset and allow swapping in another image later if useful.
- Main implementation lives in `src/polar-log-app.ts`.
- The display is rendered as one composite canvas; for the reference asset it is `1740x520` (`1200x400` unwrap + `1200x120` profile + `540x520` overview).
- Default reference parameters for `visu1.png` remain `center=(100,160)` and `baseRadius=960`.
- Verified with Playwright: initial render, center dragging, unwrap rotation dragging, and profile painting all update state and pixels correctly.
- Verified after the editor refactor with Playwright: freehand curve drawing changes the radius band, smoothing changes it, and zeroing returns the band to `960-960` on the reference image.
- Verified after the visible-shore revert: moving the center to `(270,260)` on the sample image yields a visible-shore preview with about `100%` coverage and a non-zero baseline without recentering.
- Verified after adding live auto-apply: enabling the toggle updates the radius band immediately when the center point moves, without clicking the flatten button.
