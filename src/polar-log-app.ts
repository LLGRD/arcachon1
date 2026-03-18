const TAU = Math.PI * 2;
const DEFAULT_SOURCE = "/visu1.png";
const DEFAULT_SOURCE_SIZE = { width: 1080, height: 1040 };
const DEFAULT_SEGMENTATION_THRESHOLD = 46;
const SMOOTH_KERNEL = [1, 4, 6, 4, 1];

type DragMode = "overview" | "unwrap" | "profile" | null;

interface Defaults {
  centerX: number;
  centerY: number;
  baseRadius: number;
}

interface CoastDetection {
  centerIsWater: boolean;
  coverage: number;
  flattenedOffset: Float32Array;
  previewRadii: Float32Array;
  targetRow: number;
}

export class PolarLogApp {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly segmentationCanvas: HTMLCanvasElement;
  private readonly segmentationContext: CanvasRenderingContext2D;
  private readonly fileInput: HTMLInputElement;
  private readonly thresholdSlider: HTMLInputElement;
  private readonly thresholdValue: HTMLOutputElement;
  private readonly autoFlattenButton: HTMLButtonElement;
  private readonly liveAutoFlattenToggle: HTMLInputElement;
  private readonly resetViewButton: HTMLButtonElement;
  private readonly smoothProfileButton: HTMLButtonElement;
  private readonly zeroProfileButton: HTMLButtonElement;
  private readonly useDefaultButton: HTMLButtonElement;
  private readonly statusLine: HTMLParagraphElement;
  private readonly sourceBadge: HTMLSpanElement;
  private readonly segmentationSummary: HTMLParagraphElement;

  private readonly unwrapWidth = 1200;
  private readonly profileHeight = 120;
  private readonly profileScale = 4;
  private readonly baseAngles = new Float64Array(this.unwrapWidth);
  private readonly angleCos = new Float64Array(this.unwrapWidth);
  private readonly angleSin = new Float64Array(this.unwrapWidth);
  private readonly profileFactors = new Float64Array(this.unwrapWidth);

  private segmentationThreshold = DEFAULT_SEGMENTATION_THRESHOLD;
  private sourceName = "visu1.png";
  private sourceWidth = 0;
  private sourceHeight = 0;
  private overviewWidth = 0;
  private overviewHeight = 0;
  private unwrapHeight = 0;
  private defaults: Defaults = { centerX: 0, centerY: 0, baseRadius: 0 };

  private centerX = 0;
  private centerY = 0;
  private angleOffset = 0;
  private profileOffset = new Float32Array(this.unwrapWidth);
  private rowScales = new Float64Array(0);

  private fullImageData: ImageData | null = null;
  private overviewImageData: ImageData | null = null;
  private unwrapBuffer: ImageData | null = null;
  private segmentationPreviewBuffer: ImageData | null = null;
  private fullLuma: Uint8Array | null = null;
  private overviewLuma: Uint8Array | null = null;

  private cachedCoastDetection: CoastDetection | null = null;
  private detectionDirty = true;
  private segmentationPreviewDirty = true;
  private liveAutoFlattenEnabled = false;
  private pendingLiveAutoFlatten = false;

  private activePointerId: number | null = null;
  private dragMode: DragMode = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private renderQueued = false;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = `
      <main class="app-shell">
        <section class="app-header">
          <div>
            <p class="kicker">visu1 / log-polar explorer</p>
            <h1>Interactive TypeScript port of the MATLAB viewer</h1>
            <p class="lede">
              Drag the overview to move the sampling center, drag the unwrap to rotate it,
              and draw a freehand offset curve in the lower strip to bias the per-angle radius.
            </p>
          </div>
          <div class="controls">
            <label class="file-picker">
              <span>Load image</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/*" />
            </label>
            <button type="button" data-action="default">Use default image</button>
            <button type="button" data-action="view">Reset view</button>
            <button type="button" data-action="smooth">Smooth curve</button>
            <button type="button" data-action="zero">Zero curve</button>
          </div>
        </section>

        <section class="viewer-card">
          <div class="viewer-meta">
            <span class="badge" data-role="source">Loading image...</span>
            <span class="hint">Composite canvas mirrors the MATLAB layout: unwrap + profile at left, overview at right.</span>
          </div>
          <canvas class="viewer" aria-label="Interactive log-polar viewer"></canvas>
        </section>

        <section class="analysis-grid">
          <article class="tool-card">
            <div class="tool-header">
              <div>
                <p class="tool-kicker">Segmentation Aid</p>
                <h2>Dark-water threshold preview</h2>
              </div>
              <button type="button" data-action="auto-flatten">Flatten visible shoreline</button>
            </div>

            <label class="toggle-control">
              <input type="checkbox" data-role="live-auto-flatten" />
              <span>Auto-apply while moving viewpoint</span>
            </label>

            <label class="slider-control">
              <span>Threshold <output data-role="threshold-value">46</output></span>
              <input type="range" min="0" max="255" value="46" data-role="threshold-slider" />
            </label>

            <canvas class="segmentation-viewer" aria-label="Binary segmentation preview"></canvas>
            <p class="tool-note" data-role="segmentation-summary">
              Previewing dark-water segmentation from the current viewpoint.
            </p>
          </article>
        </section>

        <section class="help-grid">
          <p><strong>Overview</strong> moves the center point.</p>
          <p><strong>Unwrap</strong> rotates the angular alignment.</p>
          <p><strong>Profile strip</strong> lets you draw a freehand wrapped offset curve, then smooth or zero it.</p>
          <p><strong>Segmentation</strong> previews the thresholded water mask and can auto-build a flattening baseline from the current center point.</p>
        </section>

        <p class="status" data-role="status">Initializing...</p>
      </main>
    `;

