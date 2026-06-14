"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";

// ============================================
// 1) Define 2 sets of paths:
//    - HUMAN_MODE_PATHS      → used in "Human Mode"
//    - INSTRUMENT_MODE_PATHS → used in "Musical Instruments Mode"
//    Edit ONLY these arrays to point to your .wav files.
// ============================================
const HUMAN_MODE_PATHS = [
  "/audio/4_mixture_source_1.wav", // Voice 1 for Human Mode
  "/audio/4_mixture_source_2.wav", // Voice 2 for Human Mode
  "/audio/4_mixture_source_3.wav", // Voice 3 for Human Mode
  "/audio/4_mixture_source_4.wav", // Voice 4 for Human Mode
];

const INSTRUMENT_MODE_PATHS = [
  "/audio/guitar.mp3", // Voice 1 for Musical Instruments Mode
  "/audio/violin.mp3", // Voice 2 for Musical Instruments Mode
  "/audio/synth.mp3", // Voice 3 for Musical Instruments Mode
  "/audio/hihatloop101166.mp3", // Voice 4 for Musical Instruments Mode
];

// Detect current mode from a global flag or from the URL
function getCurrentMode() {
  if (typeof window === "undefined") return "human";

  // 1) Preferred: you can set this anywhere in your app when mode changes:
  //    window.__currentMode = "human" or "musical_instruments"
  if (window.__currentMode) {
    const m = String(window.__currentMode).toLowerCase();
    if (m.includes("instrument") || m.includes("music")) {
      return "musical_instruments";
    }
    return "human";
  }

  // 2) Fallback: infer from URL path if you have separate routes
  const path =
    (window.location && window.location.pathname || "").toLowerCase();
  if (path.includes("instrument") || path.includes("music")) {
    return "musical_instruments";
  }
  return "human";
}

// Return the 4 paths according to the current mode
function getPathsForCurrentMode() {
  const mode = getCurrentMode();
  if (mode === "musical_instruments") {
    return INSTRUMENT_MODE_PATHS;
  }
  return HUMAN_MODE_PATHS;
}

// =============== Helpers for audio / WAV ==================

async function decodeUrlToMono(audioCtx, url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch audio from ${url}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);

  // Take first channel as mono
  const ch0 = audioBuf.getChannelData(0);
  const samples = new Float32Array(ch0.length);
  samples.set(ch0);

  const fileName =
    url.split("/").filter(Boolean).pop() || "voice.wav";

  return {
    samples,
    sampleRate: audioBuf.sampleRate,
    fileName,
  };
}

function resampleToRate(samples, fromRate, toRate) {
  if (!samples || !samples.length) return new Float32Array(0);
  if (fromRate === toRate) {
    const copy = new Float32Array(samples.length);
    copy.set(samples);
    return copy;
  }

  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = srcPos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }

  return out;
}

