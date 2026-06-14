"use client";

import React, { useState, useRef } from "react";
import LayoutMode from "../components/layout-mode";
import FunctionalityPanel from "../components/signal-controls";
import FloatingAIWindow from "../components/models_components";
import { decodeAudioFile } from "../utils/audioUtils";

export default function ModePage({ mode }) {
  // ===== States =====
  const [fileInfo, setFileInfo] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const signalViewerRef = useRef(null);

  // ===== File Upload =====
  const onFileUploaded = async (info) => {
    setFileInfo(info);

    // decodeAudioFile: بيحوّل الـ file لـ AudioBuffer علشان نعديه للجرافات
    const decoded = await decodeAudioFile(info.file);
    setAudioBuffer(decoded);
  };

  // ده اللي بيخلي كل الجرافات (input/output time) تمشي مع الزمن
  const handleTimeUpdate = (t) => {
    setCurrentTime(t);
  };

  // ===== Controls Handlers =====
  const handleZoomIn = () => {
    setZoom((z) => Math.min(z + 0.5, 10));
    signalViewerRef.current?.zoomIn?.();
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(z - 0.5, 1));
    signalViewerRef.current?.zoomOut?.();
  };

  const handlePan = (delta) => {
    // بيتنده من onGlobalPanDelta (drag من أي viewer)
    signalViewerRef.current?.pan?.(delta);
  };

  const handleReset = () => {
    setZoom(1);
    signalViewerRef.current?.resetView?.();
  };

  const togglePan = () => {
    setIsPanning((p) => !p);
  };

  // ===== شرط ظهور زرار الـ AI بس في music / human =====
  const lowerMode = (mode || "").toLowerCase();
  const showAI =
    lowerMode.includes("music") || // "music" أو "musical instruments mode"
    lowerMode.includes("human");   // "human" أو "human voice mode"

  return (
    <section className="flex min-h-screen text-white px-4 pb-2">
      {/* زرار و Window بتوع الـ AI - بس لو المود music أو human */}
      {showAI && <FloatingAIWindow />}

      {/* =====  (Sticky sidebar) ===== */}
      <div
        className="
          w-full max-w-xs
          sticky top-4 self-start
          h-[calc(100vh-2rem)]
          overflow-y-auto
          pr-2
        "
      >
        <FunctionalityPanel
          mode={mode}
          audioBuffer={audioBuffer}
          zoom={zoom}
          isPanning={isPanning}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onPan={handlePan}
          onReset={handleReset}
          onTogglePan={togglePan}
          onTimeUpdate={handleTimeUpdate}
          onBandsChange={(bands) => {
            console.log("Bands updated:", bands);
          }}
        />
      </div>

      {/* =====  (LayoutMode) ===== */}
      <div className="flex-1 overflow-y-auto mt-4 ml-4">
        <h1 className="text-4xl font-bold text-orange-400 mb-1 drop-shadow-md absolute top-2 left-80">
          {mode || "Mode"}
        </h1>

        <div className="w-full">
          <LayoutMode
            mode={mode}
            fileInfo={fileInfo}
            audioBuffer={audioBuffer}
            currentTime={currentTime}
            signalViewerRef={signalViewerRef}
            onFileUploaded={onFileUploaded}
            isPanning={isPanning}
            onGlobalPanDelta={handlePan}
          />
        </div>
      </div>
    </section>
  );
}