    this.canvas = this.root.querySelector<HTMLCanvasElement>("canvas.viewer") ?? this.fail("Missing viewer canvas.");
    this.context = this.canvas.getContext("2d") ?? this.fail("2D canvas context is unavailable.");
    this.segmentationCanvas =
      this.root.querySelector<HTMLCanvasElement>("canvas.segmentation-viewer") ??
      this.fail("Missing segmentation canvas.");
    this.segmentationContext =
      this.segmentationCanvas.getContext("2d") ?? this.fail("Segmentation canvas context is unavailable.");
    this.fileInput =
      this.root.querySelector<HTMLInputElement>('input[type="file"]') ?? this.fail("Missing file picker.");
    this.thresholdSlider =
      this.root.querySelector<HTMLInputElement>('input[data-role="threshold-slider"]') ??
      this.fail("Missing threshold slider.");
    this.thresholdValue =
      this.root.querySelector<HTMLOutputElement>('output[data-role="threshold-value"]') ??
      this.fail("Missing threshold output.");
    this.autoFlattenButton =
      this.root.querySelector<HTMLButtonElement>('button[data-action="auto-flatten"]') ??
      this.fail("Missing auto flatten button.");
    this.liveAutoFlattenToggle =
      this.root.querySelector<HTMLInputElement>('input[data-role="live-auto-flatten"]') ??
      this.fail("Missing live auto flatten toggle.");
    this.resetViewButton =
      this.root.querySelector<HTMLButtonElement>('button[data-action="view"]') ?? this.fail("Missing reset view button.");
    this.smoothProfileButton =
      this.root.querySelector<HTMLButtonElement>('button[data-action="smooth"]') ??
      this.fail("Missing smooth profile button.");
    this.zeroProfileButton =
      this.root.querySelector<HTMLButtonElement>('button[data-action="zero"]') ??
      this.fail("Missing zero profile button.");
    this.useDefaultButton =
      this.root.querySelector<HTMLButtonElement>('button[data-action="default"]') ??
      this.fail("Missing use default image button.");
    this.statusLine =
      this.root.querySelector<HTMLParagraphElement>('p[data-role="status"]') ?? this.fail("Missing status line.");
    this.sourceBadge =
      this.root.querySelector<HTMLSpanElement>('span[data-role="source"]') ?? this.fail("Missing source badge.");
    this.segmentationSummary =
      this.root.querySelector<HTMLParagraphElement>('p[data-role="segmentation-summary"]') ??
      this.fail("Missing segmentation summary.");

