"use client";

import React, { useState, useEffect, useRef } from "react";
import { handleFileUpload } from "../utils/fileUpload";
import {
  SignalViewer,
  FrequencyViewer,
  SpectrogramViewer,
} from "./signal-viewer";

// ===================== Reusable Graph Card =====================

function SignalGraph({ title, children }) {
  return (
    <div className="rounded-xl shadow-lg p-3 border border-gray-700 bg-gradient-to-b from-[#1a1a1a]/90 via-[#2c2c2c]/60 to-[#1a1a1a]/80 backdrop-blur-md">
      <h2 className="text-center font-bold text-lg mb-3 text-orange-400">
        {title}
      </h2>
      <div className="bg-black/20 rounded-md flex items-center justify-center p-2 w-full">
        {children}
      </div>
    </div>
  );
}

// ===================== DSP Helpers =====================

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function reverseBits(x, bits) {
  let y = 0;
  for (let i = 0; i < bits; i++) {
    y = (y << 1) | (x & 1);
    x >>= 1;
  }
  return y;
}

function fftRadix2(re, im) {
  const n = re.length;
  if (n !== im.length) throw new Error("FFT: re/im length mismatch");
  const levels = Math.log2(n);
  if (Math.floor(levels) !== levels) {
    throw new Error("FFT length must be power of 2");
  }

  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, levels);
    if (j > i) {
      const tre = re[i];
      const tim = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tre;
      im[j] = tim;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const k = i + j;
        const l = k + half;
        const angle = -j * step;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const tre = re[l] * cos - im[l] * sin;
        const tim = re[l] * sin + im[l] * cos;
        re[l] = re[k] - tre;
        im[l] = im[k] - tim;
        re[k] += tre;
        im[k] += tim;
      }
    }
  }
}

function ifftRadix2(re, im) {
  const n = re.length;
  if (n !== im.length) throw new Error("IFFT: re/im length mismatch");

  for (let i = 0; i < n; i++) {
    im[i] = -im[i];
  }

  fftRadix2(re, im);

  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

// ✅ robust EQ: يشتغل على أي start/end/gain (continuous 0→2)
function applyBandsToSignal(samples, sampleRate, bands) {
  if (!samples || !samples.length || !sampleRate) return null;

  const n0 = samples.length;
  const N = nextPow2(n0);

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  re.set(samples);

  fftRadix2(re, im);

  const half = Math.floor(N / 2);
  const nyquist = sampleRate / 2;

  // نحضّر bands بقيم gain continuous [0,2]
  const cleanBands = Array.isArray(bands)
    ? bands.map((b, i) => {
        let g = typeof b.gain === "number" ? b.gain : 1;
        if (!Number.isFinite(g)) g = 1;
        g = Math.max(0, Math.min(2, g)); // clamp

        let f1 =
          typeof b.start === "number" && Number.isFinite(b.start)
            ? b.start
            : 0;
        let f2 =
          typeof b.end === "number" && Number.isFinite(b.end)
            ? b.end
            : nyquist;

        if (f1 > f2) {
          const tmp = f1;
          f1 = f2;
          f2 = tmp;
        }

        f1 = Math.max(0, Math.min(f1, nyquist));
        f2 = Math.max(0, Math.min(f2, nyquist));

        return {
          label: b.label || `Band ${i + 1}`,
          start: f1,
          end: f2,
          gain: g,
        };
      })
    : [];

  if (!cleanBands.length) {
    const outNoEq = new Float32Array(n0);
    outNoEq.set(samples);
    return outNoEq;
  }

  // 👇 هنا بنستخدم gain continuous
  for (let k = 0; k <= half; k++) {
    const freq = (k * sampleRate) / N;

    let scale = 1;
    for (let i = 0; i < cleanBands.length; i++) {
      const b = cleanBands[i];
      if (freq >= b.start && freq <= b.end) {
        if (b.gain === 0) {
          // band قافل تمامًا
          scale = 0;
          break;
        } else {
          // نضرب الـ gains لبعض لو فيه overlap (مع clamp بعدين)
          scale *= b.gain;
        }
      }
    }

    // clamp النتيجة النهائية في [0, 2]
    if (scale < 0) scale = 0;
    if (scale > 2) scale = 2;

    if (scale !== 1) {
      re[k] *= scale;
      im[k] *= scale;
      if (k > 0 && k < N / 2) {
        const mirror = N - k;
        re[mirror] *= scale;
        im[mirror] *= scale;
      }
    }
  }

  ifftRadix2(re, im);

  const out = new Float32Array(n0);
  for (let i = 0; i < n0; i++) out[i] = re[i];

  // Normalize لو خرجت برا [-1,1]
  let maxAbs = 0;
  for (let i = 0; i < n0; i++) {
    const v = Math.abs(out[i]);
    if (v > maxAbs) maxAbs = v;
  }
  if (maxAbs > 1) {
    const s = 1 / maxAbs;
    for (let i = 0; i < n0; i++) out[i] *= s;
  }

  return out;
}

function computeFFTMag(samples, sampleRate) {
  if (!samples || !samples.length || !sampleRate) return null;

  const n0 = samples.length;
  const N = nextPow2(n0);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  re.set(samples);

  fftRadix2(re, im);

  const half = Math.floor(N / 2);
  const mag = new Float32Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const rr = re[k];
    const ii = im[k];
    mag[k] = Math.sqrt(rr * rr + ii * ii);
  }

  return { mag, nyquist: sampleRate / 2 };
}

