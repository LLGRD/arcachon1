# visu1 webapp

Browser port of `visu1.m`, keeping the original log-polar unwrap concept while making the interaction more practical for the web.

## Run

```bash
npm install
npm run dev
```

## Interaction model

- Drag inside the overview panel on the right to move the unwrap center.
- Drag inside the unwrap panel on the left to rotate the angular alignment.
- Drag inside the lower strip to draw a freehand radial-offset curve.
- Use `Smooth curve` to apply wrapped smoothing to that curve.
- Use `Zero curve` to reset the curve to zero offset around the reference radius.
- Use the segmentation slider to threshold dark water against land and inspect the binary preview.
- Use `Flatten visible shoreline` to derive a baseline from the shoreline that is visible from the current center point.
- Enable `Auto-apply while moving viewpoint` to recompute and apply that visible-shore baseline live as you drag the purple point.
- Use `Load image` to try another source image and `Use default image` to restore `visu1.png`.

## Notes

- The default image is the original `visu1.png`, served as a static asset.
- The browser app preserves the core MATLAB mapping formula and the three interaction zones.
- The profile editor is now zero-centered around the reference radius, which makes freehand drawing, smoothing, and zeroing more intuitive than the original MATLAB brush behavior.
- The segmentation workflow now uses the current center point as a viewpoint, finds the first stable shoreline hit along each ray through the thresholded connected component, and uses that visible shoreline both for preview and for baseline generation.
- Missing angular sectors are filled across the largest gap instead of wrapping a seam through the whole circle, which reduces baseline artifacts when the visible shoreline is effectively open.
- The preview overlay is intentionally drawn in high-contrast green with a dark under-stroke so the detected shoreline stays readable on the light land mask.