    for (let column = 0; column < this.unwrapWidth; column += 1) {
      this.baseAngles[column] = (TAU * (column + 1)) / this.unwrapWidth;
    }

    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerEnd);
    this.canvas.addEventListener("pointercancel", this.handlePointerEnd);

    this.fileInput.addEventListener("change", this.handleFileChange);
    this.thresholdSlider.addEventListener("input", this.handleThresholdInput);
    this.liveAutoFlattenToggle.addEventListener("change", () => {
      this.liveAutoFlattenEnabled = this.liveAutoFlattenToggle.checked;
      if (this.liveAutoFlattenEnabled) {
        this.pendingLiveAutoFlatten = true;
      }
      this.scheduleRender();
    });
    this.useDefaultButton.addEventListener("click", () => {
      void this.loadImageFromUrl(DEFAULT_SOURCE, "visu1.png");
    });
    this.resetViewButton.addEventListener("click", () => {
      this.centerX = this.defaults.centerX;
      this.centerY = this.defaults.centerY;
      this.angleOffset = 0;
      this.markAnalysisDirty();
      this.requestAnalysisRender();
    });
    this.smoothProfileButton.addEventListener("click", () => {
      this.profileOffset = this.smoothWrappedCurve(this.profileOffset, 4);
      this.scheduleRender();
    });
    this.zeroProfileButton.addEventListener("click", () => {
      this.profileOffset.fill(0);
      this.scheduleRender();
    });
    this.autoFlattenButton.addEventListener("click", () => {
      this.applyAutoFlatten();
    });

    this.thresholdValue.textContent = `${this.segmentationThreshold}`;
  }

  public async initialize(): Promise<void> {
    try {
      await this.loadImageFromUrl(DEFAULT_SOURCE, "visu1.png");
    } catch (error) {
      this.setStatus(`Failed to load the default image: ${this.describeError(error)}`);
    }
  }

  private readonly handleFileChange = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      const imageBitmap = await createImageBitmap(file);
      this.applyImage(imageBitmap, file.name);
      imageBitmap.close();
      input.value = "";
    } catch (error) {
      this.setStatus(`Unable to open ${file.name}: ${this.describeError(error)}`);
    }
  };

  private readonly handleThresholdInput = (): void => {
    this.segmentationThreshold = Number(this.thresholdSlider.value);
    this.thresholdValue.textContent = `${this.segmentationThreshold}`;
    this.markAnalysisDirty();
    this.requestAnalysisRender();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.fullImageData || !this.overviewImageData) {
      return;
    }

    const point = this.getCanvasPoint(event);
    this.activePointerId = event.pointerId;
    this.lastPointerX = point.x;
    this.lastPointerY = point.y;
    this.dragMode = point.x >= this.unwrapWidth ? "overview" : point.y >= this.unwrapHeight ? "profile" : "unwrap";

    this.canvas.setPointerCapture(event.pointerId);

    if (this.dragMode === "overview") {
      this.updateCenterFromCompositePoint(point.x, point.y);
    } else if (this.dragMode === "profile") {
      this.drawProfileStroke(point.x, point.y, point.x, point.y);
    }

    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    const point = this.getCanvasPoint(event);

    if (this.dragMode === "overview") {
      this.updateCenterFromCompositePoint(point.x, point.y);
    } else if (this.dragMode === "profile") {
      this.drawProfileStroke(this.lastPointerX, this.lastPointerY, point.x, point.y);
      this.lastPointerX = point.x;
      this.lastPointerY = point.y;
    } else if (this.dragMode === "unwrap") {
      this.rotateFromDrag(point.x);
    }
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    this.activePointerId = null;
    this.dragMode = null;
  };

  private async loadImageFromUrl(url: string, label: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    this.applyImage(imageBitmap, label);
    imageBitmap.close();
  }

  private applyImage(bitmap: ImageBitmap, label: string): void {
    const fullImage = this.extractImageData(bitmap);
    this.decorateSourceEdges(fullImage);

    this.fullImageData = fullImage;
    this.overviewImageData = this.downsample2x(fullImage);
    this.unwrapBuffer = null;
    this.segmentationPreviewBuffer = null;
    this.sourceName = label;

    this.sourceWidth = fullImage.width;
    this.sourceHeight = fullImage.height;
    this.overviewWidth = this.overviewImageData.width;
    this.overviewHeight = this.overviewImageData.height;
    this.unwrapHeight = Math.max(1, this.overviewHeight - this.profileHeight);
    this.defaults = this.deriveDefaults(label);

    this.profileOffset = new Float32Array(this.unwrapWidth);
    this.centerX = this.defaults.centerX;
    this.centerY = this.defaults.centerY;
    this.angleOffset = 0;
    this.rowScales = this.createRowScaleTable();
    this.fullLuma = this.createLumaBuffer(this.fullImageData);
    this.overviewLuma = this.createLumaBuffer(this.overviewImageData);
    this.markAnalysisDirty();

    this.canvas.width = this.unwrapWidth + this.overviewWidth;
    this.canvas.height = this.overviewHeight;
    this.canvas.style.aspectRatio = `${this.canvas.width} / ${this.canvas.height}`;

    this.segmentationCanvas.width = this.overviewWidth;
    this.segmentationCanvas.height = this.overviewHeight;
    this.segmentationCanvas.style.aspectRatio = `${this.overviewWidth} / ${this.overviewHeight}`;

    this.sourceBadge.textContent = `${this.sourceName} • ${this.sourceWidth}×${this.sourceHeight}`;
    this.requestAnalysisRender();
  }

  private deriveDefaults(label: string): Defaults {
    if (
      label === "visu1.png" &&
      this.sourceWidth === DEFAULT_SOURCE_SIZE.width &&
      this.sourceHeight === DEFAULT_SOURCE_SIZE.height
    ) {
      return { centerX: 100, centerY: 160, baseRadius: 960 };
    }

    return {
      centerX: Math.round(this.overviewWidth / 2),
      centerY: Math.round(this.overviewHeight / 2),
      baseRadius: Math.max(120, Math.round(this.sourceHeight * 0.92)),
    };
  }

  private createRowScaleTable(): Float64Array {
    const table = new Float64Array(this.unwrapHeight);
    for (let row = 0; row < this.unwrapHeight; row += 1) {
      const r = this.unwrapHeight - row;
      table[row] = Math.exp((4 * r) / this.sourceHeight);
    }
    return table;
  }

  private rotateFromDrag(nextX: number): void {
    const deltaColumns = Math.round(nextX - this.lastPointerX);
    if (deltaColumns === 0) {
      return;
    }

    this.rotateByColumns(deltaColumns);
    this.lastPointerX += deltaColumns;
  }

  private rotateByColumns(deltaColumns: number): void {
    const normalized = ((deltaColumns % this.unwrapWidth) + this.unwrapWidth) % this.unwrapWidth;
    if (normalized === 0) {
      return;
    }

    const rotated = new Float32Array(this.unwrapWidth);
    for (let column = 0; column < this.unwrapWidth; column += 1) {
      rotated[column] = this.profileOffset[(column + normalized) % this.unwrapWidth];
    }

    this.profileOffset = rotated;
    this.angleOffset = this.normalizeAngle(this.angleOffset + deltaColumns * (TAU / this.unwrapWidth));
    this.markAnalysisDirty();
    this.requestAnalysisRender();
  }

  private updateCenterFromCompositePoint(x: number, y: number): void {
    const localX = x - this.unwrapWidth;
    this.centerX = this.clamp(Math.round(localX), 0, Math.max(0, this.overviewWidth - 1));
    this.centerY = this.clamp(Math.round(y), 0, Math.max(0, this.overviewHeight - 1));
    this.markAnalysisDirty();
    this.requestAnalysisRender();
  }

  private drawProfileStroke(fromX: number, fromY: number, toX: number, toY: number): void {
    const startX = this.clamp(fromX, 0, this.unwrapWidth - 1);
    const endX = this.clamp(toX, 0, this.unwrapWidth - 1);
    const startLocalY = this.clamp(fromY - this.unwrapHeight, 0, this.profileHeight - 1);
    const endLocalY = this.clamp(toY - this.unwrapHeight, 0, this.profileHeight - 1);
    const steps = Math.max(1, Math.ceil(Math.abs(endX - startX)));

    let previousColumn = this.clamp(Math.round(startX), 0, this.unwrapWidth - 1);
    let previousLocalY = startLocalY;

    for (let step = 0; step <= steps; step += 1) {
      const interpolation = step / steps;
      const sampleX = startX + (endX - startX) * interpolation;
      const sampleY = startLocalY + (endLocalY - startLocalY) * interpolation;
      const column = this.clamp(Math.round(sampleX), 0, this.unwrapWidth - 1);
      this.paintProfileColumns(previousColumn, previousLocalY, column, sampleY);
      previousColumn = column;
      previousLocalY = sampleY;
    }

    this.scheduleRender();
  }

  private paintProfileColumns(fromColumn: number, fromLocalY: number, toColumn: number, toLocalY: number): void {
    if (fromColumn === toColumn) {
      this.profileOffset[fromColumn] = this.profileYToOffset(toLocalY);
      return;
    }

    const step = fromColumn < toColumn ? 1 : -1;
    const distance = Math.abs(toColumn - fromColumn);

    for (let index = 0; index <= distance; index += 1) {
      const column = fromColumn + index * step;
      const interpolation = index / distance;
      const localY = fromLocalY + (toLocalY - fromLocalY) * interpolation;
      this.profileOffset[column] = this.profileYToOffset(localY);
    }
  }

  private applyAutoFlatten(): void {
    const detection = this.getCoastDetection();
    if (!detection) {
      this.segmentationSummary.textContent = `Threshold ${this.segmentationThreshold} did not produce a stable visible shoreline from the current viewpoint.`;
      return;
    }

    this.profileOffset = detection.flattenedOffset.slice();
    this.segmentationSummary.textContent =
      `Applied visible-shore flattening at threshold ${this.segmentationThreshold}. Coast coverage ${Math.round(
        detection.coverage * 100,
      )}% with ${detection.centerIsWater ? "water" : "land"} at the current viewpoint.`;
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderQueued) {
      return;
    }

    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    if (!this.fullImageData || !this.overviewImageData) {
      return;
    }

    if (!this.unwrapBuffer || this.unwrapBuffer.width !== this.unwrapWidth || this.unwrapBuffer.height !== this.unwrapHeight) {
      this.unwrapBuffer = new ImageData(this.unwrapWidth, this.unwrapHeight);
    }

    if (this.liveAutoFlattenEnabled && this.pendingLiveAutoFlatten) {
      this.pendingLiveAutoFlatten = false;
      const detection = this.getCoastDetection();
      if (detection) {
        this.profileOffset = detection.flattenedOffset.slice();
      }
    }

    this.populateUnwrap();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.putImageData(this.unwrapBuffer, 0, 0);
    this.drawProfileStrip();
    this.context.putImageData(this.overviewImageData, this.unwrapWidth, 0);
    this.drawOverviewMarkers();
    this.drawSeparators();
    this.drawSegmentationPreview();
    this.setStatus(
      `Center ${this.centerX}, ${this.centerY} • angle ${this.angleOffset.toFixed(3)} rad • radius band ${Math.round(
        this.minRadius(),
      )}-${Math.round(this.maxRadius())}`,
    );
  }

  private populateUnwrap(): void {
    if (!this.fullImageData || !this.unwrapBuffer) {
      return;
    }

    const sourcePixels = this.fullImageData.data;
    const unwrapPixels = this.unwrapBuffer.data;
    const fullWidth = this.sourceWidth;
    const fullHeight = this.sourceHeight;
    const centerX = this.centerX * 2;
    const centerY = this.centerY * 2;

    for (let column = 0; column < this.unwrapWidth; column += 1) {
      const theta = this.baseAngles[column] + this.angleOffset;
      this.angleCos[column] = Math.cos(theta);
      this.angleSin[column] = Math.sin(theta);
      this.profileFactors[column] = Math.exp((4 * (this.defaults.baseRadius + this.profileOffset[column])) / fullHeight);
    }

    let targetIndex = 0;
    for (let row = 0; row < this.unwrapHeight; row += 1) {
      const rowRadiusFactor = 4 * this.rowScales[row];

      for (let column = 0; column < this.unwrapWidth; column += 1) {
        const radius = rowRadiusFactor * this.profileFactors[column];
        const sampleX = this.clamp(Math.round(radius * this.angleCos[column] + centerX), 0, fullWidth - 1);
        const sampleY = this.clamp(Math.round(radius * this.angleSin[column] + centerY), 0, fullHeight - 1);
        const sourceIndex = (sampleY * fullWidth + sampleX) * 4;

        unwrapPixels[targetIndex] = sourcePixels[sourceIndex];
        unwrapPixels[targetIndex + 1] = sourcePixels[sourceIndex + 1];
        unwrapPixels[targetIndex + 2] = sourcePixels[sourceIndex + 2];
        unwrapPixels[targetIndex + 3] = 255;
        targetIndex += 4;
      }
    }
  }

  private drawProfileStrip(): void {
    const top = this.unwrapHeight;
    const middle = this.profileHeight / 2;

    this.context.save();
    this.context.translate(0, top);

    this.context.fillStyle = "#0f1e2d";
    this.context.fillRect(0, 0, this.unwrapWidth, this.profileHeight);

    this.context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    this.context.lineWidth = 1;
    this.context.beginPath();
    for (let x = 0; x <= this.unwrapWidth; x += 150) {
      this.context.moveTo(x + 0.5, 0);
      this.context.lineTo(x + 0.5, this.profileHeight);
    }
    this.context.moveTo(0, this.profileHeight / 2 + 0.5);
    this.context.lineTo(this.unwrapWidth, this.profileHeight / 2 + 0.5);
    this.context.stroke();

    this.context.fillStyle = "rgba(63, 189, 125, 0.22)";
    this.context.beginPath();
    this.context.moveTo(0, middle);
    for (let column = 0; column < this.unwrapWidth; column += 1) {
      this.context.lineTo(column, this.offsetToProfileY(this.profileOffset[column]));
    }
    this.context.lineTo(this.unwrapWidth - 1, middle);
    this.context.closePath();
    this.context.fill();

    this.context.strokeStyle = "#8af3a5";
    this.context.lineWidth = 2;
    this.context.beginPath();
    for (let column = 0; column < this.unwrapWidth; column += 1) {
      const y = this.offsetToProfileY(this.profileOffset[column]);
      if (column === 0) {
        this.context.moveTo(column + 0.5, y);
      } else {
        this.context.lineTo(column + 0.5, y);
      }
    }
    this.context.stroke();

    this.context.fillStyle = "rgba(255, 255, 255, 0.75)";
    this.context.font = '600 14px "Avenir Next", "Futura", sans-serif';
    this.context.fillText("Radial baseline editor", 16, 24);
    this.context.fillStyle = "rgba(255, 255, 255, 0.52)";
    this.context.font = '500 12px "Avenir Next", "Futura", sans-serif';
    this.context.fillText(`zero offset at ${this.defaults.baseRadius}px radius`, 16, middle + 18);

    this.context.restore();
  }

  private drawOverviewMarkers(): void {
    const originX = this.unwrapWidth;
    const heading = this.normalizeAngle(this.angleOffset);

    this.context.save();
    this.context.translate(originX, 0);

    this.context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    this.context.lineWidth = 1;
    this.context.strokeRect(0.5, 0.5, this.overviewWidth - 1, this.overviewHeight - 1);

    this.context.fillStyle = "#ff53c9";
    this.context.fillRect(this.centerX - 3, this.centerY - 3, 7, 7);

    this.drawHeadingSquare(this.centerX + 9 * Math.cos(heading), this.centerY + 9 * Math.sin(heading), 5);
    this.drawHeadingSquare(this.centerX + 17 * Math.cos(heading), this.centerY + 17 * Math.sin(heading), 3);

    this.context.fillStyle = "rgba(255, 255, 255, 0.75)";
    this.context.font = '600 14px "Avenir Next", "Futura", sans-serif';
    this.context.fillText("Overview / center selector", 16, 24);

    this.context.restore();
  }

  private drawSegmentationPreview(): void {
    if (!this.overviewLuma || !this.overviewWidth || !this.overviewHeight) {
      return;
    }

    if (
      !this.segmentationPreviewBuffer ||
      this.segmentationPreviewBuffer.width !== this.overviewWidth ||
      this.segmentationPreviewBuffer.height !== this.overviewHeight
    ) {
      this.segmentationPreviewBuffer = new ImageData(this.overviewWidth, this.overviewHeight);
      this.segmentationPreviewDirty = true;
    }

    if (this.segmentationPreviewDirty) {
      const previewPixels = this.segmentationPreviewBuffer.data;

      for (let index = 0; index < this.overviewLuma.length; index += 1) {
        const previewIndex = index * 4;
        if (this.isWater(this.overviewLuma[index])) {
          previewPixels[previewIndex] = 14;
          previewPixels[previewIndex + 1] = 29;
          previewPixels[previewIndex + 2] = 39;
        } else {
          previewPixels[previewIndex] = 234;
          previewPixels[previewIndex + 1] = 220;
          previewPixels[previewIndex + 2] = 206;
        }
        previewPixels[previewIndex + 3] = 255;
      }

      this.segmentationPreviewDirty = false;
    }

    this.segmentationContext.putImageData(this.segmentationPreviewBuffer, 0, 0);
    this.segmentationContext.save();

    const center = this.getAnalysisCenter();
    const detection = this.getCoastDetection();

    this.segmentationContext.strokeStyle = "rgba(255, 255, 255, 0.24)";
    this.segmentationContext.lineWidth = 1;
    this.segmentationContext.strokeRect(0.5, 0.5, this.overviewWidth - 1, this.overviewHeight - 1);

    if (detection) {
      this.drawVisibleShoreline(detection.previewRadii, center);

      this.segmentationSummary.textContent = `Threshold ${this.segmentationThreshold} • center is ${
        detection.centerIsWater ? "water" : "land"
      } • visible shoreline coverage ${Math.round(detection.coverage * 100)}% • target unwrap row ${Math.round(
        detection.targetRow,
      )}`;
    } else {
      this.segmentationSummary.textContent = `Threshold ${this.segmentationThreshold} • no usable visible shoreline detected yet from the current viewpoint.`;
    }

    this.segmentationContext.fillStyle = "#ff53c9";
    this.segmentationContext.fillRect(center.x - 3, center.y - 3, 7, 7);

    this.segmentationContext.restore();
  }

  private drawHeadingSquare(x: number, y: number, size: number): void {
    this.context.fillRect(Math.round(x) - Math.floor(size / 2), Math.round(y) - Math.floor(size / 2), size, size);
  }

  private drawSeparators(): void {
    this.context.save();
    this.context.strokeStyle = "rgba(255, 255, 255, 0.14)";
    this.context.lineWidth = 2;

    this.context.beginPath();
    this.context.moveTo(this.unwrapWidth + 0.5, 0);
    this.context.lineTo(this.unwrapWidth + 0.5, this.canvas.height);
    this.context.moveTo(0, this.unwrapHeight + 0.5);
    this.context.lineTo(this.unwrapWidth, this.unwrapHeight + 0.5);
    this.context.stroke();

    this.context.restore();
  }

  private getCoastDetection(): CoastDetection | null {
    if (!this.fullLuma) {
      return null;
    }

    if (!this.detectionDirty) {
      return this.cachedCoastDetection;
    }

    this.cachedCoastDetection = this.computeCoastDetection();
    this.detectionDirty = false;
    return this.cachedCoastDetection;
  }

  private computeCoastDetection(): CoastDetection | null {
    if (!this.fullLuma || !this.overviewWidth || !this.overviewHeight) {
      return null;
    }

    const analysisCenter = this.getAnalysisCenter();
    const centerX = analysisCenter.x * 2;
    const centerY = analysisCenter.y * 2;
    const centerIndex = this.clamp(Math.round(centerY), 0, this.sourceHeight - 1) * this.sourceWidth +
      this.clamp(Math.round(centerX), 0, this.sourceWidth - 1);
    const centerIsWater = this.isWater(this.fullLuma[centerIndex]);
    const centerComponent = this.extractCenterComponent(centerIndex, centerIsWater);
    const filledCenterComponent = this.fillComponentHoles(centerComponent);
    const shoreline = this.buildVisibleShoreline(filledCenterComponent, centerX, centerY);
    if (!shoreline) {
      return null;
    }

    const previewRadii = new Float32Array(shoreline.radii);
    const smoothedVisibleRadii = this.smoothFiniteWrappedCurve(shoreline.radii, 2);
    const filledRadii = this.fillMissingWrappedValues(smoothedVisibleRadii);
    const smoothedRadii = this.smoothWrappedCurve(filledRadii, 4);
    const rawBaseline = new Float32Array(this.unwrapWidth);
    const valuesForMedian: number[] = [];

    for (let column = 0; column < this.unwrapWidth; column += 1) {
      const value = (this.sourceHeight / 4) * Math.log(Math.max(smoothedRadii[column], 4) / 4);
      rawBaseline[column] = value;
      valuesForMedian.push(value);
    }

    const medianRawBaseline = this.median(valuesForMedian);
    const targetRow = this.clamp(medianRawBaseline - this.defaults.baseRadius, this.unwrapHeight * 0.16, this.unwrapHeight * 0.84);
    const offset = new Float32Array(this.unwrapWidth);

    for (let column = 0; column < this.unwrapWidth; column += 1) {
      offset[column] = rawBaseline[column] - targetRow - this.defaults.baseRadius;
    }

    return {
      centerIsWater,
      coverage: shoreline.coverage,
      flattenedOffset: this.smoothWrappedCurve(offset, 6),
      previewRadii,
      targetRow,
    };
  }

  private buildVisibleShoreline(
    component: Uint8Array,
    centerX: number,
    centerY: number,
  ): { coverage: number; radii: Float32Array } | null {
    const radii = new Float32Array(this.unwrapWidth);
    radii.fill(Number.NaN);
    const minSearchRadius = 10;
    const confirmationSamples = 4;
    const maxSearchRadius = Math.ceil(
      Math.hypot(
        Math.max(centerX, this.sourceWidth - 1 - centerX),
        Math.max(centerY, this.sourceHeight - 1 - centerY),
      ),
    );

    let found = 0;

    for (let column = 0; column < this.unwrapWidth; column += 1) {
      const theta = this.baseAngles[column] + this.angleOffset;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      let streak = 0;
      let firstOutsideRadius = -1;

      for (let radius = minSearchRadius; radius <= maxSearchRadius; radius += 1) {
        const sampleX = Math.round(centerX + radius * cosTheta);
        const sampleY = Math.round(centerY + radius * sinTheta);

        if (sampleX <= 0 || sampleX >= this.sourceWidth - 1 || sampleY <= 0 || sampleY >= this.sourceHeight - 1) {
          break;
        }

        const inComponent = component[sampleY * this.sourceWidth + sampleX] === 1;
        if (!inComponent) {
          if (streak === 0) {
            firstOutsideRadius = radius;
          }
          streak += 1;

          if (streak >= confirmationSamples) {
            radii[column] = firstOutsideRadius + (confirmationSamples - 1) * 0.5;
            found += 1;
            break;
          }
        } else {
          streak = 0;
          firstOutsideRadius = -1;
        }
      }
    }

    if (found < this.unwrapWidth * 0.2) {
      return null;
    }

    const cleanedRadii = this.rejectLocalRadiusOutliers(radii, 10, 0.2);
    let coveredColumns = 0;
    for (let column = 0; column < this.unwrapWidth; column += 1) {
      if (Number.isFinite(cleanedRadii[column])) {
        coveredColumns += 1;
      }
    }

    if (coveredColumns < this.unwrapWidth * 0.2) {
      return null;
    }

    return {
      coverage: coveredColumns / this.unwrapWidth,
      radii: cleanedRadii,
    };
  }

  private extractCenterComponent(centerIndex: number, centerIsWater: boolean): Uint8Array {
    if (!this.fullLuma) {
      return new Uint8Array(0);
    }

    const pixelCount = this.fullLuma.length;
    const component = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    component[centerIndex] = 1;
    queue[tail] = centerIndex;
    tail += 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;

      const x = index % this.sourceWidth;
      const y = Math.floor(index / this.sourceWidth);

      if (x > 0) {
        tail = this.enqueueComponentNeighbor(index - 1, centerIsWater, component, queue, tail);
      }
      if (x + 1 < this.sourceWidth) {
        tail = this.enqueueComponentNeighbor(index + 1, centerIsWater, component, queue, tail);
      }
      if (y > 0) {
        tail = this.enqueueComponentNeighbor(index - this.sourceWidth, centerIsWater, component, queue, tail);
      }
      if (y + 1 < this.sourceHeight) {
        tail = this.enqueueComponentNeighbor(index + this.sourceWidth, centerIsWater, component, queue, tail);
      }
    }

    return component;
  }

  private fillComponentHoles(component: Uint8Array): Uint8Array {
    const filled = new Uint8Array(component);
    const exterior = new Uint8Array(component.length);
    const queue = new Int32Array(component.length);
    let head = 0;
    let tail = 0;

    const enqueue = (index: number): void => {
      if (filled[index] === 1 || exterior[index] === 1) {
        return;
      }
      exterior[index] = 1;
      queue[tail] = index;
      tail += 1;
    };

    for (let x = 0; x < this.sourceWidth; x += 1) {
      enqueue(x);
      enqueue((this.sourceHeight - 1) * this.sourceWidth + x);
    }

    for (let y = 0; y < this.sourceHeight; y += 1) {
      enqueue(y * this.sourceWidth);
      enqueue(y * this.sourceWidth + (this.sourceWidth - 1));
    }

    while (head < tail) {
      const index = queue[head];
      head += 1;

      const x = index % this.sourceWidth;
      const y = Math.floor(index / this.sourceWidth);

      if (x > 0) {
        enqueue(index - 1);
      }
      if (x + 1 < this.sourceWidth) {
        enqueue(index + 1);
      }
      if (y > 0) {
        enqueue(index - this.sourceWidth);
      }
      if (y + 1 < this.sourceHeight) {
        enqueue(index + this.sourceWidth);
      }
    }

    for (let index = 0; index < filled.length; index += 1) {
      if (filled[index] === 0 && exterior[index] === 0) {
        filled[index] = 1;
      }
    }

    return filled;
  }

  private enqueueComponentNeighbor(
    index: number,
    centerIsWater: boolean,
    component: Uint8Array,
    queue: Int32Array,
    tail: number,
  ): number {
    if (!this.fullLuma || component[index] === 1 || this.isWater(this.fullLuma[index]) !== centerIsWater) {
      return tail;
    }

    component[index] = 1;
    queue[tail] = index;
    return tail + 1;
  }

  private fillMissingWrappedValues(values: Float32Array): Float32Array {
    const validIndices: number[] = [];

    for (let index = 0; index < values.length; index += 1) {
      if (Number.isFinite(values[index])) {
        validIndices.push(index);
      }
    }

    if (validIndices.length === 0) {
      return new Float32Array(values.length);
    }

    if (validIndices.length === 1) {
      return new Float32Array(values.length).fill(values[validIndices[0]]);
    }

    let largestGap = -1;
    let rotationStart = validIndices[0];

    for (let segment = 0; segment < validIndices.length; segment += 1) {
      const startIndex = validIndices[segment];
      const endIndex = validIndices[(segment + 1) % validIndices.length];
      const gap = (endIndex - startIndex + values.length) % values.length - 1;

      if (gap > largestGap) {
        largestGap = gap;
        rotationStart = endIndex;
      }
    }

    const rotated = new Float32Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      rotated[index] = values[(rotationStart + index) % values.length];
    }

    const rotatedValid: number[] = [];
    for (let index = 0; index < rotated.length; index += 1) {
      if (Number.isFinite(rotated[index])) {
        rotatedValid.push(index);
      }
    }

    const filledRotated = new Float32Array(rotated);
    const firstValidIndex = rotatedValid[0];
    const lastValidIndex = rotatedValid[rotatedValid.length - 1];

    for (let index = 0; index < firstValidIndex; index += 1) {
      filledRotated[index] = rotated[firstValidIndex];
    }
    for (let index = lastValidIndex + 1; index < rotated.length; index += 1) {
      filledRotated[index] = rotated[lastValidIndex];
    }

    for (let segment = 0; segment < rotatedValid.length - 1; segment += 1) {
      const startIndex = rotatedValid[segment];
      const endIndex = rotatedValid[segment + 1];
      const startValue = rotated[startIndex];
      const endValue = rotated[endIndex];
      const distance = endIndex - startIndex;

      for (let step = 1; step < distance; step += 1) {
        const interpolation = step / distance;
        filledRotated[startIndex + step] = startValue + (endValue - startValue) * interpolation;
      }
    }

    const filled = new Float32Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      filled[(rotationStart + index) % values.length] = filledRotated[index];
    }

    return filled;
  }

  private rejectLocalRadiusOutliers(values: Float32Array, windowRadius: number, logTolerance: number): Float32Array {
    const filtered = new Float32Array(values);

    for (let column = 0; column < values.length; column += 1) {
      const value = values[column];
      if (!Number.isFinite(value)) {
        continue;
      }

      const neighbors: number[] = [];
      for (let offset = -windowRadius; offset <= windowRadius; offset += 1) {
        if (offset === 0) {
          continue;
        }
        const neighborIndex = (column + offset + values.length) % values.length;
        const neighbor = values[neighborIndex];
        if (Number.isFinite(neighbor)) {
          neighbors.push(neighbor);
        }
      }

      if (neighbors.length < 6) {
        continue;
      }

      const localMedian = this.median(neighbors);
      const logDistance = Math.abs(Math.log(value / localMedian));
      if (logDistance > logTolerance) {
        filtered[column] = Number.NaN;
      }
    }

    return filtered;
  }

  private smoothFiniteWrappedCurve(source: Float32Array, passes: number): Float32Array {
    let current = new Float32Array(source);

    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(this.unwrapWidth);
      next.fill(Number.NaN);

      for (let column = 0; column < this.unwrapWidth; column += 1) {
        let weightedSum = 0;
        let weightTotal = 0;

        for (let offset = -2; offset <= 2; offset += 1) {
          const wrappedColumn = (column + offset + this.unwrapWidth) % this.unwrapWidth;
          const value = current[wrappedColumn];
          if (!Number.isFinite(value)) {
            continue;
          }

          const weight = SMOOTH_KERNEL[offset + 2];
          weightedSum += value * weight;
          weightTotal += weight;
        }

        if (weightTotal > 0) {
          next[column] = weightedSum / weightTotal;
        }
      }

      current = next;
    }

    return current;
  }

  private smoothWrappedCurve(source: Float32Array, passes: number): Float32Array {
    let current = new Float32Array(source);

    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(this.unwrapWidth);

      for (let column = 0; column < this.unwrapWidth; column += 1) {
        let weightedSum = 0;
        let weightTotal = 0;

        for (let offset = -2; offset <= 2; offset += 1) {
          const wrappedColumn = (column + offset + this.unwrapWidth) % this.unwrapWidth;
          const weight = SMOOTH_KERNEL[offset + 2];
          weightedSum += current[wrappedColumn] * weight;
          weightTotal += weight;
        }

        next[column] = weightedSum / weightTotal;
      }

      current = next;
    }

    return current;
  }

  private getAnalysisCenter(): { x: number; y: number } {
    return {
      x: this.centerX,
      y: this.centerY,
    };
  }

  private markAnalysisDirty(): void {
    this.cachedCoastDetection = null;
    this.detectionDirty = true;
    this.segmentationPreviewDirty = true;
  }

  private requestAnalysisRender(): void {
    if (this.liveAutoFlattenEnabled) {
      this.pendingLiveAutoFlatten = true;
    }
    this.scheduleRender();
  }

  private isWater(luma: number): boolean {
    return luma <= this.segmentationThreshold;
  }

  private offsetToProfileY(offset: number): number {
    return this.clamp(this.profileHeight / 2 - offset / this.profileScale, 0, this.profileHeight);
  }

  private profileYToOffset(y: number): number {
    return (this.profileHeight / 2 - y) * this.profileScale;
  }

  private extractImageData(bitmap: ImageBitmap): ImageData {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d") ?? this.fail("Failed to create an offscreen canvas.");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  }

  private decorateSourceEdges(imageData: ImageData): void {
    const pixels = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    for (let x = 0; x < width; x += 1) {
      pixels[x * 4 + 2] = 255;
      pixels[((height - 1) * width + x) * 4 + 2] = 255;
    }

    for (let y = 0; y < height; y += 1) {
      pixels[(y * width) * 4 + 2] = 255;
      pixels[(y * width + (width - 1)) * 4 + 2] = 255;
    }
  }

  private createLumaBuffer(imageData: ImageData): Uint8Array {
    const luma = new Uint8Array(imageData.width * imageData.height);
    const pixels = imageData.data;

    for (let index = 0; index < luma.length; index += 1) {
      const pixelIndex = index * 4;
      luma[index] = Math.round(
        pixels[pixelIndex] * 0.2126 + pixels[pixelIndex + 1] * 0.7152 + pixels[pixelIndex + 2] * 0.0722,
      );
    }

    return luma;
  }

  private downsample2x(imageData: ImageData): ImageData {
    const targetWidth = Math.max(1, Math.floor(imageData.width / 2));
    const targetHeight = Math.max(1, Math.floor(imageData.height / 2));
    const target = new ImageData(targetWidth, targetHeight);
    const source = imageData.data;
    const destination = target.data;

    for (let y = 0; y < targetHeight; y += 1) {
      const topRow = y * 2;
      const bottomRow = Math.min(imageData.height - 1, topRow + 1);

      for (let x = 0; x < targetWidth; x += 1) {
        const leftColumn = x * 2;
        const rightColumn = Math.min(imageData.width - 1, leftColumn + 1);

        const topLeft = (topRow * imageData.width + leftColumn) * 4;
        const topRight = (topRow * imageData.width + rightColumn) * 4;
        const bottomLeft = (bottomRow * imageData.width + leftColumn) * 4;
        const bottomRight = (bottomRow * imageData.width + rightColumn) * 4;
        const targetIndex = (y * targetWidth + x) * 4;

        destination[targetIndex] = (source[topLeft] + source[topRight] + source[bottomLeft] + source[bottomRight]) / 4;
        destination[targetIndex + 1] =
          (source[topLeft + 1] + source[topRight + 1] + source[bottomLeft + 1] + source[bottomRight + 1]) / 4;
        destination[targetIndex + 2] =
          (source[topLeft + 2] + source[topRight + 2] + source[bottomLeft + 2] + source[bottomRight + 2]) / 4;
        destination[targetIndex + 3] = 255;
      }
    }

    return target;
  }

  private drawVisibleShoreline(radii: Float32Array, center: { x: number; y: number }): void {
    this.segmentationContext.lineJoin = "round";
    this.segmentationContext.lineCap = "round";

    const strokePolyline = (strokeStyle: string, lineWidth: number): void => {
      this.segmentationContext.strokeStyle = strokeStyle;
      this.segmentationContext.lineWidth = lineWidth;
      this.segmentationContext.beginPath();
      let drawing = false;

      for (let column = 0; column < this.unwrapWidth; column += 1) {
        const radius = radii[column];
        if (!Number.isFinite(radius)) {
          drawing = false;
          continue;
        }

        const theta = this.baseAngles[column] + this.angleOffset;
        const x = center.x + (radius * Math.cos(theta)) / 2;
        const y = center.y + (radius * Math.sin(theta)) / 2;

        if (!drawing) {
          this.segmentationContext.moveTo(x, y);
          drawing = true;
        } else {
          this.segmentationContext.lineTo(x, y);
        }
      }

      this.segmentationContext.stroke();
    };

    strokePolyline("rgba(8, 16, 22, 0.92)", 7);
    strokePolyline("#48ff00", 4.5);
  }

  private getCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  private minRadius(): number {
    let min = Number.POSITIVE_INFINITY;
    for (const offset of this.profileOffset) {
      const radius = this.defaults.baseRadius + offset;
      if (radius < min) {
        min = radius;
      }
    }
    return min;
  }

  private maxRadius(): number {
    let max = Number.NEGATIVE_INFINITY;
    for (const offset of this.profileOffset) {
      const radius = this.defaults.baseRadius + offset;
      if (radius > max) {
        max = radius;
      }
    }
    return max;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
  }

  private normalizeAngle(angle: number): number {
    return ((angle % TAU) + TAU) % TAU;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private setStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private fail(message: string): never {
    throw new Error(message);
  }
}