function createWavBlob(samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const numChannels = 1;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");

  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ============================================
// Floating Window Component
// ============================================

export default function FloatingAIWindow() {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [mixName, setMixName] = useState("");
  const [mixUrl, setMixUrl] = useState("");
  const [isReady, setIsReady] = useState(false);

  // decoded + resampled voices
  const voicesRef = useRef(null); // [{samples, sampleRate, fileName}, ...]
  const baseRateRef = useRef(44100);

  // track last sliders state (to detect changes)
  const slidersSnapshotRef = useRef("");
  const mixUrlRef = useRef("");

  // Clean up old ObjectURL when unmount
  useEffect(() => {
    return () => {
      if (mixUrlRef.current) {
        URL.revokeObjectURL(mixUrlRef.current);
      }
    };
  }, []);

  // ===== 1) Load & decode the 4 fixed voices once (based on current mode) =====
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    const loadVoices = async () => {
      try {
        const voicePaths = getPathsForCurrentMode();

        if (!voicePaths || voicePaths.length !== 4) {
          setStatus(
            "Please define 4 valid .wav paths for this mode."
          );
          return;
        }

        const emptyPath = voicePaths.some(
          (p) => !p || typeof p !== "string"
        );
        if (emptyPath) {
          setStatus(
            "One or more paths are empty. Please fill all 4 paths."
          );
          return;
        }

        const AC =
          window.AudioContext || window.webkitAudioContext || null;
        if (!AC) {
          setStatus("AudioContext is not supported in this browser.");
          return;
        }

        setStatus("Loading base voices for current mode...");
        const audioCtx = new AC();

        const decoded = await Promise.all(
          voicePaths.map((url) => decodeUrlToMono(audioCtx, url))
        );

        audioCtx.close();
        if (cancelled) return;

        if (!decoded.length) {
          setStatus("Failed to decode the audio files.");
          return;
        }

        // Use the first file's sample rate as base
        const baseRate = decoded[0].sampleRate;
        const resampled = decoded.map((d) => ({
          samples: resampleToRate(d.samples, d.sampleRate, baseRate),
          sampleRate: baseRate,
          fileName: d.fileName,
        }));

        voicesRef.current = resampled;
        baseRateRef.current = baseRate;
        setIsReady(true);
        setStatus(
          "Voices loaded for current mode. Move the sliders to update the mix."
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setStatus("Error while loading the voices.");
        }
      }
    };

    loadVoices();

    return () => {
      cancelled = true;
    };
  }, []);

  // ===== 2) Recompute mix whenever sliders change (auto) =====
  const recomputeMix = useCallback((sliders) => {
    const voices = voicesRef.current;
    if (!voices || !voices.length) return;

    const baseRate = baseRateRef.current;

    // Gains from your 4 sliders (global: window.__currentHumanSliders)
    const gains = [0, 1, 2, 3].map((idx) => {
      const s = Array.isArray(sliders) ? sliders[idx] : null;
      let g =
        s && typeof s.gain === "number" && !Number.isNaN(s.gain)
          ? s.gain
          : 1.0;

      if (!Number.isFinite(g)) g = 1.0;
      if (g < 0) g = 0;
      if (g > 2) g = 2;
      return g;
    });

    const maxLen = Math.max(
      ...voices.map((v) => v.samples.length || 0)
    );
    if (!maxLen) return;

    const mix = new Float32Array(maxLen);

    for (let i = 0; i < 4; i++) {
      const voice = voices[i];
      const g = gains[i] ?? 1;
      if (!voice || !voice.samples || !voice.samples.length) continue;

      const buf = voice.samples;
      const len = buf.length;
      for (let n = 0; n < len; n++) {
        mix[n] += buf[n] * g;
      }
    }

    // Normalize if needed
    let maxAbs = 0;
    for (let i = 0; i < mix.length; i++) {
      const v = Math.abs(mix[i]);
      if (v > maxAbs) maxAbs = v;
    }
    if (maxAbs > 1) {
      const s = 1 / maxAbs;
      for (let i = 0; i < mix.length; i++) {
        mix[i] *= s;
      }
    }

    // Save mixed data globally so your main player can also use it
    if (typeof window !== "undefined") {
      window.__equalizerOutputData = {
        samples: mix,
        sampleRate: baseRate,
      };
    }

    // Build a WAV blob + URL for the floating window player
    const blob = createWavBlob(mix, baseRate);
    if (mixUrlRef.current) {
      URL.revokeObjectURL(mixUrlRef.current);
    }
    const url = URL.createObjectURL(blob);
    mixUrlRef.current = url;
    setMixUrl(url);

    const names = voices
      .map((v, i) => `[${i + 1}] ${v.fileName}`)
      .join(" + ");
    setMixName(names);

    setStatus("Mixed voice updated automatically from sliders.");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isReady) return;

    const interval = setInterval(() => {
      const sliders = window.__currentHumanSliders || [];
      const key = Array.isArray(sliders)
        ? JSON.stringify(
            sliders.map((s) => ({
              gain:
                s && typeof s.gain === "number" ? s.gain : 1.0,
            }))
          )
        : "[]";

      if (key !== slidersSnapshotRef.current) {
        slidersSnapshotRef.current = key;
        // Sliders changed → recompute mix
        recomputeMix(sliders);
      }
    }, 250); // check ~4 times per second

    return () => clearInterval(interval);
  }, [isReady, recomputeMix]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <>
      {/* Top button to open/close the floating window */}
      <button
        onClick={handleToggle}
        className="
          fixed top-4 right-40 z-50
          flex items-center space-x-2
          bg-gradient-to-r from-orange-400 to-gray-500
          hover:from-orange-500 hover:to-gray-600
          px-4 py-2 rounded-md shadow-md cursor-pointer text-sm text-white
        "
      >
        Model Analysis
      </button>

      {/* Floating Window */}
      {isOpen && (
        <div
          className="
            fixed top-20 right-4 w-72 z-50
            bg-gradient-to-r from-orange-400/40 to-gray-500/40
            backdrop-blur-md
            p-4 rounded-xl shadow-xl
            opacity-90
            transition-all duration-300
          "
        >
          <h3 className="text-white text-sm font-semibold">
            Model Analysis (4 Voices Mix)
          </h3>



          {/* Final mixed voice only */}
          {mixUrl && (
            <div className="mt-3 space-y-1">

              <audio controls src={mixUrl} className="w-full mt-1" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
