"use client";

import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { uploadAndFetch } from "../utils/api";

// ====================== Audiogram Settings ==========================

const AUDIOGRAM_TICKS = [125, 250, 500, 1000, 2000, 4000, 8000];

const formatAudiogramLabel = (f) => {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
};

// ====================== Shared Hooks (Pan / Zoom / Drag / Loop) ==========================

// pan/zoom واحد على domain 1D normalized من 0 → 1
function usePanZoom1D({ minZoom = 1, maxZoom = 10, zoomFactor = 1.2 } = {}) {
  const zoomRef = useRef(1);
  const offsetRef = useRef(0); // normalized 0→1

  const clampPan = useCallback(() => {
    const zoom = Math.max(zoomRef.current, minZoom);
    const windowSize = 1 / zoom;
    let offset = offsetRef.current;

    if (offset < 0) offset = 0;
    const maxOffset = Math.max(0, 1 - windowSize);
    if (offset > maxOffset) offset = maxOffset;

    offsetRef.current = offset;
  }, [minZoom]);

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    offsetRef.current = 0;
  }, []);

  const pan = useCallback(
    (deltaNorm) => {
      const zoom = Math.max(zoomRef.current, minZoom);
      const windowSize = 1 / zoom;
      offsetRef.current += deltaNorm * windowSize;
      clampPan();
    },
    [clampPan, minZoom]
  );

  const zoomIn = useCallback(() => {
    zoomRef.current = Math.min(maxZoom, zoomRef.current * zoomFactor);
    clampPan();
  }, [clampPan, maxZoom, zoomFactor]);

  const zoomOut = useCallback(() => {
    zoomRef.current = Math.max(minZoom, zoomRef.current / zoomFactor);
    clampPan();
  }, [clampPan, minZoom, zoomFactor]);

  const getWindow = useCallback(() => {
    const zoom = Math.max(zoomRef.current, minZoom);
    const length = 1 / zoom;
    const offset = offsetRef.current;
    return { offset, length, zoom };
  }, [minZoom]);

  return { pan, zoomIn, zoomOut, resetView, getWindow };
}

// drag hook مشترك يحوّل حركة الماوس على أي canvas لـ global pan
function useGlobalPanDrag({ canvasRef, isPanning, onGlobalPanDelta }) {
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e) => {
      if (!isPanning || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      isDraggingRef.current = true;
      lastXRef.current = e.clientX - rect.left;
    },
    [canvasRef, isPanning]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!isPanning || !isDraggingRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const deltaPx = x - lastXRef.current;
      lastXRef.current = x;

      if (Math.abs(deltaPx) < 1) return;

      const deltaNorm = deltaPx / rect.width;
      if (onGlobalPanDelta) onGlobalPanDelta(deltaNorm);
    },
    [canvasRef, isPanning, onGlobalPanDelta]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  return { handleMouseDown, handleMouseMove, handleMouseUp };
}

// loop عام للـ requestAnimationFrame
function useCanvasAnimation(drawFn) {
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof drawFn !== "function") return;

    const loop = () => {
      drawFn();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [drawFn]);
}

// ===================== Signal Viewer (Time Domain) =====================