function computeSpectrogram(samples, sampleRate) {
  if (!samples || !samples.length || !sampleRate) return null;

  const n0 = samples.length;
  let winSize = 1024;
  if (n0 < winSize) winSize = nextPow2(n0);
  const hop = Math.max(1, Math.floor(winSize / 4));
  const numFrames = 1 + Math.max(0, Math.floor((n0 - winSize) / hop));
  const numBins = Math.floor(winSize / 2) + 1;

  const window = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (winSize - 1));
  }

  const spec = [];
  for (let b = 0; b < numBins; b++) {
    spec.push(new Array(numFrames).fill(-80));
  }

  const re = new Float32Array(winSize);
  const im = new Float32Array(winSize);

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hop;

    for (let i = 0; i < winSize; i++) {
      const idx = offset + i;
      const s = idx < n0 ? samples[idx] : 0;
      re[i] = s * window[i];
      im[i] = 0;
    }

    fftRadix2(re, im);

    for (let k = 0; k < numBins; k++) {
      const rr = re[k];
      const ii = im[k];
      const mag = Math.sqrt(rr * rr + ii * ii);
      let db = 20 * Math.log10(mag + 1e-8);
      if (db < -80) db = -80;
      if (db > 0) db = 0;
      spec[k][frame] = db;
    }
  }

  return spec;
}

// ========================= Layout Component =============================

