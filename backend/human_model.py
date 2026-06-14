# import os
# import requests
# import torch
# import torchaudio
# import soundfile as sf
# import numpy as np
# from typing import List, Dict, Any, Optional
#
# # كاش للموديل والجهاز
# _MODEL = None
# _DEVICE = None
#
#
# def download_model_py() -> bool:
#     """Download official model.py from Asteroid repo if missing."""
#     if not os.path.exists("model.py"):
#         print("Downloading official model.py from Asteroid repo...")
#         url = "https://raw.githubusercontent.com/asteroid-team/asteroid/master/egs/wsj0-mix-var/Multi-Decoder-DPRNN/model.py"
#         try:
#             response = requests.get(url)
#             response.raise_for_status()
#             with open("model.py", "w", encoding="utf-8") as f:
#                 f.write(response.text)
#             print("Downloaded model.py successfully!")
#         except Exception as e:
#             print(f"Download failed: {e}")
#             print(
#                 "Manual download: "
#                 "https://raw.githubusercontent.com/asteroid-team/asteroid/master/egs/wsj0-mix-var/Multi-Decoder-DPRNN/model.py"
#             )
#             return False
#     return True
#
#
# def get_model():
#     """تحميل / كاش لموديل MultiDecoderDPRNN"""
#     global _MODEL, _DEVICE
#     if _MODEL is not None and _DEVICE is not None:
#         return _MODEL, _DEVICE
#
#     if not download_model_py():
#         raise RuntimeError("Failed to download model.py")
#
#     try:
#         from model import MultiDecoderDPRNN
#     except ImportError as e:
#         raise RuntimeError(f"Import error: {e}. Ensure asteroid is installed.")
#
#     print("[HumanModel] Loading pretrained MultiDecoderDPRNN from Hugging Face...")
#     model = MultiDecoderDPRNN.from_pretrained("JunzheJosephZhu/MultiDecoderDPRNN")
#     device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
#     model = model.to(device)
#     model.eval()
#     print(f"[HumanModel] Model loaded on {device}")
#
#     _MODEL = model
#     _DEVICE = device
#     return _MODEL, _DEVICE
#
#
# def separate_speech(
#     input_path: str,
#     bands_config: Optional[List[Dict[str, Any]]] = None,
#     output_dir: Optional[str] = None,
# ) -> Dict[str, Any]:
#     """
#     Separate speech using MultiDecoderDPRNN model and apply gains.
#
#     Args:
#         input_path: Path to input audio file
#         bands_config: List of band configs with gains (optional), example:
#             [{ "name": "deep man", "factor": 1.2 }, ...]
#         output_dir: Directory to save separated sources (optional)
#
#     Returns:
#         dict with success status, message, and output details
#     """
#     try:
#         if not os.path.exists(input_path):
#             return {"success": False, "message": f"File not found: {input_path}"}
#
#         model, device = get_model()
#
#         # Load & prepare audio
#         print(f"[HumanModel] Loading {input_path}")
#         mix, sr = torchaudio.load(input_path)
#
#         # Resample to 8kHz if needed (model expects 8kHz)
#         if sr != 8000:
#             print(f"[HumanModel] Resampling from {sr}Hz to 8kHz...")
#             resampler = torchaudio.transforms.Resample(sr, 8000)
#             mix = resampler(mix)
#             sr = 8000
#
#         # Mono mix (take mean of channels if stereo)
#         if mix.shape[0] > 1:
#             mix = mix.mean(0, keepdim=True)
#
#         mix = mix.to(device)
#
#         # Separate
#         print("[HumanModel] Separating speech... (may take time on CPU)")
#         with torch.no_grad():
#             est_sources = model.separate(mix)  # (1, Nspk, T) غالباً
#
#         est_sources = est_sources.cpu().numpy()
#
#         # Create sources dictionary (speaker 1, speaker 2, etc.)
#         sources_dict: Dict[str, np.ndarray] = {}
#         source_names = ["speaker_1", "speaker_2", "speaker_3", "speaker_4"]
#
#         if est_sources.ndim == 3 and est_sources.shape[0] == 1:
#             est_sources = est_sources.squeeze(0)  # → (Nspk, T)
#
#         n_sources = est_sources.shape[0]
#         for i in range(n_sources):
#             source_name = source_names[i] if i < len(source_names) else f"speaker_{i + 1}"
#             sources_dict[source_name] = est_sources[i]
#
#         print(f"[HumanModel] Got {n_sources} sources from the model.")
#
#         # Apply gains from bands configuration if provided
#         results = []
#         if bands_config:
#             print(f"[HumanModel] Applying gains to {len(bands_config)} sliders...")
#             source_mapping = {
#                 "deep man": "speaker_1",
#                 "deepman": "speaker_1",
#                 "man": "speaker_2",
#                 "male": "speaker_2",
#                 "woman": "speaker_3",
#                 "female": "speaker_3",
#                 "old man": "speaker_4",
#                 "oldman": "speaker_4",
#             }
#
#             for idx, band in enumerate(bands_config):
#                 band_name = str(band.get("name", "")).lower().strip()
#                 try:
#                     gain_factor = float(band.get("factor", 1.0))
#                 except (TypeError, ValueError):
#                     gain_factor = 1.0
#
#                 target_source = source_mapping.get(band_name)
#                 if not target_source and idx < len(source_names):
#                     target_source = source_names[idx]
#
#                 if target_source in sources_dict:
#                     print(
#                         f"[HumanModel] Slider#{idx} '{band_name}' → {target_source}, gain={gain_factor:.3f}"
#                     )
#                     sources_dict[target_source] *= gain_factor
#                     results.append(
#                         {
#                             "slider_index": idx,
#                             "band": band_name,
#                             "source": target_source,
#                             "gain": gain_factor,
#                         }
#                     )
#                 else:
#                     print(
#                         f"[HumanModel] Warning: could not map slider index={idx}, name='{band_name}' to any source."
#                     )
#
#         # Mix all processed sources
#         print("[HumanModel] Mixing all processed sources...")
#         if not sources_dict:
#             return {"success": False, "message": "No sources produced by model."}
#
#         stacked = np.stack(list(sources_dict.values()), axis=0)  # (Nspk, T)
#         mixed_audio = np.sum(stacked, axis=0)  # (T,)
#         mixed_audio = mixed_audio.astype(np.float32)
#
#         # Normalize if clipping
#         max_val = float(np.max(np.abs(mixed_audio)))
#         if max_val > 1.0:
#             mixed_audio = mixed_audio / max_val * 0.99
#
#         # Save final output
#         output_directory = output_dir or os.path.dirname(input_path)
#         os.makedirs(output_directory, exist_ok=True)
#
#         base_name = os.path.splitext(os.path.basename(input_path))[0]
#         output_path = os.path.join(output_directory, f"{base_name}_human_model_output.wav")
#         sf.write(output_path, mixed_audio, sr)
#
#         print(f"[HumanModel] Mixed audio saved to: {output_path}")
#
#         return {
#             "success": True,
#             "message": "Speech separation complete",
#             "output_path": output_path,
#             "sample_rate": int(sr),
#             "num_sources": int(n_sources),
#             "bands_processed": results,
#             "mixed_samples": mixed_audio.tolist(),  # للفرونت
#         }
#
#     except Exception as e:
#         return {"success": False, "message": f"Error: {str(e)}"}
