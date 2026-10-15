import { SDK } from './streams-sdk.js';

(() => {
  'use strict';
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const birdImg = new Image(); birdImg.src = './flappybird.png';
  const topPipeImg = new Image(); topPipeImg.src = './toppipe.png';
  const bottomPipeImg = new Image(); bottomPipeImg.src = './bottompipe.png';
  const sound = (name) => { const a = new Audio(`./sfx_${name}.wav`); a.volume = 0.22; a.play().catch(() => {}); };
  const W = 360, H = 640, bird = { x: 52, y: 300, w: 34, h: 24 }, pipes = [];
  let state = 'ready', score = 0, vy = 0, gravity = .34, frame = 0, lastPipe = 0;
  let streamsDevice = null, initializedSession = null, connectTimer = null, currentDb = null, inputScale = 'spl', aboveThreshold = false, lastFlap = 0, quietTimer = 0;
  const saved = JSON.parse(localStorage.getItem('screamBirdSettings') || '{}');
  $('server-url').value = saved.server || '10.89.84.190:3000';
  $('session-id').value = saved.session || '';
  $('threshold').value = saved.threshold >= 30 ? saved.threshold : 72;

  function saveSettings() { localStorage.setItem('screamBirdSettings', JSON.stringify({ server: $('server-url').value.trim(), session: $('session-id').value.trim(), threshold: Number($('threshold').value) })); }
  function setConnection(status, message) {
    $('connection-text').textContent = message;
    $('connection-dot').className = `connection-dot ${status}`;
    $('connection-status').style.color = status === 'connected' ? '#aef3d5' : status === 'error' ? '#ff9aaa' : '';
    if (status === 'connected') $('connection-status').querySelector('.status-icon').textContent = '✓';
    else $('connection-status').querySelector('.status-icon').textContent = status === 'error' ? '!' : '⌁';
  }
  async function connect() {
    if (streamsDevice?.isConnected()) { streamsDevice.disconnect(); return; }
    const host = $('server-url').value.trim().replace(/^wss?:\/\//i, '').replace(/\/$/, '');
    const session = $('session-id').value.trim();
    if (!host || !session) { setConnection('error', 'Enter server address and session ID'); return; }
    saveSettings();
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    setConnection('', 'Connecting to phone…'); $('connect-button').innerHTML = 'Connecting <span>…</span>';
    if (initializedSession && initializedSession !== session) {
      setConnection('error', 'Reload this page to change the session ID'); $('connect-button').innerHTML = 'Reload page to switch session <span>↻</span>'; return;
    }
    try {
      if (!initializedSession) { SDK.initialize(session); initializedSession = session; }
      const address = /^wss?:\/\//i.test($('server-url').value.trim()) ? $('server-url').value.trim() : `${scheme}://${host}`;
      streamsDevice = SDK.createDevice(address, (event) => {
        if (event.type === 'statusChange') {
          if (event.data === 'connected') {
            setConnection('connected', 'Phone connected · listening');
            $('connect-button').innerHTML = 'Disconnect phone <span>×</span>';
          } else if (event.error) {
            setConnection('error', event.error.message || 'Streams SDK connection error');
            $('sensor-detail').textContent = `Streams SDK error: ${event.error.message || String(event.error)}`;
            $('connect-button').innerHTML = 'Retry connection <span>↻</span>';
          } else if ($('connection-dot').classList.contains('connected')) {
            setConnection('', 'Disconnected');
            $('connect-button').innerHTML = 'Connect phone <span>↗</span>';
          }
        } else if (event.type === 'data') {
          const message = event.data;
          $('sensor-detail').textContent = JSON.stringify(message).slice(0, 450);
          const reading = findAudioReading(message);
          if (reading) { setInputScale(reading.scale); onLevel(reading.db); }
        }
      });
      const sdkConnect = streamsDevice.connect();
      const connectTimeout = new Promise((_, reject) => {
        connectTimer = setTimeout(() => {
          streamsDevice?.disconnect();
          reject(new Error('Timed out waiting for the Streams server'));
        }, 8000);
      });
      await Promise.race([sdkConnect, connectTimeout]);
      clearTimeout(connectTimer);
    } catch (err) {
      clearTimeout(connectTimer);
      const message = err?.message === 'Session has already been initialized.'
        ? 'Reload this page to change the session ID'
        : err?.message || 'Streams SDK connection failed';
      setConnection('error', message);
      $('connect-button').innerHTML = 'Retry connection <span>↻</span>';
      $('sensor-detail').textContent = `Streams SDK: ${message}`;
    }
  }

  // Streams payloads can be nested or flattened. Find likely microphone values without
  // mistaking unrelated sensor numbers for an audio level.
  function findAudioReading(root) {
    const queue = [{ value: root, path: '' }], visited = new Set();
    while (queue.length) {
      const { value, path } = queue.shift();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      if (Array.isArray(value)) { value.forEach((v, i) => queue.push({ value: v, path: `${path}[${i}]` })); continue; }
      const keys = Object.keys(value);
      const textValues = keys.map((key) => typeof value[key] === 'string' ? value[key] : '').join(' ');
      const audioContext = /microphone|audio|sound|amplitude|decibel|(^|[._ ])mic([._ ]|$)/i.test(path + ' ' + keys.join(' ') + ' ' + textValues);
      for (const key of keys) {
        const val = value[key], k = key.toLowerCase();
        const isLevel = /^(db|decibel|decibels|dbfs|soundlevel|audiolevel|amplitude|rms|level|volume|value|microphone|mic)$/i.test(k) || /(decibel|amplitude|sound.?level|audio.?level|dbfs|db.?ratio)/i.test(k);
        if (typeof val === 'number' && isLevel && (audioContext || /^(db|decibel|decibels|dbfs|soundlevel|audiolevel|amplitude|rms)$/i.test(k))) {
          let db = val, scale = val < 0 ? 'dbfs' : 'spl';
          if (/(amplitude|rms|ratio)/i.test(k) && val > 0 && val <= 1) { db = 20 * Math.log10(val); scale = 'dbfs'; }
          if (Number.isFinite(db)) return { db, key, raw: val, scale };
        }
        if (val && typeof val === 'object') queue.push({ value: val, path: `${path}.${key}` });
      }
    }
    return null;
  }
  function setInputScale(scale) {
    if (scale === inputScale) return;
    inputScale = scale;
    const slider = $('threshold');
    const meter = $('meter-track');
    const existing = Number(slider.value);
    if (scale === 'dbfs') {
      slider.min = '-60'; slider.max = '-5';
      slider.value = existing < -5 && existing >= -60 ? existing : -28;
      meter.setAttribute('aria-valuemin', '-90'); meter.setAttribute('aria-valuemax', '0');
    } else {
      slider.min = '30'; slider.max = '120';
      slider.value = existing >= 30 && existing <= 120 ? existing : 72;
      meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '120');
    }
    aboveThreshold = false; quietTimer = performance.now(); syncThreshold();
  }
  function onLevel(db) {
    currentDb = inputScale === 'dbfs' ? Math.max(-90, Math.min(0, db)) : Math.max(0, Math.min(120, db));
    $('level-readout').textContent = `${Math.round(currentDb)} ${inputScale === 'dbfs' ? 'dBFS' : 'dB'}`;
    const pct = inputScale === 'dbfs' ? (currentDb + 90) / 90 * 100 : currentDb / 120 * 100;
    $('meter-fill').style.width = `${pct}%`;
    $('meter-track').setAttribute('aria-valuenow', String(Math.round(currentDb)));
    $('sensor-detail').textContent = `Microphone level: ${db.toFixed(1)} ${inputScale === 'dbfs' ? 'dBFS' : 'dB'}. Shout threshold: ${threshold()} ${inputScale === 'dbfs' ? 'dBFS' : 'dB'}.`;
    const above = db >= threshold();
    const now = performance.now();
    if (!above) { aboveThreshold = false; quietTimer = now; }
    else if (now - quietTimer > 150 && (!aboveThreshold || now - lastFlap > 520)) {
      aboveThreshold = true;
      flap('voice');
    }
  }
  function threshold() { return Number($('threshold').value); }
  function syncThreshold() { const t = threshold(); const dbLabel = inputScale === 'dbfs' ? ' dBFS' : ' dB'; $('threshold-value').textContent = `${t < 0 ? '−' + Math.abs(t) : t}${dbLabel}`; $('threshold-marker').style.left = `${inputScale === 'dbfs' ? (t + 90) / 90 * 100 : t / 120 * 100}%`; saveSettings(); }

  function start() { if (state === 'over') reset(); state = 'playing'; $('game-overlay').classList.add('hidden'); $('flight-state').textContent = 'IN FLIGHT'; }
  function flap(source) {
    const now = performance.now();
    if (now - lastFlap < 190) return;
    lastFlap = now;
    if (state === 'ready') start();
    if (state === 'over') { reset(); start(); }
    if (state !== 'playing') return;
    vy = -6.25; sound('wing');
    if (source === 'voice') $('flight-state').textContent = 'VOICE FLAP';
  }
  function reset() { state = 'ready'; score = 0; pipes.length = 0; bird.y = H * .45; vy = 0; lastPipe = 0; $('score').textContent = '0'; showOverlay(false); }
  function showOverlay(gameOver) {
    $('game-overlay').classList.remove('hidden');
    $('overlay-kicker').textContent = gameOver ? 'FLIGHT COMPLETE' : 'READY FOR TAKEOFF?';
    $('overlay-title').innerHTML = gameOver ? `You scored <span style="color:var(--orange)">${score}</span>` : 'Let your voice<br>lift you up.';
    $('overlay-copy').textContent = gameOver ? 'Take a breath, then fly again. A louder sound flaps the bird.' : 'Connect your phone microphone, then shout or make a loud sound to flap.';
    $('play-button').innerHTML = gameOver ? 'Fly again <span>→</span>' : 'Start flight <span>→</span>';
  }
  function endGame() { if (state !== 'playing') return; state = 'over'; $('flight-state').textContent = 'FLIGHT OVER'; sound('hit'); setTimeout(() => sound('die'), 70); showOverlay(true); }
  function addPipe() {
    const gap = 166, top = 90 + Math.random() * 190;
    pipes.push({ x: W + 4, top, gap, scored: false });
  }
  function update() {
    requestAnimationFrame(update); frame++;
    ctx.clearRect(0, 0, W, H);
    if (background.complete && background.naturalWidth) ctx.drawImage(background, 0, 0, W, H);
    else { ctx.fillStyle = '#8bd4ec'; ctx.fillRect(0, 0, W, H); }
    if (state === 'playing') {
      vy += gravity; bird.y = Math.max(-10, bird.y + vy);
      if (frame - lastPipe > 104) { addPipe(); lastPipe = frame; }
      for (let i = pipes.length - 1; i >= 0; i--) {
        const p = pipes[i]; p.x -= 2.5;
        ctx.drawImage(topPipeImg, p.x, p.top - 512, 64, 512);
        ctx.drawImage(bottomPipeImg, p.x, p.top + p.gap, 64, 512);
        if (!p.scored && p.x + 64 < bird.x) { p.scored = true; score++; $('score').textContent = String(score); sound('point'); }
        const overlap = bird.x + bird.w - 5 > p.x + 5 && bird.x + 5 < p.x + 59;
        if (overlap && (bird.y + 4 < p.top || bird.y + bird.h - 4 > p.top + p.gap)) endGame();
        if (p.x < -70) pipes.splice(i, 1);
      }
      if (bird.y + bird.h >= H - 28 || bird.y < -10) endGame();
    }
    pipes.forEach(p => { if (state !== 'playing') { ctx.drawImage(topPipeImg, p.x, p.top - 512, 64, 512); ctx.drawImage(bottomPipeImg, p.x, p.top + p.gap, 64, 512); } });
    ctx.save(); ctx.translate(bird.x + bird.w / 2, bird.y + bird.h / 2); ctx.rotate(Math.min(.65, Math.max(-.45, vy * .055))); ctx.drawImage(birdImg, -bird.w / 2, -bird.h / 2, bird.w, bird.h); ctx.restore();
  }
  const background = new Image(); background.src = './flappybirdbg.png';
  document.addEventListener('keydown', (e) => { if (['Space', 'ArrowUp', 'KeyX'].includes(e.code)) { e.preventDefault(); flap('keyboard'); } });
  canvas.addEventListener('pointerdown', () => flap('touch'));
  $('play-button').addEventListener('click', () => { if (state === 'over') reset(); start(); });
  $('connect-button').addEventListener('click', connect);
  $('toggle-session').addEventListener('click', () => { const i = $('session-id'); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('session-id').type = 'password';
  $('threshold').addEventListener('input', syncThreshold);
  $('server-url').addEventListener('change', saveSettings); $('session-id').addEventListener('change', saveSettings);
  $('calibrate-button').addEventListener('click', () => { if (currentDb === null) { $('sensor-detail').textContent = 'Waiting for a microphone reading. Check that the phone sensor is streaming.'; return; } const min = inputScale === 'dbfs' ? -60 : 30; const max = inputScale === 'dbfs' ? -5 : 120; $('threshold').value = Math.min(max, Math.max(min, Math.round(currentDb + 10))); syncThreshold(); $('sensor-detail').textContent = `Calibrated: threshold is 10 dB above the current room level (${currentDb.toFixed(1)} ${inputScale === 'dbfs' ? 'dBFS' : 'dB'}).`; });
  syncThreshold(); requestAnimationFrame(update);
})();