export default function LayoutMode({
  mode,
  fileInfo,
  audioBuffer,
  currentTime,
  signalViewerRef,
  onFileUploaded,
  isPanning = false,
  onGlobalPanDelta,
}) {
  const hasFile = !!fileInfo;
  const file = hasFile ? fileInfo.file : null;

  const originalSamplesRef = useRef(null);

  const [sampleRateState, setSampleRateState] = useState(null);
  const [outputSamples, setOutputSamples] = useState(null);
  const [outputFFT, setOutputFFT] = useState(null);
  const [outputSpectrogram, setOutputSpectrogram] = useState(null);
  const [hasEQApplied, setHasEQApplied] = useState(false);

  const [showSpectrograms, setShowSpectrograms] = useState(true);

  const inputTimeRef = useRef(null);
  const outputTimeRef = useRef(null);
  const freqRef = useRef(null);
  const specInRef = useRef(null);
  const specOutRef = useRef(null);

  // توحيد التحكم في كل الجرافات من خلال signalViewerRef
  useEffect(() => {
    if (!signalViewerRef) return;

    signalViewerRef.current = {
      pan: (delta) => {
        inputTimeRef.current?.pan?.(delta);
        outputTimeRef.current?.pan?.(delta);
        freqRef.current?.pan?.(delta);
        specInRef.current?.pan?.(delta);
        specOutRef.current?.pan?.(delta);
      },
      resetView: () => {
        inputTimeRef.current?.resetView?.();
        outputTimeRef.current?.resetView?.();
        freqRef.current?.resetView?.();
        specInRef.current?.resetView?.();
        specOutRef.current?.resetView?.();
      },
      zoomIn: () => {
        inputTimeRef.current?.zoomIn?.();
        outputTimeRef.current?.zoomIn?.();
        freqRef.current?.zoomIn?.();
        specInRef.current?.zoomIn?.();
        specOutRef.current?.zoomIn?.();
      },
      zoomOut: () => {
        inputTimeRef.current?.zoomOut?.();
        outputTimeRef.current?.zoomOut?.();
        freqRef.current?.zoomOut?.();
        specInRef.current?.zoomOut?.();
        specOutRef.current?.zoomOut?.();
      },
      setCurrentTime: (t) => {
        inputTimeRef.current?.setCurrentTime?.(t);
        outputTimeRef.current?.setCurrentTime?.(t);
      },
    };
  }, [signalViewerRef]);

  // ملف جديد → reset
  useEffect(() => {
    if (!audioBuffer) {
      originalSamplesRef.current = null;
      setSampleRateState(null);
      setOutputSamples(null);
      setOutputFFT(null);
      setOutputSpectrogram(null);
      setHasEQApplied(false);

      if (typeof window !== "undefined") {
        window.__equalizerOutputData = null;
      }
      return;
    }

    const sr = audioBuffer.sampleRate || 44100;
    const ch0 = audioBuffer.getChannelData(0);
    const copy = new Float32Array(ch0.length);
    copy.set(ch0);

    originalSamplesRef.current = copy;
    setSampleRateState(sr);
    setOutputSamples(null);
    setOutputFFT(null);
    setOutputSpectrogram(null);
    setHasEQApplied(false);

    if (typeof window !== "undefined") {
      window.__equalizerOutputData = null;
    }
  }, [audioBuffer]);

  //automatic apply EQ
  useEffect(() => {
    const handleApply = (evt) => {
      if (!originalSamplesRef.current || !sampleRateState) return;

      const detail = evt.detail || {};
      const rawBands = Array.isArray(detail.bands) ? detail.bands : [];
      const nyquist = sampleRateState / 2;

      const bands = rawBands.map((b, i) => {
        let g =
          typeof b.gain === "number" && Number.isFinite(b.gain)
            ? b.gain
            : 1;
        // continuous gain في الرينج [0,2]
        g = Math.max(0, Math.min(2, g));

        let f1 =
          typeof b.start === "number" && Number.isFinite(b.start)
            ? b.start
            : 0;
        let f2 =
          typeof b.end === "number" && Number.isFinite(b.end)
            ? b.end
            : nyquist;

        if (f1 > f2) {
          const tmp = f1;
          f1 = f2;
          f2 = tmp;
        }

        f1 = Math.max(0, Math.min(f1, nyquist));
        f2 = Math.max(0, Math.min(f2, nyquist));

        return {
          label: b.label || `Band ${i + 1}`,
          start: f1,
          end: f2,
          gain: g,
        };
      });

      const processed = applyBandsToSignal(
        originalSamplesRef.current,
        sampleRateState,
        bands
      );
      if (!processed) return;

      setOutputSamples(processed);
      setHasEQApplied(true);

      const fft = computeFFTMag(processed, sampleRateState);
      setOutputFFT(fft ? fft.mag : null);

      const spec = computeSpectrogram(processed, sampleRateState);
      setOutputSpectrogram(spec);

      if (typeof window !== "undefined") {
        window.__equalizerOutputData = {
          samples: processed,
          sampleRate: sampleRateState,
        };
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("equalizerApply", handleApply);
      return () => window.removeEventListener("equalizerApply", handleApply);
    }
  }, [sampleRateState]);

  const nyquist =
    typeof sampleRateState === "number" ? sampleRateState / 2 : undefined;

  // spectrogram grid layout
  const gridClass = showSpectrograms
    ? "grid grid-cols-1 xl:grid-cols-2 gap-4 w-full max-w-7xl"
    : "grid grid-cols-1 gap-4 w-full max-w-7xl";

  return (
    <div className="flex flex-col items-center p-3 w-full max-w-7xl text-white">
      {/* زرار اختيار ملف */}
      <label className="fixed top-4 right-4 flex items-center space-x-2 bg-gradient-to-r from-orange-400 to-gray-500 px-4 py-1 rounded-md shadow-md hover:from-orange-500 hover:to-gray-600 cursor-pointer text-sm">
        <span className="text-xl font-bold">+</span>
        <span>Choose File</span>
        <input
          type="file"
          accept=".wav,.mp3"
          onChange={(e) => handleFileUpload(e, onFileUploaded)}
          className="hidden"
        />
      </label>

      {/* Toggle Spectrograms */}
      <div className="w-full max-w-7xl flex items-center justify-end -mt-3 mb-3">
        <button
          type="button"
          onClick={() => setShowSpectrograms((prev) => !prev)}
          className="flex items-center gap-2 px-3 py-1 rounded-md bg-black/50 border border-gray-600 text-xs text-gray-200 hover:bg-black/70"
        >
          <span className="text-orange-400 font-semibold">
            {showSpectrograms ? "Hide Spectrograms" : "Show Spectrograms"}
          </span>
        </button>
      </div>

      {/* جريد الجرافات */}
      <div className={gridClass}>
        {/* Left Column: Time Domain (Input + Output) */}
        <div className="flex flex-col gap-4">
          {/* Input Time */}
          <SignalGraph title="Input Time Domain">
            {audioBuffer ? (
              <SignalViewer
                ref={inputTimeRef}
                audioBuffer={audioBuffer}
                currentTime={currentTime}
                wide
                isPanning={isPanning}
                onGlobalPanDelta={onGlobalPanDelta}
              />
            ) : (
              <p className="text-orange-400 text-center text-sm">
                Choose a file to display the input signal
              </p>
            )}
          </SignalGraph>

          {/* Output Time */}
          <SignalGraph title="Output Time Domain">
            {!audioBuffer ? (
              <p className="text-orange-400 text-sm">
                Upload a file to enable output view
              </p>
            ) : !hasEQApplied || !outputSamples ? (
              <p className="text-orange-400 text-sm">
                Adjust bands or sliders to see the processed output signal in
                real time
              </p>
            ) : (
              <SignalViewer
                ref={outputTimeRef}
                data={outputSamples}
                sampleRate={sampleRateState || audioBuffer.sampleRate}
                currentTime={currentTime}
                wide
                isPanning={isPanning}
                onGlobalPanDelta={onGlobalPanDelta}
              />
            )}
          </SignalGraph>
        </div>

        {/* Right Column */}
        {showSpectrograms ? (
          <>
            {/* Spectrograms Column */}
            <div className="flex flex-col gap-4">
              {/* Spectrogram Input */}
              <SignalGraph title="Spectrogram Input">
                {hasFile ? (
                  <SpectrogramViewer
                    ref={specInRef}
                    file={file}
                    wide
                    isPanning={isPanning}
                    onGlobalPanDelta={onGlobalPanDelta}
                  />
                ) : (
                  <p className="text-orange-400 text-center text-sm">
                    Choose a file to display the input spectrogram
                  </p>
                )}
              </SignalGraph>

              {/* Spectrogram Output */}
              <SignalGraph title="Spectrogram Output">
                {!audioBuffer ? (
                  <p className="text-orange-400 text-sm">
                    Upload a file to enable output spectrogram
                  </p>
                ) : !hasEQApplied || !outputSpectrogram ? (
                  <p className="text-orange-400 text-sm">
                    Adjust bands or sliders to update the output spectrogram in
                    real time
                  </p>
                ) : (
                  <SpectrogramViewer
                    ref={specOutRef}
                    matrix={outputSpectrogram}
                    wide
                    isPanning={isPanning}
                    onGlobalPanDelta={onGlobalPanDelta}
                  />
                )}
              </SignalGraph>
            </div>

            {/* Frequency Domain (full width under both columns on xl) */}
            <div className="xl:col-span-2">
              <SignalGraph title="Frequency Domain">
                {hasFile ? (
                  <FrequencyViewer
                    ref={freqRef}
                    file={file}
                    wide
                    fftData={hasEQApplied && outputFFT ? outputFFT : null}
                    nyquistOverride={nyquist}
                    isPanning={isPanning}
                    onGlobalPanDelta={onGlobalPanDelta}
                  />
                ) : (
                  <p className="text-orange-400 text-center text-sm">
                    Choose a file to display the frequency spectrum
                  </p>
                )}
              </SignalGraph>
            </div>
          </>
        ) : (
          // ======= حالة Hide Spectrograms: Frequency تحت الـ Time فوق بعض =======
          <div className="flex flex-col gap-4">
            <SignalGraph title="Frequency Domain">
              {hasFile ? (
                <FrequencyViewer
                  ref={freqRef}
                  file={file}
                  wide
                  fftData={hasEQApplied && outputFFT ? outputFFT : null}
                  nyquistOverride={nyquist}
                  isPanning={isPanning}
                  onGlobalPanDelta={onGlobalPanDelta}
                />
              ) : (
                <p className="text-orange-400 text-center text-sm">
                  Choose a file to display the frequency spectrum
                </p>
              )}
            </SignalGraph>
          </div>
        )}
      </div>
    </div>
  );
}
