// utils/audioUtils.js
export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  return decodedBuffer;
}
