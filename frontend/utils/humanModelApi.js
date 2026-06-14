// utils/humanModelApi.js

export async function runHumanModel(file, sliders) {
  if (!file) {
    throw new Error("No audio file provided to AI model");
  }

  // sliders: array of { name, gain, windows? }
  // إحنا محتاجين بس name + gain
  const simpleSliders = sliders.map((s) => ({
    name: (s.name || "").toLowerCase(),
    gain: typeof s.gain === "number" ? s.gain : 1.0,
  }));

  const formData = new FormData();
  formData.append("file", file);
  formData.append("sliders_json", JSON.stringify(simpleSliders));

  const res = await fetch("http://127.0.0.1:8000/human_model", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let msg = "Human model request failed";
    try {
      const err = await res.json();
      if (err.detail) msg = err.detail;
      if (err.message) msg = err.message;
    } catch (e) {}
    throw new Error(msg);
  }

  const data = await res.json();

  // لو عايز تشغل الصوت من نفس ال UI (Graph + AudioContext)
  if (data.mixed_samples && data.sample_rate && typeof window !== "undefined") {
    const samples = Float32Array.from(data.mixed_samples);
    window.__equalizerOutputData = {
      samples,
      sampleRate: data.sample_rate,
    };
    console.log("AI human model: output stored in window.__equalizerOutputData");
  }

  return data; // فيه output_path كمان لو حابب تستعمله
}
