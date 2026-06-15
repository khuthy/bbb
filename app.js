'use strict';

// --- State ---
let selectedDuration = 10;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let elapsed = 0;
let analyserNode = null;
let animFrameId = null;
let reversedBuffer = null;
let audioCtx = null;
let playbackSource = null;
let isPlaying = false;
let playbackStartTime = 0;
let playbackOffset = 0;
let seekUpdateId = null;
let reversedBlob = null;

// --- DOM refs ---
const durationBtns = document.querySelectorAll('.duration-btn');
const recordBtn = document.getElementById('recordBtn');
const micRing = document.getElementById('micRing');
const iconMic = recordBtn.querySelector('.icon-mic');
const iconStop = recordBtn.querySelector('.icon-stop');
const timerDisplay = document.getElementById('timerDisplay');
const timerText = document.getElementById('timerText');
const progressBar = document.getElementById('progressBar');
const recordHint = document.getElementById('recordHint');
const waveCanvas = document.getElementById('waveCanvas');
const waveCtx = waveCanvas.getContext('2d');
const playbackSection = document.getElementById('playbackSection');
const processingOverlay = document.getElementById('processingOverlay');
const playBtn = document.getElementById('playBtn');
const iconPlay = playBtn.querySelector('.icon-play');
const iconPause = playBtn.querySelector('.icon-pause');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const downloadBtn = document.getElementById('downloadBtn');
const newRecordingBtn = document.getElementById('newRecordingBtn');
const errorBanner = document.getElementById('errorBanner');
const errorText = document.getElementById('errorText');
const dismissError = document.getElementById('dismissError');
const reversedWaveCanvas = document.getElementById('reversedWaveCanvas');
const reversedWaveCtx = reversedWaveCanvas.getContext('2d');

const CIRCUMFERENCE = 2 * Math.PI * 54; // r=54

// --- Duration selection ---
durationBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('disabled-btn')) return;
    durationBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDuration = parseInt(btn.dataset.seconds, 10);
  });
});

// --- Record button ---
recordBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setHintError('Audio recording is not supported in this browser. Try Chrome, Firefox, or Safari.');
    return;
  }

  recordBtn.disabled = true;
  recordHint.textContent = 'Waiting for microphone permission… check your browser.';
  recordHint.style.color = '#a78bfa';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    recordBtn.disabled = false;
    recordHint.style.color = '';
    setupVisualizer(stream);

    audioChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(animFrameId);
      waveCanvas.classList.add('hidden');
      processRecording();
    };

    mediaRecorder.start(100);
    setRecordingUI(true);
    startTimer();

  } catch (err) {
    recordBtn.disabled = false;
    recordHint.style.color = '';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      setHintError('Microphone blocked. Click the lock/camera icon in your address bar to allow access, then try again.');
    } else if (err.name === 'NotFoundError') {
      setHintError('No microphone found. Please connect a microphone and try again.');
    } else {
      setHintError(`Microphone error: ${err.message}`);
    }
  }
}

function setHintError(msg) {
  recordHint.textContent = msg;
  recordHint.style.color = '#ff4d6d';
  setTimeout(() => { recordHint.style.color = ''; }, 6000);
}

function stopRecording() {
  if (recordingTimer) clearInterval(recordingTimer);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  setRecordingUI(false);
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// --- Timer ---
function startTimer() {
  elapsed = 0;
  updateTimerDisplay();
  timerDisplay.classList.add('visible');

  recordingTimer = setInterval(() => {
    elapsed++;
    updateTimerDisplay();
    if (elapsed >= selectedDuration) {
      stopRecording();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const remaining = selectedDuration - elapsed;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  timerText.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const pct = elapsed / selectedDuration;
  progressBar.style.strokeDasharray = CIRCUMFERENCE.toString();
  progressBar.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - pct));
}

// --- UI state ---
function setRecordingUI(recording) {
  recordBtn.classList.toggle('recording', recording);
  micRing.classList.toggle('recording', recording);
  iconMic.classList.toggle('hidden', recording);
  iconStop.classList.toggle('hidden', !recording);
  recordHint.textContent = recording ? 'Recording… tap to stop early' : 'Tap the mic to start recording';
  recordHint.style.color = '';
  durationBtns.forEach(b => b.classList.toggle('disabled-btn', recording));

  if (!recording) {
    timerDisplay.classList.remove('visible');
    progressBar.style.strokeDashoffset = String(CIRCUMFERENCE);
  }
}

// --- Visualizer ---
function setupVisualizer(stream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyserNode);

  waveCanvas.classList.remove('hidden');
  drawWaveform();
}

function drawWaveform() {
  animFrameId = requestAnimationFrame(drawWaveform);
  const bufLen = analyserNode.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  analyserNode.getByteTimeDomainData(data);

  const w = waveCanvas.width;
  const h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);

  waveCtx.lineWidth = 2;
  waveCtx.strokeStyle = '#6c63ff';
  waveCtx.beginPath();

  const sliceW = w / bufLen;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const v = data[i] / 128.0;
    const y = (v * h) / 2;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
    x += sliceW;
  }
  waveCtx.lineTo(w, h / 2);
  waveCtx.stroke();
}

