import numpy as np
from scipy.io.wavfile import write
import sounddevice as sd  # لتشغيل الصوت

# --- 1. تعريف الـ synthetic signal function ---
def synthetic_test_signal(sr=44100, dur=10.0, freqs=(100, 400, 800, 1500, 3000, 6000)):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    y = np.zeros_like(t)

    amplitudes = np.linspace(0.8, 0.3, len(freqs))

    for amp, freq in zip(amplitudes, freqs):
        y += amp * np.sin(2 * np.pi * freq * t)

    y = y / (np.max(np.abs(y)) + 1e-9)
    return t, y, sr

# --- 2. توليد السيجنال ---
t, y, sr = synthetic_test_signal()

# --- 3. حفظ السيجنال كـ WAV ---
# WAV لازم يكون int16
y_int16 = np.int16(y * 32767)
write("synthetic_signal.wav", sr, y_int16)
print("Saved as synthetic_signal.wav")

# --- 4. تشغيل الصوت مباشرة ---
sd.play(y, sr)
print("Playing signal...")
sd.wait()  # ينتظر انتهاء التشغيل
print("Playback finished.")