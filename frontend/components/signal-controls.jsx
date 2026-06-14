"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  Square,
  ZoomIn,
  ZoomOut,
  Move,
  RotateCcw,
} from "lucide-react";

export default function FunctionalityPanel({
  mode,
  audioBuffer,
  onZoomIn,
  onZoomOut,
  onPan,
  onReset,
  onTogglePan,
  isPanning,
  zoom,
  onTimeUpdate,
  onBandsChange,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);

  // ======= Generic Bands state =======
  const [bands, setBands] = useState([]);
  const [bandsOpen, setBandsOpen] = useState(true);

  // ======= 4 Sliders state (for non-generic modes) =======
  // كل سلايدر: { name, gain (0→2 continuous), windows: [{start, end}, ...] }
  const [sliders, setSliders] = useState([]);
  const [slidersOpen, setSlidersOpen] = useState(true);

  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(null);
  const durationRef = useRef(0);

  const fileInputRef = useRef(null); // bands JSON
  const sliderFileInputRef = useRef(null); // sliders JSON

  const nyquist = audioBuffer ? audioBuffer.sampleRate / 2 : 20000;

  const modeKey = (mode || "").toLowerCase();
  // 🔥 أي mode فيه كلمة "generic" أو مفيش mode → نعتبره Generic
  const isGeneric = !modeKey || modeKey.includes("generic");

  // 🔥 نخزّن السلايدرز جلوبال عشان FloatingAIWindow يقدر يقرأهم (Human Voices mode)
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__currentHumanSliders = sliders;
    }
  }, [sliders]);

  // ========= Helpers =========

  const getOutputData = () => {
    if (typeof window === "undefined") return null;
    const d = window.__equalizerOutputData;
    if (!d || !d.samples || !d.sampleRate) return null;
    return d;
  };

  // ✅ بقى gain continuous من 0 → 2 بدون تقريب
  const normalizeGain = (value) => {
    let g;
    if (typeof value === "number" && !isNaN(value)) g = value;
    else g = 1;
    g = Math.max(0, Math.min(2, g)); // clamp فقط
    return g;
  };

  const ensureCtx = () => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AC();
    }
    return audioCtxRef.current;
  };

  // ===== Helpers لعمل bands جاهزة للباك إند / الـ viewers =====

  const buildBandsFromBandsState = (bandsArr) => {
    return bandsArr.map((b, idx) => {
      let f1 = Number.isFinite(b.f1) ? b.f1 : 0;
      let f2 = Number.isFinite(b.f2) ? b.f2 : nyquist;

      if (f1 > f2) {
        const tmp = f1;
        f1 = f2;
        f2 = tmp;
      }

      f1 = Math.max(0, Math.min(f1, nyquist));
      f2 = Math.max(0, Math.min(f2, nyquist));

      return {
        label: b.label || `Band ${idx + 1}`,
        start: f1,
        end: f2,
        gain: normalizeGain(b.gain),
      };
    });
  };

  const buildBandsFromSliders = (slidersArr) => {
    const flat = [];

    slidersArr.forEach((s, sIdx) => {
      const labelBase =
        typeof s.name === "string" && s.name.trim()
          ? s.name.trim()
          : `Slider ${sIdx + 1}`;
      const g = normalizeGain(s.gain);
      const windows = Array.isArray(s.windows) ? s.windows : [];

      windows.forEach((w, wIdx) => {
        let f1 =
          typeof w.start === "number" && Number.isFinite(w.start)
            ? w.start
            : typeof w.f1 === "number"
            ? w.f1
            : 0;
        let f2 =
          typeof w.end === "number" && Number.isFinite(w.end)
            ? w.end
            : typeof w.f2 === "number"
            ? w.f2
            : nyquist;

        if (f1 > f2) {
          const tmp = f1;
          f1 = f2;
          f2 = tmp;
        }

        f1 = Math.max(0, Math.min(f1, nyquist));
        f2 = Math.max(0, Math.min(f2, nyquist));

        if (f2 > f1) {
          flat.push({
            label: `${labelBase} #${wIdx + 1}`,
            start: f1,
            end: f2,
            gain: g,
          });
        }
      });
    });

    return flat;
  };

  // ========= Audio: Play OUTPUT (أو Input لو مفيش EQ) =========

  const startSourceFromOffset = async () => {
    const outData = getOutputData();
    if (!audioBuffer && !outData) return;

    const ctx = ensureCtx();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    let bufferToUse = null;
    let duration = 0;

    if (outData) {
      const { samples, sampleRate } = outData;
      try {
        const buf = ctx.createBuffer(1, samples.length, sampleRate);
        buf.copyToChannel(samples, 0);
        bufferToUse = buf;
        duration = samples.length / sampleRate;
      } catch (e) {
        console.error("Error creating output buffer, fallback to input:", e);
      }
    }

    if (!bufferToUse && audioBuffer) {
      bufferToUse = audioBuffer;
      duration = audioBuffer.duration;
    }

    if (!bufferToUse) return;

    durationRef.current = duration;

    const node = ctx.createBufferSource();
    node.buffer = bufferToUse;
    node.playbackRate.value = speed;
    node.connect(ctx.destination);

    const safeOffset = Math.min(
      Math.max(0, offsetRef.current),
      durationRef.current || duration || 0
    );

    startTimeRef.current =
      ctx.currentTime - safeOffset / Math.max(speed, 1e-6);

    node.start(0, safeOffset);
    sourceRef.current = node;
    setIsPlaying(true);

    // natural end فقط (مش Pause/Stop اليدوي)
    node.onended = () => {
      setIsPlaying(false);
      offsetRef.current = 0;
      if (onTimeUpdate) onTimeUpdate(0);
    };
  };

  const handlePlay = () => {
    startSourceFromOffset();
  };

  const handlePause = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (sourceRef.current) {
      const node = sourceRef.current;

      const elapsed = (ctx.currentTime - startTimeRef.current) * speed;
      const maxDuration =
        durationRef.current || (audioBuffer ? audioBuffer.duration : 0) || 0;

      const safeElapsed = Math.min(Math.max(0, elapsed), maxDuration);
      offsetRef.current = safeElapsed;
      if (onTimeUpdate) onTimeUpdate(safeElapsed);

      // ❗ مهم: ما نخليش onended يشتغل لما نعمل stop يدوي (Pause)
      node.onended = null;
      try {
        node.stop();
      } catch (e) {}
      node.disconnect();
      sourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleStop = () => {
    if (sourceRef.current) {
      const node = sourceRef.current;
      node.onended = null; // إلغاء natural handler في حالة الـ Stop اليدوي
      try {
        node.stop();
      } catch (e) {}
      node.disconnect();
      sourceRef.current = null;
    }
    offsetRef.current = 0;
    setIsPlaying(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (onTimeUpdate) onTimeUpdate(0);
  };

  const handleSpeedChange = (e) => {
    const newSpeed = parseFloat(e.target.value);
    setSpeed(newSpeed);
    if (sourceRef.current) sourceRef.current.playbackRate.value = newSpeed;
  };

  // 🔁 تحديث الـ currentTime لكل الجرافس
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const updateTime = () => {
      const elapsed = (ctx.currentTime - startTimeRef.current) * speed;

      const maxDuration =
        durationRef.current || (audioBuffer ? audioBuffer.duration : 0) || 0;

      if (onTimeUpdate) {
        const clamped = Math.min(Math.max(0, elapsed), maxDuration);
        onTimeUpdate(clamped);
      }

      rafRef.current = requestAnimationFrame(updateTime);
    };

    rafRef.current = requestAnimationFrame(updateTime);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, speed, audioBuffer, onTimeUpdate]);

  // ========= Bands Handling (Generic mode) =========

  const handleAddBand = () => {
    setBands((prev) => {
      const idx = prev.length + 1;
      return [
        ...prev,
        {
          label: `Band ${idx}`,
          f1: 500.0,
          f2: 1500.0,
          gain: 1.0,
        },
      ];
    });
  };

  const handleClearBands = () => {
    setBands([]);
  };

  const handleUpdateBand = (index, patch) => {
    setBands((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const handleDeleteBand = (index) => {
    setBands((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((b, i) => ({ ...b, label: `Band ${i + 1}` }))
    );
  };

  // ========= Save / Load JSON (Bands) =========

  const saveBandsJSON = () => {
    const mapped = buildBandsFromBandsState(bands);
    const dataToSave = { bands: mapped };
    const dataStr = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "equalizer_bands.json";
    link.click();
  };

  const handleBandsLoadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleBandsFileUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt && evt.target ? evt.target.result : "";
        const json = JSON.parse(text || "{}");

        let rawBands = [];
        if (Array.isArray(json)) {
          rawBands = json;
        } else if (Array.isArray(json.bands)) {
          rawBands = json.bands;
        } else if (Array.isArray(json.subdivisions)) {
          rawBands = json.subdivisions;
        } else {
          alert("JSON format not recognized. Expecting { bands: [...] }.");
          return;
        }

        const mapped = rawBands.map((b, index) => {
          let f1 =
            typeof b.start === "number"
              ? b.start
              : typeof b.f1 === "number"
              ? b.f1
              : 0;
          let f2 =
            typeof b.end === "number"
              ? b.end
              : typeof b.f2 === "number"
              ? b.f2
              : nyquist;

          if (f1 > f2) {
            const tmp = f1;
            f1 = f2;
            f2 = tmp;
          }

          f1 = Math.max(0, Math.min(f1, nyquist));
          f2 = Math.max(0, Math.min(f2, nyquist));

          const g = normalizeGain(
            typeof b.gain === "number"
              ? b.gain
              : typeof b.scale === "number"
              ? b.scale
              : 1
          );

          return {
            label: b.label || `Band ${index + 1}`,
            f1,
            f2,
            gain: g,
          };
        });

        setBands(mapped);
      } catch (err) {
        console.error(err);
        alert("Error reading JSON file.");
      }
    };

    reader.readAsText(file);
    e.target.value = "";
  };

  // استلام bands من FrequencyViewer (لـ Generic فقط)
  useEffect(() => {
    const handleBandsFromViewer = (evt) => {
      if (!isGeneric) return;
      const detail = evt.detail || {};
      if (!Array.isArray(detail.bands)) return;

      const incoming = detail.bands.map((b, index) => {
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
          label: b.label || `Band ${index + 1}`,
          f1,
          f2,
          gain: normalizeGain(typeof b.gain === "number" ? b.gain : 1),
        };
      });

      setBands(incoming);
    };

    if (typeof window !== "undefined") {
      window.addEventListener(
        "equalizerBandsUpdateFromViewer",
        handleBandsFromViewer
      );
      return () => {
        window.removeEventListener(
          "equalizerBandsUpdateFromViewer",
          handleBandsFromViewer
        );
      };
    }
  }, [nyquist, isGeneric]);

  // 🔥 إرسال bands للـparent + FrequencyViewer + Auto-Apply (Generic mode)
  useEffect(() => {
    if (!isGeneric) return;

    const mapped = buildBandsFromBandsState(bands);

    if (onBandsChange) onBandsChange(mapped);

    if (typeof window !== "undefined") {
      // تحديث الـ FrequencyViewer
      window.dispatchEvent(
        new CustomEvent("equalizerBandsUpdateFromPanel", {
          detail: { bands: mapped, nyquist },
        })
      );
      // Apply EQ أوتوماتيك كل ما bands تتغير
      window.dispatchEvent(
        new CustomEvent("equalizerApply", {
          detail: { bands: mapped, nyquist },
        })
      );
    }
  }, [bands, onBandsChange, nyquist, isGeneric]);

  // ========= JSON Save / Load for 4 Sliders (Non-generic modes) =========

  const saveSliderJSON = () => {
    if (!sliders.length) {
      alert("No sliders to save. Load a settings file first.");
      return;
    }

    const sanitized = sliders.map((s, idx) => {
      const name =
        typeof s.name === "string" && s.name.trim()
          ? s.name.trim()
          : `Slider ${idx + 1}`;
      const gain = normalizeGain(s.gain);
      const windowsSrc = Array.isArray(s.windows) ? s.windows : [];
      const windows = windowsSrc
        .map((w) => {
          let f1 =
            typeof w.start === "number" && Number.isFinite(w.start)
              ? w.start
              : typeof w.f1 === "number"
              ? w.f1
              : 0;
          let f2 =
            typeof w.end === "number" && Number.isFinite(w.end)
              ? w.end
              : typeof w.f2 === "number"
              ? w.f2
              : nyquist;

          if (f1 > f2) {
            const tmp = f1;
            f1 = f2;
            f2 = tmp;
          }

          f1 = Math.max(0, Math.min(f1, nyquist));
          f2 = Math.max(0, Math.min(f2, nyquist));
          return { start: f1, end: f2 };
        })
        .filter((w) => w.start < w.end);

      return { name, gain, windows };
    });

    const dataToSave = { sliders: sanitized };
    const dataStr = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "animal_mode_sliders.json";
    link.click();
  };

  const handleSliderLoadClick = () => {
    if (sliderFileInputRef.current) sliderFileInputRef.current.click();
  };

  const handleSliderFileUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = (evt && evt.target && evt.target.result) || "";
        const json = JSON.parse(text || "{}");

        let rawSliders = [];
        if (Array.isArray(json.sliders)) {
          rawSliders = json.sliders;
        } else if (Array.isArray(json)) {
          rawSliders = json;
        } else {
          alert("JSON format not recognized. Expected { sliders: [...] }.");
          return;
        }

        const limited = rawSliders.slice(0, 4);

        const mapped = limited.map((s, idx) => {
          const name =
            typeof s.name === "string" && s.name.trim()
              ? s.name.trim()
              : `Slider ${idx + 1}`;
          const gain = normalizeGain(
            typeof s.gain === "number" ? s.gain : 1
          );

          const windowsSrc = Array.isArray(s.windows)
            ? s.windows
            : Array.isArray(s.bands)
            ? s.bands
            : [];

          const windows = windowsSrc
            .map((w) => {
              let f1 =
                typeof w.start === "number" && Number.isFinite(w.start)
                  ? w.start
                  : typeof w.f1 === "number"
                  ? w.f1
                  : 0;
              let f2 =
                typeof w.end === "number" && Number.isFinite(w.end)
                  ? w.end
                  : typeof w.f2 === "number"
                  ? w.f2
                  : nyquist;

              if (f1 > f2) {
                const tmp = f1;
                f1 = f2;
                f2 = tmp;
              }

              f1 = Math.max(0, Math.min(f1, nyquist));
              f2 = Math.max(0, Math.min(f2, nyquist));
              return { start: f1, end: f2 };
            })
            .filter((w) => w.start < w.end);

          return { name, gain, windows };
        });

        setSliders(mapped);
      } catch (err) {
        console.error(err);
        alert("Error reading JSON file.");
      }
    };

    reader.readAsText(file);
    e.target.value = "";
  };

  // لو nyquist اتغير (sampleRate جديد) نكلب windows
  useEffect(() => {
    if (!sliders.length) return;
    setSliders((prev) =>
      prev.map((s) => ({
        ...s,
        windows: (Array.isArray(s.windows) ? s.windows : []).map((w) => {
          let f1 =
            typeof w.start === "number" && Number.isFinite(w.start)
              ? w.start
              : 0;
          let f2 =
            typeof w.end === "number" && Number.isFinite(w.end)
              ? w.end
              : nyquist;
          if (f1 > f2) {
            const tmp = f1;
            f1 = f2;
            f2 = tmp;
          }
          f1 = Math.max(0, Math.min(f1, nyquist));
          f2 = Math.max(0, Math.min(f2, nyquist));
          return { start: f1, end: f2 };
        }),
      }))
    );
  }, [nyquist, sliders.length]);

  // 🔥 إرسال bands للـparent + FrequencyViewer + Auto-Apply (Non-generic modes → من sliders)
  useEffect(() => {
    if (isGeneric) return;

    const mapped = buildBandsFromSliders(sliders);

    if (onBandsChange) onBandsChange(mapped);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("equalizerBandsUpdateFromPanel", {
          detail: { bands: mapped, nyquist },
        })
      );
      window.dispatchEvent(
        new CustomEvent("equalizerApply", {
          detail: { bands: mapped, nyquist },
        })
      );
    }
  }, [sliders, onBandsChange, nyquist, isGeneric]);

  // لو حبيت تنادي Apply يدوي من مكان تاني
  const handleApply = () => {
    if (typeof window === "undefined") return;

    let mapped;
    if (isGeneric) {
      mapped = buildBandsFromBandsState(bands);
    } else {
      mapped = buildBandsFromSliders(sliders);
    }

    window.dispatchEvent(
      new CustomEvent("equalizerApply", {
        detail: { bands: mapped, nyquist },
      })
    );
  };

  useEffect(() => {
    return () => {
      try {
        if (sourceRef.current) sourceRef.current.stop();
      } catch (e) {}
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current) audioCtxRef.current.close();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const buttonClass =
    "bg-gradient-to-r from-orange-400 to-gray-500 hover:from-orange-500 hover:to-gray-600 text-white px-3 py-2 rounded-md shadow-md transition-all duration-200 text-sm";

  return (
    <div
      className="flex flex-col items-center space-y-3 p-3 rounded-xl shadow-lg border border-gray-700
      bg-gradient-to-b from-[#1a1a1a]/90 via-[#2c2c2c]/60 to-[#1a1a1a]/80 backdrop-blur-md w-full"
    >
      {/* 🔸 Control Bar */}
      <div
        className="flex flex-wrap items-center justify-center gap-3 bg-gradient-to-b
        from-[#1a1a1a]/60 via-[#2c2c2c]/40 to-[#1a1a1a]/50 p-3 rounded-xl shadow-md border border-gray-700 w-full"
      >
        <button onClick={handlePlay} className="p-3 bg-orange-500 rounded-full">
          <Play className="w-5 h-5 text-white" />
        </button>
        <button onClick={handlePause} className="p-3 bg-black rounded-full">
          <Pause className="w-5 h-5 text-orange-400" />
        </button>
        <button onClick={handleStop} className="p-3 bg-black rounded-full">
          <Square className="w-5 h-5 text-red-400" />
        </button>

        <button onClick={onZoomIn} className="p-3 bg-black rounded-full">
          <ZoomIn className="w-5 h-5 text-orange-400" />
        </button>
        <button onClick={onZoomOut} className="p-3 bg-black rounded-full">
          <ZoomOut className="w-5 h-5 text-orange-400" />
        </button>
        <button
          onClick={onTogglePan}
          className={`p-3 rounded-full ${
            isPanning ? "bg-orange-500" : "bg-black"
          }`}
        >
          <Move
            className={`w-5 h-5 ${
              isPanning ? "text-white" : "text-orange-400"
            }`}
          />
        </button>
        <button onClick={onReset} className="p-3 bg-black rounded-full">
          <RotateCcw className="w-5 h-5 text-orange-400" />
        </button>

        <div className="flex items-center space-x-2 bg-black px-2 py-1 rounded-md text-gray-200">
          <label className="text-xs">Speed:</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={speed}
            onChange={handleSpeedChange}
            className="accent-orange-500 w-24"
          />
          <span className="text-orange-400 text-xs">{speed.toFixed(1)}x</span>
        </div>
      </div>

      {/* 🔸 الجزء اللي بيبدّل حسب الـ mode */}
      {isGeneric ? (
        // ============= Generic Mode: Bands Editor =============
        <div className="w-full mt-2 bg-black/40 rounded-md p-3 text-sm text-gray-300 border border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            {/* Header + toggle */}
            <div
              className="flex items-center justify-between px-3 py-2 bg-[#111]/70 rounded-md cursor-pointer select-none border border-gray-700"
              onClick={() => setBandsOpen(!bandsOpen)}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`transform transition-transform ${
                    bandsOpen ? "rotate-90" : "rotate-0"
                  }`}
                >
                  ▶
                </span>
                <h3 className="text-base font-semibold text-orange-400">
                  Frequency Bands ({bands.length})
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={handleAddBand} className={buttonClass}>
                ➕ Add Band
              </button>
              <button onClick={handleClearBands} className={buttonClass}>
                🗑️ Clear All
              </button>
              {bands.length > 0 && (
                <button onClick={saveBandsJSON} className={buttonClass}>
                  💾 Save JSON
                </button>
              )}
              <button onClick={handleBandsLoadClick} className={buttonClass}>
                📂 Load JSON
              </button>
            </div>
          </div>

          {/* hidden input for bands */}
          <input
            type="file"
            accept="application/json"
            ref={fileInputRef}
            onChange={handleBandsFileUpload}
            className="hidden"
          />

          {bandsOpen && (
            <div className="mt-2 space-y-3 max-h-64 overflow-y-auto pr-1">
              {bands.length === 0 ? (
                <p className="text-xs text-gray-400">
                  No bands. Click "Add Band" or "Load JSON".
                </p>
              ) : (
                bands.map((band, i) => {
                  const gainVal = normalizeGain(band.gain);

                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-gray-700 bg-[#101010]/70 p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-orange-300">
                          {band.label}
                        </span>
                        <button
                          onClick={() => handleDeleteBand(i)}
                          className="text-xs px-2 py-1 rounded-md bg-red-600/80 hover:bg-red-700 text-white"
                        >
                          🗑
                        </button>
                      </div>

                      {/* Start / End / Gain sliders */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Start */}
                        <div className="flex flex-col">
                          <label className="text-xs mb-1">Start (Hz)</label>
                          <input
                            type="range"
                            min={0}
                            max={nyquist}
                            step={10}
                            value={band.f1}
                            onChange={(e) =>
                              handleUpdateBand(i, {
                                f1: Math.min(
                                  Number(e.target.value),
                                  band.f2
                                ),
                              })
                            }
                            className="accent-orange-500 w-full"
                          />
                          <span className="text-[11px] mt-1 text-gray-300">
                            {Math.round(band.f1)} Hz
                          </span>
                        </div>

                        {/* End */}
                        <div className="flex flex-col">
                          <label className="text-xs mb-1">End (Hz)</label>
                          <input
                            type="range"
                            min={0}
                            max={nyquist}
                            step={10}
                            value={band.f2}
                            onChange={(e) =>
                              handleUpdateBand(i, {
                                f2: Math.max(
                                  Number(e.target.value),
                                  band.f1
                                ),
                              })
                            }
                            className="accent-orange-500 w-full"
                          />
                          <span className="text-[11px] mt-1 text-gray-300">
                            {Math.round(band.f2)} Hz
                          </span>
                        </div>

                        {/* Gain */}
                        <div className="flex flex-col">
                          <label className="text-xs mb-1">Gain</label>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.1}
                            value={gainVal}
                            onChange={(e) =>
                              handleUpdateBand(i, {
                                gain: Number(e.target.value),
                              })
                            }
                            className="accent-orange-500 w-full"
                          />
                          <span className="text-[11px] mt-1 text-gray-300">
                            {gainVal.toFixed(2)}x
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] text-gray-400 mt-2">
                        📊 {Math.round(band.f1)}–{Math.round(band.f2)} Hz (Δ ={" "}
                        {Math.round(Math.abs(band.f2 - band.f1))} Hz)
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : (
        // ============= Other Modes: 4 Sliders from JSON =============
        <div className="w-full mt-2 bg-black/40 rounded-md p-3 text-sm text-gray-300 border border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            {/* Header + toggle */}
            <div
              className="flex items-center justify-between px-3 py-2 bg-[#111]/70 rounded-md cursor-pointer select-none border border-gray-700"
              onClick={() => setSlidersOpen(!slidersOpen)}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`transform transition-transform ${
                    slidersOpen ? "rotate-90" : "rotate-0"
                  }`}
                >
                  ▶
                </span>
                <h3 className="text-base font-semibold text-orange-400">
                  Mode Sliders ({sliders.length})
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={handleSliderLoadClick} className={buttonClass}>
                📂 Load Settings
              </button>
              {sliders.length > 0 && (
                <button onClick={saveSliderJSON} className={buttonClass}>
                  💾 Save
                </button>
              )}
            </div>
          </div>

          {/* hidden input for sliders */}
          <input
            type="file"
            accept="application/json"
            ref={sliderFileInputRef}
            onChange={handleSliderFileUpload}
            className="hidden"
          />

          {slidersOpen && (
            <div className="mt-2">
              {sliders.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Load a JSON settings file to get 4 sliders (each slider
                  controls specific frequency windows).
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sliders.map((slider, i) => {
                    const gainVal = normalizeGain(slider.gain);

                    return (
                      <div
                        key={i}
                        className="rounded-lg border border-gray-700 bg-[#101010]/70 p-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-orange-300">
                            {slider.name}
                          </span>
                          <span className="text-[11px] text-gray-400">
                            Gain: {gainVal.toFixed(2)}x
                          </span>
                        </div>

                        <div className="flex flex-col">
                          <label className="text-xs mb-1">Gain</label>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.1}
                            value={gainVal}
                            onChange={(e) => {
                              const newGain = Number(e.target.value);
                              setSliders((prev) =>
                                prev.map((s, sIdx) =>
                                  sIdx === i ? { ...s, gain: newGain } : s
                                )
                              );
                            }}
                            className="accent-orange-500 w-full"
                          />
                        </div>

                        {Array.isArray(slider.windows) &&
                          slider.windows.length > 0 && (
                            <p className="text-[11px] text-gray-400 mt-2">
                              Windows:&nbsp;
                              {slider.windows
                                .map(
                                  (w) =>
                                    `${Math.round(w.start)}–${Math.round(
                                      w.end
                                    )} Hz`
                                )
                                .join(" , ")}
                            </p>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-orange-400 italic">
        Zoom × {zoom != null ? zoom.toFixed(1) : "1.0"}{" "}
        {isPanning ? "| Pan: ON" : ""}
      </p>
    </div>
  );
}
