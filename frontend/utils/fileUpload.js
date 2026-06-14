// frontend/utils/fileUpload.js

/**
 * Handles audio file upload (.wav, .mp3)
 * @param {Event} event - The change event from an input[type="file"]
 * @param {Function} onUpload - Callback function to execute after successful upload
 */
export function handleFileUpload(event, onUpload) {
  const file = event.target.files[0];

  if (!file) {
    console.log("No file selected");
    return;
  }

  const validTypes = ["audio/wav", "audio/mp3", "audio/mpeg"];
  if (!validTypes.includes(file.type)) {
    alert("Please upload a valid audio file (.wav or .mp3)");
    event.target.value = "";
    return;
  }

  const audioURL = URL.createObjectURL(file);
  console.log(`File uploaded: ${file.name}`);

  // نخزن الفايل جلوبال عشان FloatingAIWindow يستخدمه
  if (typeof window !== "undefined") {
    window.__currentAudioFile = file;
  }

  if (typeof onUpload === "function") {
    onUpload({
      name: file.name,
      type: file.type,
      size: file.size,
      url: audioURL,
      file: file,
    });
  }
}