const SignalViewer = forwardRef(
  (
    {
      audioBuffer, // input raw
      data, // optional processed samples (output)
      sampleRate, // used with data
      currentTime = 0,
      wide = false,
      isPanning = false,
      onGlobalPanDelta,
    },
    ref
  ) => {
    const canvasRef = useRef(null);

    const dataRef = useRef([]);
    const sampleRateRef = useRef(44100);
    const durationRef = useRef(0);

    const currentTimeRef = useRef(0);

    const { pan, zoomIn, zoomOut, resetView, getWindow } = usePanZoom1D();
    const {
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
    } = useGlobalPanDrag({ canvasRef, isPanning, onGlobalPanDelta });

    // تحميل الداتا (input أو output) + reset view
    useEffect(() => {
      if (data && data.length && sampleRate) {
        // Output
        dataRef.current = data;
        sampleRateRef.current = sampleRate;
        durationRef.current = data.length / sampleRate;

        resetView();
        currentTimeRef.current = 0;
        return;
      }

      if (!audioBuffer) {
        dataRef.current = [];
        durationRef.current = 0;
        resetView();
        currentTimeRef.current = 0;
        return;
      }

      // Input
      const ch0 = audioBuffer.getChannelData(0);
      dataRef.current = ch0;
      sampleRateRef.current = audioBuffer.sampleRate || 44100;
      durationRef.current =
        audioBuffer.duration || ch0.length / sampleRateRef.current;

      resetView();
      currentTimeRef.current = 0;
    }, [audioBuffer, data, sampleRate, resetView]);

    // تحديث وقت الـ cursor من الـ parent
    useEffect(() => {
      currentTimeRef.current = currentTime || 0;
    }, [currentTime]);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      const arr = dataRef.current;
      const sr = sampleRateRef.current;
      const duration = durationRef.current;

      if (!canvas || !arr || arr.length === 0 || !sr || !duration) {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // ===== View Window (signal ثابتة + zoom/pan) =====
      const { offset, length } = getWindow();
      const startT = offset * duration;
      const windowSec = length * duration;
      const endT = startT + windowSec;

      const startIdx = Math.floor(startT * sr);
      const endIdx = Math.min(arr.length, Math.floor(endT * sr));
      const windowSamples = endIdx - startIdx;

      if (windowSamples <= 1) {
        return;
      }

      const stepX = width / (windowSamples - 1);

      // ===== رسم الـ waveform (ثابتة) =====
      ctx.beginPath();
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 2;

      for (let i = 0; i < windowSamples; i++) {
        const idx = startIdx + i;
        const x = i * stepX;
        const y = height / 2 - arr[idx] * (height / 3);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();

      // ===== cursor رأسي يتحرك مع الـ play =====
      const tCursor = Math.max(
        0,
        Math.min(currentTimeRef.current || 0, duration)
      );

      if (tCursor >= startT && tCursor <= endT) {
        const rel = (tCursor - startT) / Math.max(windowSec, 1e-6);
        const xCursor = rel * width;

        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.moveTo(xCursor, 0);
        ctx.lineTo(xCursor, height);
        ctx.stroke();
        ctx.restore();
      }
    }, [getWindow]);

    useCanvasAnimation(draw);

    useImperativeHandle(ref, () => ({
      // deltaNorm جاي من drag في أي graph
      pan: (deltaNorm) => {
        pan(deltaNorm);
      },
      resetView: () => {
        resetView();
      },
      zoomIn: () => {
        zoomIn();
      },
      zoomOut: () => {
        zoomOut();
      },
      setCurrentTime: (val) => {
        currentTimeRef.current = val || 0;
      },
    }));

    return (
      <div
        className={`relative bg-black/20 rounded-md border border-orange-400 ${
          wide ? "w-full" : "inline-block"
        }`}
      >
        <canvas
          ref={canvasRef}
          width={wide ? 1100 : 450}
          height={wide ? 160 : 140}
          className="block rounded-md w-full"
          style={{ cursor: isPanning ? "grab" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-orange-400">
          Time (s)
        </div>

        <div className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 -rotate-90 text-[11px] text-orange-400">
          Amplitude
        </div>

        <div className="pointer-events-none absolute top-4 bottom-6 left-2 flex flex-col justify-between text-[10px] text-gray-300">
          <span>1.0</span>
          <span>0.5</span>
          <span>0.0</span>
          <span>-0.5</span>
          <span>-1.0</span>
        </div>
      </div>
    );
  }
);

// ===================== Spectrogram Viewer =====================

const VIRIDIS_COLORS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function viridisColor(t) {
  t = Math.max(0, Math.min(1, t));

  const n = VIRIDIS_COLORS.length;
  const scaled = t * (n - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;

  if (idx >= n - 1) {
    const c = VIRIDIS_COLORS[n - 1];
    return [c[0], c[1], c[2]];
  }

  const c1 = VIRIDIS_COLORS[idx];
  const c2 = VIRIDIS_COLORS[idx + 1];

  const r = Math.round(c1[0] + (c2[0] - c1[0]) * frac);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * frac);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * frac);

  return [r, g, b];
}

const SpectrogramViewer = forwardRef(
  ({ file, wide = false, matrix = null, isPanning = false, onGlobalPanDelta }, ref) => {
    const canvasRef = useRef(null);
    const [localMatrix, setLocalMatrix] = useState(null);
    const [loading, setLoading] = useState(false);

    const offCanvasRef = useRef(null);

    const { pan, zoomIn, zoomOut, resetView, getWindow } = usePanZoom1D();
    const {
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
    } = useGlobalPanDrag({ canvasRef, isPanning, onGlobalPanDelta });

    const drawSpectrogram = () => {
      const canvas = canvasRef.current;
      const off = offCanvasRef.current;
      if (!canvas || !off) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { offset, length } = getWindow();
      const srcTotalWidth = off.width || 1;

      const srcWidth = srcTotalWidth * length;
      const srcX = offset * srcTotalWidth;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        off,
        srcX,
        0,
        srcWidth,
        off.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
    };

    // تحميل spectrogram: matrix (للأوتبوت) أو من API (للإنبوت)
    useEffect(() => {
      const canvas = canvasRef.current;

      if (matrix && Array.isArray(matrix)) {
        setLocalMatrix(matrix);
        setLoading(false);
        return;
      }

      if (!file) {
        setLocalMatrix(null);
        setLoading(false);
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      setLoading(true);
      uploadAndFetch({ file, endpoint: "spectrogram" })
        .then((data) => {
          const S_db =
            data.spectrogram || data.S_db || data.S || data.data;
          if (
            S_db &&
            Array.isArray(S_db) &&
            S_db.length > 0 &&
            Array.isArray(S_db[0])
          ) {
            setLocalMatrix(S_db);
          } else {
            setLocalMatrix(null);
          }
        })
        .catch((err) => {
          console.error("Error fetching spectrogram:", err);
          setLocalMatrix(null);
        })
        .finally(() => setLoading(false));
    }, [file, matrix]);

    // رسم الـspectrogram في canvas + offscreen
    useEffect(() => {
      if (!localMatrix) return;

      const S_db = localMatrix;
      if (
        !S_db ||
        !Array.isArray(S_db) ||
        S_db.length === 0 ||
        !Array.isArray(S_db[0]) ||
        S_db[0].length === 0
      ) {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rows = S_db.length;
      const cols = S_db[0].length;

      let vmin = -80;
      let vmax = 0;
      let range = vmax - vmin || 1;

      let dataMin = Infinity;
      let dataMax = -Infinity;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = S_db[y][x];
          if (!Number.isFinite(v)) continue;
          if (v < dataMin) dataMin = v;
          if (v > dataMax) dataMax = v;
        }
      }
      if (dataMin !== Infinity && dataMax !== -Infinity) {
        if (dataMax < -20 || dataMin > -20) {
          vmin = dataMin;
          vmax = dataMax;
          range = vmax - vmin || 1;
        }
      }

      const img = ctx.createImageData(cols, rows);

      let k = 0;
      for (let y = 0; y < rows; y++) {
        const srcY = rows - 1 - y;

        for (let x = 0; x < cols; x++) {
          let raw = S_db[srcY][x];

          if (!Number.isFinite(raw)) raw = vmin;

          if (raw < vmin) raw = vmin;
          if (raw > vmax) raw = vmax;

          const norm = (raw - vmin) / range;

          const [r, g, b] = viridisColor(norm);

          img.data[k++] = r;
          img.data[k++] = g;
          img.data[k++] = b;
          img.data[k++] = 255;
        }
      }

      let off = offCanvasRef.current;
      if (!off || off.width !== cols || off.height !== rows) {
        off = document.createElement("canvas");
        off.width = cols;
        off.height = rows;
        offCanvasRef.current = off;
      }
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      offCtx.putImageData(img, 0, 0);

      resetView();
      drawSpectrogram();
    }, [localMatrix, resetView]);

    useImperativeHandle(ref, () => ({
      pan: (deltaNorm) => {
        pan(deltaNorm);
        drawSpectrogram();
      },
      resetView: () => {
        resetView();
        drawSpectrogram();
      },
      zoomIn: () => {
        zoomIn();
        drawSpectrogram();
      },
      zoomOut: () => {
        zoomOut();
        drawSpectrogram();
      },
      setCurrentTime: () => {},
    }));

    const hasData = !!localMatrix;

    return (
      <div
        className={`relative bg-black/20 rounded-md border border-sky-400 ${
          wide ? "w-full" : "inline-block"
        }`}
      >
        <canvas
          ref={canvasRef}
          width={wide ? 1100 : 450}
          height={wide ? 160 : 140}
          className="block rounded-md w-full"
          style={{ cursor: isPanning ? "grab" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {!matrix && !file && !hasData && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            Choose a file to display the spectrogram
          </div>
        )}

        {file && !matrix && !hasData && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            {loading
              ? "Computing spectrogram..."
              : "Waiting for spectrogram data"}
          </div>
        )}

        {hasData && (
          <>
            <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-sky-300">
              Time (s)
            </div>

            <div className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 -rotate-90 text-[11px] text-sky-300">
              Frequency (Hz)
            </div>

            <div className="pointer-events-none absolute bottom-4 left-8 right-6 flex justify-between text-[10px] text-gray-300">
              <span>0</span>
              <span>0.5</span>
              <span>1.0</span>
              <span>1.5</span>
              <span>2.0</span>
            </div>

            <div className="pointer-events-none absolute top-4 bottom-6 left-2 flex flex-col justify-between text-[10px] text-gray-300">
              <span>8k</span>
              <span>6k</span>
              <span>4k</span>
              <span>2k</span>
              <span>0</span>
            </div>
          </>
        )}
      </div>
    );
  }
);

// ===================== Frequency Viewer =====================

const FrequencyViewer = forwardRef(
  (
    {
      file,
      wide = false,
      fftData = null,
      nyquistOverride,
      isPanning = false,
      onGlobalPanDelta,
    },
    ref
  ) => {
    const canvasRef = useRef(null);

    const dataRef = useRef([]);

    const { pan, zoomIn, zoomOut, resetView, getWindow } = usePanZoom1D();

    const bandsRef = useRef([]);
    const nyquistRef = useRef(22050);

    const [scaleMode, setScaleMode] = useState("Linear");
    const scaleModeRef = useRef("Linear");
    scaleModeRef.current = scaleMode;

    const isDraggingRef = useRef(false);
    const dragModeRef = useRef(null);
    const activeBandIndexRef = useRef(-1);
    const dragStartXRef = useRef(0);
    const dragStartBandRef = useRef(null);
    const dragStartFreqRef = useRef(0);

    const isPanningRef = useRef(false);
    const onGlobalPanDeltaRef = useRef(null);

    useEffect(() => {
      isPanningRef.current = isPanning;
    }, [isPanning]);

    useEffect(() => {
      onGlobalPanDeltaRef.current = onGlobalPanDelta;
    }, [onGlobalPanDelta]);

    useEffect(() => {
      resetView();
    }, [scaleMode, resetView]);

    useEffect(() => {
      if (typeof nyquistOverride === "number" && nyquistOverride > 0) {
        nyquistRef.current = nyquistOverride;
      }
    }, [nyquistOverride]);

    const getAudiogramRange = () => {
      const nyq = nyquistRef.current || 1;
      const fmin = Math.max(AUDIOGRAM_TICKS[0], 1);
      const fmaxTick = AUDIOGRAM_TICKS[AUDIOGRAM_TICKS.length - 1];
      const fmaxClamped = Math.min(fmaxTick, nyq);
      const safeFmax = fmaxClamped > fmin ? fmaxClamped : fmin * 2;
      return { fmin, fmax: safeFmax };
    };

    const freqToNorm = (freq) => {
      const mode = scaleModeRef.current;
      const nyq = nyquistRef.current || 1;

      if (mode === "Audiogram") {
        const { fmin, fmax } = getAudiogramRange();
        const clamped = Math.min(Math.max(freq, fmin), fmax);
        const xmin = Math.log10(fmin);
        const xmax = Math.log10(fmax);
        const xf = Math.log10(clamped);
        const norm = (xf - xmin) / Math.max(xmax - xmin, 1e-6);
        return Math.max(0, Math.min(norm, 1));
      } else {
        const clamped = Math.min(Math.max(freq, 0), nyq);
        return nyq > 0 ? clamped / nyq : 0;
      }
    };

    const normToFreq = (norm) => {
      const mode = scaleModeRef.current;
      const nyq = nyquistRef.current || 1;
      const n = Math.max(0, Math.min(norm, 1));

      if (mode === "Audiogram") {
        const { fmin, fmax } = getAudiogramRange();
        const xmin = Math.log10(fmin);
        const xmax = Math.log10(fmax);
        const xf = xmin + n * (xmax - xmin);
        const freq = Math.pow(10, xf);
        return Math.max(fmin, Math.min(freq, fmax));
      } else {
        return n * nyq;
      }
    };

    const freqToCanvasX = (freq, width) => {
      const { offset, length } = getWindow();
      if (length <= 0) return 0;

      const s = freqToNorm(freq);
      const t = (s - offset) / length;
      return t * width;
    };

    const canvasXToNorm = (x, width) => {
      const { offset, length } = getWindow();
      if (length <= 0) return 0;

      const t = x / Math.max(width, 1e-6);
      return offset + t * length;
    };

    const canvasXToFreq = (x, width) => {
      const norm = canvasXToNorm(x, width);
      return normToFreq(norm);
    };

    // Load FFT data (Output لو موجود، غير كده Input)
    useEffect(() => {
      if (fftData && fftData.length) {
        dataRef.current = Array.from(fftData);
        return;
      }

      if (!file) {
        dataRef.current = [];
        return;
      }

      uploadAndFetch({ file, endpoint: "fft" }).then((data) => {
        dataRef.current = data.fft_magnitude || [];
      });
    }, [file, fftData]);

    // استلام Bands من Panel
    useEffect(() => {
      const handleBandsFromPanel = (evt) => {
        const detail = evt.detail || {};
        if (typeof detail.nyquist === "number") {
          nyquistRef.current = detail.nyquist;
        }
        if (Array.isArray(detail.bands)) {
          bandsRef.current = detail.bands.map((b, i) => ({
            label: b.label || `Band ${i + 1}`,
            start: typeof b.start === "number" ? b.start : 0,
            end: typeof b.end === "number" ? b.end : 0,
            gain: typeof b.gain === "number" ? b.gain : 1,
          }));
        }
      };

      if (typeof window !== "undefined") {
        window.addEventListener(
          "equalizerBandsUpdateFromPanel",
          handleBandsFromPanel
        );
        return () => {
          window.removeEventListener(
            "equalizerBandsUpdateFromPanel",
            handleBandsFromPanel
          );
        };
      }
    }, []);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const fft = dataRef.current;
      if (fft.length > 0) {
        let maxVal = 1;
        for (let i = 0; i < fft.length; i++) {
          if (fft[i] > maxVal) maxVal = fft[i];
        }

        ctx.beginPath();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;

        const len = fft.length;
        const nyq = nyquistRef.current || 1;
        const denom = Math.max(len - 1, 1);

        let started = false;
        for (let i = 0; i < len; i++) {
          const freq = (i / denom) * nyq;
          const x = freqToCanvasX(freq, width);
          if (x < -2 || x > width + 2) continue;

          const y = height - (fft[i] * height) / maxVal;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      }

      const bands = bandsRef.current;
      if (bands && bands.length) {
        const knobRadius = 7;

        bands.forEach((b, idx) => {
          let xStart = freqToCanvasX(b.start, width);
          let xEnd = freqToCanvasX(b.end, width);
          if (xEnd < xStart) {
            const tmp = xStart;
            xStart = xEnd;
            xEnd = tmp;
          }

          if (xEnd <= 0 || xStart >= width) return;

          const drawStart = Math.max(xStart, 0);
          const drawEnd = Math.min(xEnd, width);
          const drawWidth = Math.max(drawEnd - drawStart, 1);

          ctx.save();

          const alpha = 0.1 + (idx % 3) * 0.05;
          ctx.fillStyle = `rgba(249, 115, 22, ${alpha})`;
          ctx.fillRect(drawStart, 0, drawWidth, height);

          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 2;
          ctx.strokeRect(xStart, 0, xEnd - xStart, height);

          // left line + knob
          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(xStart, 0);
          ctx.lineTo(xStart, height);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(xStart, height / 2, knobRadius, 0, 2 * Math.PI);
          ctx.fillStyle = "#f97316";
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.stroke();

          // right line + knob
          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(xEnd, 0);
          ctx.lineTo(xEnd, height);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(xEnd, height / 2, knobRadius, 0, 2 * Math.PI);
          ctx.fillStyle = "#f97316";
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.stroke();

          // label
          ctx.fillStyle = "#f97316";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(b.label || `B${idx + 1}`, (xStart + xEnd) / 2, 12);

          ctx.restore();
        });
      }
    }, [getWindow]);

    useCanvasAnimation(draw);

    // Drag & hover + Global Pan + Band Editing
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const handleZone = 10;

      const getX = (evt) => {
        const rect = canvas.getBoundingClientRect();
        return evt.clientX - rect.left;
      };

      const pickRegion = (x, width) => {
        const bands = bandsRef.current;
        let pickedIndex = -1;
        let pickedMode = null;

        for (let i = bands.length - 1; i >= 0; i--) {
          const b = bands[i];
          let xStart = freqToCanvasX(b.start, width);
          let xEnd = freqToCanvasX(b.end, width);
          if (xEnd < xStart) {
            const tmp = xStart;
            xStart = xEnd;
            xEnd = tmp;
          }

          if (x >= xStart - handleZone && x <= xStart + handleZone) {
            pickedIndex = i;
            pickedMode = "left";
            break;
          } else if (x >= xEnd - handleZone && x <= xEnd + handleZone) {
            pickedIndex = i;
            pickedMode = "right";
            break;
          } else if (x > xStart + handleZone && x < xEnd - handleZone) {
            pickedIndex = i;
            pickedMode = "move";
            break;
          }
        }

        return { pickedIndex, pickedMode };
      };

      const handleDown = (evt) => {
        const width = canvas.width;
        const x = getX(evt);

        // لو pan mode شغال → نستخدم الـ drag ده للـ global pan
        if (isPanningRef.current) {
          isDraggingRef.current = true;
          dragModeRef.current = "global-pan";
          dragStartXRef.current = x;
          canvas.style.cursor = "grabbing";
          evt.preventDefault();
          return;
        }

        const { pickedIndex, pickedMode } = pickRegion(x, width);
        if (pickedIndex === -1) return;

        isDraggingRef.current = true;
        dragModeRef.current = pickedMode;
        activeBandIndexRef.current = pickedIndex;
        dragStartXRef.current = x;
        dragStartBandRef.current = { ...bandsRef.current[pickedIndex] };
        dragStartFreqRef.current = canvasXToFreq(x, width);
        canvas.style.cursor = pickedMode === "move" ? "grabbing" : "ew-resize";

        evt.preventDefault();
      };

      const handleMove = (evt) => {
        const width = canvas.width;
        const x = getX(evt);

        if (!isDraggingRef.current) {
          if (isPanningRef.current) {
            canvas.style.cursor = "grab";
            return;
          }

          const { pickedIndex, pickedMode } = pickRegion(x, width);
          if (pickedIndex === -1) {
            canvas.style.cursor = "default";
          } else if (pickedMode === "move") {
            canvas.style.cursor = "grab";
          } else {
            canvas.style.cursor = "ew-resize";
          }
          return;
        }

        // global pan mode
        if (dragModeRef.current === "global-pan" && isPanningRef.current) {
          const deltaPx = x - dragStartXRef.current;
          dragStartXRef.current = x;

          if (Math.abs(deltaPx) >= 1) {
            const deltaNorm = deltaPx / width;
            const cb = onGlobalPanDeltaRef.current;
            if (cb) cb(deltaNorm);
          }
          return;
        }

        // band editing mode
        const index = activeBandIndexRef.current;
        const baseBand = dragStartBandRef.current;
        if (index < 0 || !baseBand) return;

        const nyquist = nyquistRef.current || 1;
        const minWidth = nyquist / 200;

        const currentFreq = canvasXToFreq(x, width);
        const startFreqAtDown = dragStartFreqRef.current;

        let newStart = baseBand.start;
        let newEnd = baseBand.end;
        const mode = dragModeRef.current;

        if (mode === "move") {
          const deltaFreq = currentFreq - startFreqAtDown;
          newStart = baseBand.start + deltaFreq;
          newEnd = baseBand.end + deltaFreq;
        } else if (mode === "left") {
          newStart = currentFreq;
        } else if (mode === "right") {
          newEnd = currentFreq;
        }

        if (newStart > newEnd) {
          const tmp = newStart;
          newStart = newEnd;
          newEnd = tmp;
        }

        if (newStart < 0) {
          const shift = -newStart;
          newStart += shift;
          newEnd += shift;
        }
        if (newEnd > nyquist) {
          const shift = newEnd - nyquist;
          newStart -= shift;
          newEnd -= shift;
        }

        if (newEnd - newStart < minWidth) {
          const mid = (newStart + newEnd) / 2;
          newStart = mid - minWidth / 2;
          newEnd = mid + minWidth / 2;
          if (newStart < 0) {
            newStart = 0;
            newEnd = minWidth;
          }
          if (newEnd > nyquist) {
            newEnd = nyquist;
            newStart = nyquist - minWidth;
          }
        }

        const bands = [...bandsRef.current];
        bands[index] = { ...bands[index], start: newStart, end: newEnd };
        bandsRef.current = bands;

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("equalizerBandsUpdateFromViewer", {
              detail: { bands, nyquist },
            })
          );
        }
      };

      const handleUp = () => {
        isDraggingRef.current = false;
        dragModeRef.current = null;
        activeBandIndexRef.current = -1;
        dragStartBandRef.current = null;
        canvas.style.cursor = isPanningRef.current ? "grab" : "default";
      };

      canvas.addEventListener("mousedown", handleDown);
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      canvas.addEventListener("mouseleave", handleUp);

      return () => {
        canvas.removeEventListener("mousedown", handleDown);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        canvas.removeEventListener("mouseleave", handleUp);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      pan: (deltaNorm) => pan(deltaNorm),
      resetView: () => resetView(),
      zoomIn: () => zoomIn(),
      zoomOut: () => zoomOut(),
      setCurrentTime: () => {},
    }));

    const xTickLabels =
      scaleMode === "Linear"
        ? ["0", "2k", "4k", "6k", "8k", "10k"]
        : AUDIOGRAM_TICKS.map(formatAudiogramLabel);

    return (
      <div
        className={`relative bg-black/20 rounded-md border border-sky-400 ${
          wide ? "w-full" : "inline-block"
        }`}
      >
        <div className="absolute top-2 right-2 z-10 flex bg-black/60 border border-sky-500 rounded-md text-[10px] overflow-hidden">
          <button
            type="button"
            onClick={() => setScaleMode("Linear")}
            className={`px-2 py-1 ${
              scaleMode === "Linear"
                ? "bg-sky-500/80 text-white"
                : "text-sky-200 hover:bg-sky-500/20"
            }`}
          >
            Linear
          </button>
          <button
            type="button"
            onClick={() => setScaleMode("Audiogram")}
            className={`px-2 py-1 border-l border-sky-500/60 ${
              scaleMode === "Audiogram"
                ? "bg-sky-500/80 text-white"
                : "text-sky-200 hover:bg-sky-500/20"
            }`}
          >
            Audiogram
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={wide ? 1100 : 450}
          height={wide ? 160 : 140}
          className="block rounded-md w-full"
        />

        <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-sky-300">
          {scaleMode === "Linear" ? "Frequency (Hz)" : "Frequency (Audiogram)"}
        </div>

        <div className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 -rotate-90 text-[11px] text-sky-300">
          Amplitude (dB)
        </div>

        <div className="pointer-events-none absolute bottom-4 left-8 right-6 flex justify-between text-[10px] text-gray-300">
          {xTickLabels.map((lab) => (
            <span key={lab}>{lab}</span>
          ))}
        </div>

        <div className="pointer-events-none absolute top-4 bottom-6 left-2 flex flex-col justify-between text-[10px] text-gray-300">
          <span>0</span>
          <span>-20</span>
          <span>-40</span>
          <span>-60</span>
          <span>-80</span>
        </div>
      </div>
    );
  }
);

export { SignalViewer, FrequencyViewer, SpectrogramViewer };
