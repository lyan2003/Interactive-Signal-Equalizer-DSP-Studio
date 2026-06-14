from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from scipy.io import wavfile
import tempfile
import io
import json
import os





# ===========================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===========================

def my_fft(x):
    """Iterative Radix-2 FFT implementation"""
    x = np.asarray(x, dtype=np.complex128)
    N = x.shape[0]

    # Pad to next power of 2
    if np.log2(N) % 1 > 0:
        next_N = 1 << (int(np.log2(N)) + 1)
        x = np.pad(x, (0, next_N - N), mode='constant')
        N = next_N

    # Bit reversal permutation
    j = 0  # This will hold the "bit-reversed" index for each i

    for i in range(1, N):  # Start from 1, because index 0 stays in place
        bit = N >> 1  # Start checking from the highest bit (N/2)

        # Find the next bit-reversed index
        while j & bit:  # While the current bit in j is 1
            j ^= bit  # Flip this bit to 0
            bit >>= 1  # Move to the next lower bit

        j ^= bit  # Flip the current bit to 1, completes the bit-reversal for this i

        # Swap elements only if i < j (to avoid swapping twice)
        if i < j:
            x[i], x[j] = x[j], x[i]

    # ----------------------------
    # Iterative Cooley–Tukey FFT
    # ----------------------------
    stage = 2
    while stage <= N:
        half = stage // 2  # Half the size of current stage
        W_m = np.exp(-2j * np.pi / stage)  # Twiddle factor for this stage

        # Loop over each "chunk" of the current stage
        for k in range(0, N, stage):
            w = 1.0  # Initialize twiddle factor for this chunk

            # Perform butterfly operations within the chunk
            for n in range(half):
                u = x[k + n]  # Top element of the butterfly
                t = w * x[k + n + half]  # Bottom element multiplied by twiddle factor

                x[k + n] = u + t  # Upper output of butterfly
                x[k + n + half] = u - t  # Lower output of butterfly

                w *= W_m  # Update twiddle factor for next butterfly

        stage *= 2  # Move to the next stage (double the group size)

    return x  # Return FFT result

    # ----------------------------
    # Inverse FFT using forward FFT
    # ----------------------------
def my_ifft(X):
    """Inverse FFT using iterative FFT"""
    X = np.asarray(X, dtype=np.complex128)
    N = X.shape[0]

    # Conjugate
    X_conj = np.conjugate(X)

    # Apply forward iterative FFT
    y = my_fft(X_conj)

    # Conjugate again + divide by N
    return np.conjugate(y) / N

def my_spectrogram(signal, sr, window_size=512, overlap=0.5):
    """Spectrogram calculation"""
    step = int(window_size * (1 - overlap))
    windows = []
    for start in range(0, len(signal) - window_size, step):
        segment = signal[start:start + window_size] * np.hanning(window_size)
        X = my_fft(segment)
        mag = np.abs(X[:window_size // 2])
        windows.append(mag)
    spectrogram = np.array(windows).T
    time_axis = np.arange(spectrogram.shape[1]) * step / sr
    freq_axis = np.linspace(0, sr / 2, spectrogram.shape[0])
    return spectrogram, time_axis, freq_axis


def prepare_signal(file_data: bytes):

    sr, signal = wavfile.read(io.BytesIO(file_data))
    if signal.ndim > 1:
        signal = signal.mean(axis=1)  # convert to mono
    signal = signal / np.max(np.abs(signal))  # Normalization

    # Zero padding
    N = 1
    while N < len(signal):
        N *= 2
    padded_signal = np.zeros(N)
    padded_signal[:len(signal)] = signal

    return sr, signal, padded_signal


# ===========================
# 🚀 Endpoints
# ===========================

@app.post("/fft")
async def compute_fft(file: UploadFile = File(...)):
    """🔊 FFT endpoint"""
    sr, signal, padded_signal = prepare_signal(await file.read())
    X = my_fft(padded_signal)
    mag = np.abs(X[:len(X)//2])
    return JSONResponse({
        "sampling_rate": int(sr),
        "fft_magnitude": mag.tolist(),
    })


@app.post("/ifft")
async def compute_ifft(file: UploadFile = File(...)):
    """🌀 IFFT endpoint"""
    sr, signal, padded_signal = prepare_signal(await file.read())
    X = my_fft(padded_signal)
    y = my_ifft(X)
    return JSONResponse({
        "sampling_rate": int(sr),
        "reconstructed_signal": y[:len(signal)].real.tolist(),
    })


@app.post("/spectrogram")
async def compute_spectrogram(file: UploadFile = File(...)):
    """🎛️ Spectrogram endpoint"""
    sr, signal, _ = prepare_signal(await file.read())
    spectrogram, time_axis, freq_axis = my_spectrogram(signal, sr)
    return JSONResponse({
        "sampling_rate": int(sr),
        "spectrogram": spectrogram.tolist(),
        "time_axis": time_axis.tolist(),
        "freq_axis": freq_axis.tolist(),
    })


