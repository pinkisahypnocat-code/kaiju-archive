/*
 * Sound engine for the archive UI. Plays real .ogg sound effects
 * (assets/sfx/click.ogg, assets/sfx/slide.ogg) through the Web Audio API so
 * the slide sound can still be panned left/right depending on which
 * direction a document enters from.
 */
window.Sound = (() => {
  const STORAGE_KEY = 'archive-sound-enabled';
  let enabled = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) enabled = saved === '1';
  } catch (e) {
    // localStorage unavailable (private browsing etc) — just default to on
  }

  let ctx = null;
  let masterGain = null;
  const buffers = {}; // name -> AudioBuffer, populated once decoded
  const loading = {}; // name -> Promise, avoids double-fetching

  function getCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.85;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function loadBuffer(name, url) {
    if (buffers[name]) return Promise.resolve(buffers[name]);
    if (loading[name]) return loading[name];
    const c = getCtx();
    if (!c) return Promise.resolve(null);
    loading[name] = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`sfx fetch failed: ${url}`);
        return res.arrayBuffer();
      })
      .then((data) => c.decodeAudioData(data))
      .then((buffer) => { buffers[name] = buffer; return buffer; })
      .catch((err) => { console.warn('Sound: could not load', url, err); return null; });
    return loading[name];
  }

  // preload all effects immediately so the first click/slide/mail isn't silent
  loadBuffer('click', 'assets/sfx/click.ogg');
  loadBuffer('slide', 'assets/sfx/slide.ogg');
  loadBuffer('mail', 'assets/sfx/mail.ogg');

  function playBuffer(name, { pan = null, panFrom = null, gainValue = 1 } = {}) {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    loadBuffer(name, `assets/sfx/${name}.ogg`).then((buffer) => {
      if (!buffer || !enabled) return;
      try {
        const now = c.currentTime;
        const source = c.createBufferSource();
        source.buffer = buffer;

        const gain = c.createGain();
        gain.gain.value = gainValue;

        let node = source.connect(gain);

        if (c.createStereoPanner && (pan !== null || panFrom !== null)) {
          const panner = c.createStereoPanner();
          if (panFrom !== null) {
            panner.pan.setValueAtTime(panFrom, now);
            panner.pan.linearRampToValueAtTime(panFrom * 0.15, now + buffer.duration);
          } else {
            panner.pan.setValueAtTime(pan, now);
          }
          node.connect(panner);
          panner.connect(masterGain);
        } else {
          node.connect(masterGain);
        }

        source.start(now);
      } catch (e) { /* never let a sound glitch break navigation */ }
    });
  }

  // A short, dry tap — used for category/document clicks in the sidebar.
  function click() {
    playBuffer('click', { gainValue: 0.9 });
  }

  // A soft paper whoosh — used when a document slides into place from the right.
  function slide() {
    playBuffer('slide', { panFrom: 0.55, gainValue: 0.8 });
  }

  // A gentle two-note chime — used only when an email is actually opened.
  function mail() {
    playBuffer('mail', { gainValue: 0.75 });
  }

  function updateButton() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(enabled));
    const label = btn.querySelector('.sound-toggle-label');
    if (label) label.textContent = enabled ? 'SFX ON' : 'SFX OFF';
  }

  function setEnabled(value) {
    enabled = value;
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (e) {}
    updateButton();
  }

  function initToggleButton() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    updateButton();
    btn.addEventListener('click', () => {
      getCtx(); // unlock audio on this user gesture before flipping state
      setEnabled(!enabled);
      if (enabled) click();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggleButton);
  } else {
    initToggleButton();
  }

  return { click, slide, mail, isEnabled: () => enabled, setEnabled };
})();