// --- Processing: decode + reverse ---
async function processRecording() {
  processingOverlay.classList.remove('hidden');

  try {
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();

    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer);

    reversedBuffer = reverseAudioBuffer(decoded);
    reversedBlob = await audioBufferToWav(reversedBuffer);

    drawReversedWaveform(reversedBuffer);
    setupPlayback(reversedBuffer);
    playbackSection.classList.remove('hidden');

  } catch (err) {
    showError(`Failed to process audio: ${err.message}`);
  } finally {
    processingOverlay.classList.add('hidden');
  }
}

function reverseAudioBuffer(buffer) {
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  const reversed = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = reversed.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[src.length - 1 - i];
    }
  }
  return reversed;
}

// --- WAV encoder ---
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = buffer.length * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// --- Draw reversed waveform ---
function drawReversedWaveform(buffer) {
  const data = buffer.getChannelData(0);
  const w = reversedWaveCanvas.width;
  const h = reversedWaveCanvas.height;
  const step = Math.ceil(data.length / w);

  reversedWaveCtx.clearRect(0, 0, w, h);
  reversedWaveCtx.lineWidth = 1.5;
  reversedWaveCtx.strokeStyle = '#6c63ff';
  reversedWaveCtx.beginPath();

  for (let x = 0; x < w; x++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const val = data[x * step + j] ?? 0;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const yMin = (1 + min) * h / 2;
    const yMax = (1 + max) * h / 2;
    reversedWaveCtx.moveTo(x, yMin);
    reversedWaveCtx.lineTo(x, yMax);
  }
  reversedWaveCtx.stroke();
}

// --- Playback ---
function setupPlayback(buffer) {
  const duration = buffer.duration;
  totalTimeEl.textContent = formatTime(duration);
  seekBar.max = duration;
  seekBar.value = 0;
  currentTimeEl.textContent = '0:00';
  playbackOffset = 0;
  isPlaying = false;
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
}

function getOrCreateAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playReversed() {
  const ctx = getOrCreateAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();

  if (playbackSource) {
    playbackSource.onended = null;
    playbackSource.stop();
    playbackSource = null;
  }

  playbackSource = ctx.createBufferSource();
  playbackSource.buffer = reversedBuffer;
  playbackSource.connect(ctx.destination);

  playbackStartTime = ctx.currentTime - playbackOffset;
  playbackSource.start(0, playbackOffset);

  playbackSource.onended = () => {
    if (isPlaying) {
      isPlaying = false;
      playbackOffset = 0;
      seekBar.value = 0;
      currentTimeEl.textContent = '0:00';
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      cancelAnimationFrame(seekUpdateId);
    }
  };

  isPlaying = true;
  iconPlay.classList.add('hidden');
  iconPause.classList.remove('hidden');
  updateSeekBar();
}

function pausePlayback() {
  if (!playbackSource) return;
  const ctx = getOrCreateAudioCtx();
  playbackOffset = ctx.currentTime - playbackStartTime;
  playbackSource.onended = null;
  playbackSource.stop();
  playbackSource = null;
  isPlaying = false;
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
  cancelAnimationFrame(seekUpdateId);
}

function updateSeekBar() {
  if (!isPlaying) return;
  const ctx = getOrCreateAudioCtx();
  const current = ctx.currentTime - playbackStartTime;
  seekBar.value = current;
  currentTimeEl.textContent = formatTime(current);
  seekUpdateId = requestAnimationFrame(updateSeekBar);
}

playBtn.addEventListener('click', () => {
  if (isPlaying) {
    pausePlayback();
  } else {
    playReversed();
  }
});

seekBar.addEventListener('input', () => {
  const ctx = getOrCreateAudioCtx();
  const newOffset = parseFloat(seekBar.value);
  currentTimeEl.textContent = formatTime(newOffset);
  if (isPlaying) {
    cancelAnimationFrame(seekUpdateId);
    playbackOffset = newOffset;
    playbackSource?.stop?.();
    playbackSource = null;
    isPlaying = false;
    playReversed();
  } else {
    playbackOffset = newOffset;
  }
});

// --- Download ---
downloadBtn.addEventListener('click', () => {
  if (!reversedBlob) return;
  const url = URL.createObjectURL(reversedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reversed-${Date.now()}.wav`;
  a.click();
  URL.revokeObjectURL(url);
});

// --- New recording ---
newRecordingBtn.addEventListener('click', () => {
  if (isPlaying) pausePlayback();
  reversedBuffer = null;
  reversedBlob = null;
  playbackSection.classList.add('hidden');
  reversedWaveCtx.clearRect(0, 0, reversedWaveCanvas.width, reversedWaveCanvas.height);
  recordHint.textContent = 'Tap the mic to start recording';
  durationBtns.forEach(b => b.classList.remove('disabled-btn'));
});

// --- Error banner ---
function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.remove('hidden');
}

dismissError.addEventListener('click', () => {
  errorBanner.classList.add('hidden');
});

// --- Helpers ---
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
