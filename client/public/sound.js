/* sound.js — game-like button sounds for Brand Pricing Tool v2.
   Every sound is generated in code with the Web Audio API: no audio
   files, no libraries, nothing to license.

   Sounds
   - click:   quick "pop", ~60 ms, pitch randomised ±5% per tap
   - success: happy two-note rising chime, ~250 ms
   - error:   soft low "bump", ~150 ms
   - toggle:  tiny "tick" for switches and dropdowns

   Wiring (automatic, one delegated listener)
   - Every <button> and every element with class "btn" plays "click".
   - data-sound="success" | "error" | "toggle" on an element plays
     that sound instead. data-sound="none" opts an element out.
   - Disabled buttons stay silent.
   - window.playSound("success") is exposed for code to call, e.g.
     after a successful payment or save.

   Mobile: the AudioContext is created / resumed on the first user
   tap (browsers block audio before that). A tiny vibration
   (navigator.vibrate(10)) accompanies taps where supported.

   Mute: window.isSoundMuted() / window.setSoundMuted(bool) /
   window.toggleSoundMuted() control it; the choice is saved in
   localStorage (default: sounds ON) and a
   "bpt-sound-muted-changed" event fires on window when it changes,
   so the speaker button in the header can stay in sync. */
(function () {
  "use strict";

  var STORAGE_KEY = "bpt-sound-muted";
  var BASE_GAIN = 0.6; // loud enough to hear at normal phone volume (was 0.2 — too quiet)

  /* ---------- mute state (localStorage, default ON) ---------- */
  var muted = false;
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) {
    muted = false; // storage unavailable — sounds stay on
  }

  function saveMuted() {
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (e) {
      /* non-fatal: the choice just won't persist on this device */
    }
  }

  function announceMuted() {
    try {
      window.dispatchEvent(
        new CustomEvent("bpt-sound-muted-changed", { detail: { muted: muted } })
      );
    } catch (e) {
      /* older browsers without CustomEvent constructor — non-fatal */
    }
  }

  /* ---------- AudioContext (lazy, resumed on first tap) ---------- */
  var audioCtx = null;

  function ensureContext() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        audioCtx = new AC();
      } catch (e) {
        return null;
      }
    }
    if (audioCtx.state === "suspended") {
      // resume() returns a promise; never awaited — sound setup below
      // is scheduled against currentTime either way and never blocks.
      audioCtx.resume();
    }
    return audioCtx;
  }

  /* ---------- one soft tone ----------
     Fast attack (5 ms) so there is no click transient, then an
     exponential decay to silence — the envelope itself is what makes
     these feel soft instead of harsh. */
  function tone(options) {
    var ctx = ensureContext();
    if (!ctx) return;
    var startAt = ctx.currentTime + (options.delay || 0);
    var duration = options.duration;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(options.frequency, startAt);
    if (options.frequencyEnd) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, options.frequencyEnd),
        startAt + duration
      );
    }
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(options.peak || BASE_GAIN, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function vibrate() {
    try {
      if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    } catch (e) {
      /* vibration is a garnish — never let it break a tap */
    }
  }

  /* ---------- the four sounds ---------- */
  var sounds = {
    click: function () {
      // A pop: a short sine sweep down, pitch randomised ±5% so
      // repeated taps never sound mechanical.
      var jitter = 1 + (Math.random() * 0.1 - 0.05);
      tone({
        frequency: 640 * jitter,
        frequencyEnd: 340 * jitter,
        duration: 0.06,
        peak: 0.7,
      });
      vibrate();
    },
    success: function () {
      // Two rising notes (E5 -> B5), ~250 ms in total.
      tone({ frequency: 659.25, duration: 0.11, peak: 0.6 });
      tone({ frequency: 987.77, duration: 0.14, peak: 0.6, delay: 0.11 });
    },
    error: function () {
      // A soft low bump — low sine, gentle sweep down, never harsh.
      tone({ frequency: 170, frequencyEnd: 110, duration: 0.15, peak: 0.55 });
    },
    toggle: function () {
      // A tiny tick.
      tone({ frequency: 1350, frequencyEnd: 900, duration: 0.035, peak: 0.6 });
      vibrate();
    },
  };

  function playSound(name) {
    if (muted) return;
    var fn = sounds[name] || sounds.click;
    try {
      fn();
    } catch (e) {
      /* audio must never break the UI */
    }
  }

  /* ---------- public API ---------- */
  window.playSound = playSound;
  window.isSoundMuted = function () {
    return muted;
  };
  window.setSoundMuted = function (value) {
    muted = !!value;
    saveMuted();
    announceMuted();
  };
  window.toggleSoundMuted = function () {
    window.setSoundMuted(!muted);
    return muted;
  };

  /* ---------- global wiring ----------
     One delegated pointerdown listener: pointerdown fires before
     click, so the sound lands the instant the finger touches.
     The same listener doubles as the first-tap AudioContext unlock. */
  document.addEventListener(
    "pointerdown",
    function (event) {
      ensureContext();
      var target = event.target;
      if (!target || typeof target.closest !== "function") return;
      var el = target.closest('button, .btn, [data-sound]');
      if (!el) return;
      if (
        el.disabled ||
        (typeof el.hasAttribute === "function" &&
          (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"))
      ) {
        return; // disabled buttons stay silent
      }
      var name = el.getAttribute("data-sound");
      if (name === "none") return;
      playSound(name && sounds[name] ? name : "click");
    },
    { passive: true }
  );

  // Keyboard users get the same feedback on Enter / Space activation.
  document.addEventListener("click", function (event) {
    if (event.detail !== 0) return; // detail 0 = keyboard / programmatic
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    var el = target.closest('button, .btn, [data-sound]');
    if (!el || el.disabled) return;
    var name = el.getAttribute("data-sound");
    if (name === "none") return;
    playSound(name && sounds[name] ? name : "click");
  });
})();
