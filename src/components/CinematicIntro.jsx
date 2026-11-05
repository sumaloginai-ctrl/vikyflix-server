import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../styles/intro.css';
import '../styles/logo.css';

/**
 * Mindboggling Cinematic Intro Experience for VikyFlix
 *
 * Combines:
 * 1. Anamorphic Cinema Lens Flare & Stardust Starfield Canvas
 * 2. 3D Interlocking Prism Ribbon Assembly
 * 3. Synthesized Web Audio Hollywood "Ta-Dum" Sonic Brand
 * 4. Specular Chrome Letterform Reveal
 * 5. Hyper-smooth Portal Dissolve into the Home Cinema
 */
export default function CinematicIntro({ onComplete, isReady = true }) {
  const [stage, setStage] = useState('ignite'); // 'ignite' -> 'assemble' -> 'crescendo' -> 'reveal' -> 'exit'
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [canSkip, setCanSkip] = useState(false);
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const hasTriggeredSoundRef = useRef(false);
  const animFrameRef = useRef(null);
  const exitTimeoutRef = useRef(null);

  // Play synthesized Hollywood "Ta-Dum" Cinematic Boom
  const playCinematicSound = useCallback(() => {
    if (!audioEnabled || hasTriggeredSoundRef.current) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      hasTriggeredSoundRef.current = true;
      const now = ctx.currentTime;

      // 1. Master Output Gain
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.001, now);
      master.gain.exponentialRampToValueAtTime(0.85, now + 0.08);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
      master.connect(ctx.destination);

      // 2. Deep Sub-bass Impact Boom (38Hz -> 50Hz punch)
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(95, now);
      subOsc.frequency.exponentialRampToValueAtTime(42, now + 0.35);
      subOsc.frequency.exponentialRampToValueAtTime(32, now + 2.2);

      subGain.gain.setValueAtTime(0.9, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 2.4);

      subOsc.connect(subGain);
      subGain.connect(master);
      subOsc.start(now);
      subOsc.stop(now + 2.5);

      // 3. Mid-range Harmonic Resonance Chord (Cinema Horn / Brass Swell)
      // C2 (65.4Hz), G2 (98Hz), C3 (130.8Hz), E3 (164.8Hz)
      const chordFreqs = [65.41, 98.0, 130.81, 164.81];
      chordFreqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(freq, now + 0.05);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(280, now + 0.05);
        filter.frequency.exponentialRampToValueAtTime(1400, now + 0.55);
        filter.frequency.exponentialRampToValueAtTime(350, now + 2.2);

        gain.gain.setValueAtTime(0.001, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.22 / (idx + 1), now + 0.28);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(master);

        osc.start(now + 0.05);
        osc.stop(now + 2.4);
      });

      // 4. Ethereal High Shimmer (Glass/Chime sparkle at the apex)
      const chimeOsc = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chimeOsc.type = 'sine';
      chimeOsc.frequency.setValueAtTime(1046.5, now + 0.35); // C6
      chimeOsc.frequency.exponentialRampToValueAtTime(2093.0, now + 0.8); // C7

      chimeGain.gain.setValueAtTime(0.001, now + 0.35);
      chimeGain.gain.linearRampToValueAtTime(0.12, now + 0.5);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(master);
      chimeOsc.start(now + 0.35);
      chimeOsc.stop(now + 1.9);

    } catch (e) {
      // Audio autoplay policy handled silently
    }
  }, [audioEnabled]);

  // Canvas Stardust & Particle Nebula
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Generate 65 cinematic floating particles
    const particles = Array.from({ length: 65 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2.2 + 0.4,
      speedX: (Math.random() - 0.5) * 0.45,
      speedY: (Math.random() - 0.5) * 0.45,
      opacity: Math.random() * 0.7 + 0.2,
      pulseSpeed: Math.random() * 0.02 + 0.008,
      hue: Math.random() > 0.5 ? 345 : 35 // Ember ruby or golden amber
    }));

    let t = 0;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Deep space ambient nebula glow
      const cx = width / 2;
      const cy = height / 2;
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, width * 0.65);
      grad.addColorStop(0, 'rgba(255, 23, 68, 0.12)');
      grad.addColorStop(0.35, 'rgba(121, 40, 202, 0.08)');
      grad.addColorStop(0.7, 'rgba(10, 6, 18, 0.6)');
      grad.addColorStop(1, 'rgba(3, 1, 5, 0.98)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Render drifting particles
      t += 0.02;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.speedX;
        p.y += p.speedY;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        const currentOpacity = Math.abs(Math.sin(t * p.pulseSpeed + i)) * p.opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.hue === 345
          ? `rgba(255, 64, 129, ${currentOpacity})`
          : `rgba(255, 183, 3, ${currentOpacity})`;
        ctx.shadowBlur = p.size * 3;
        ctx.shadowColor = p.hue === 345 ? '#ff4081' : '#ffb703';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Choreographed Stage Progression
  useEffect(() => {
    // Stage 1: Ignite laser beam (0ms)
    setStage('ignite');

    // Stage 2: 3D Monogram Ribbon Assemble & Audio Crescendo (400ms)
    const t1 = setTimeout(() => {
      setStage('assemble');
      playCinematicSound();
    }, 420);

    // Stage 3: Anamorphic Starburst & Ta-Dum Impact (1100ms)
    const t2 = setTimeout(() => {
      setStage('crescendo');
      setCanSkip(true);
    }, 1100);

    // Stage 4: Wordmark & Tagline Reveal (1600ms)
    const t3 = setTimeout(() => {
      setStage('reveal');
    }, 1600);

    // Stage 5: Exit Portal Dissolve into Home Screen (2500ms)
    const t4 = setTimeout(() => {
      setStage('exit');
      exitTimeoutRef.current = setTimeout(() => {
        if (onComplete) onComplete();
      }, 550);
    }, 2550);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [playCinematicSound, onComplete]);

  // Instant Skip on Tap or Space
  const handleSkip = useCallback(() => {
    if (stage === 'exit') return;
    setStage('exit');
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    exitTimeoutRef.current = setTimeout(() => {
      if (onComplete) onComplete();
    }, 300);
  }, [stage, onComplete]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleSkip]);

  return (
    <div
      className={`vf-intro-surface ${stage}`}
      onClick={handleSkip}
      role="banner"
      aria-label="MovieFlix Cinematic Introduction"
    >
      {/* Particle & Nebula Canvas */}
      <canvas ref={canvasRef} className="vf-intro-canvas" />

      {/* Anamorphic Laser Horizon Beam */}
      <div className="vf-intro-laser-line" aria-hidden="true" />
      <div className="vf-intro-lens-flare" aria-hidden="true" />

      {/* Main 3D Logo Stage */}
      <div className="vf-intro-stage">
        {/* Glowing Backlight Aura */}
        <div className="vf-intro-aura" aria-hidden="true" />

        {/* 3D Kinetic Prism Emblem */}
        <div className="vf-intro-monogram-wrap">
          <svg
            viewBox="0 0 100 100"
            className="vf-intro-emblem-svg"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
          >
            <defs>
              <linearGradient id="intro-grad-left" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff0055" />
                <stop offset="50%" stopColor="#f43f5e" />
                <stop offset="100%" stopColor="#9f1239" />
              </linearGradient>

              <linearGradient id="intro-grad-diag-l" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff2a55" />
                <stop offset="55%" stopColor="#e11d48" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>

              <linearGradient id="intro-grad-diag-r" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="50%" stopColor="#ff6b00" />
                <stop offset="100%" stopColor="#ffb703" />
              </linearGradient>

              <linearGradient id="intro-grad-right" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ff2a55" />
                <stop offset="50%" stopColor="#ff6b00" />
                <stop offset="100%" stopColor="#ffb703" />
              </linearGradient>

              <linearGradient id="intro-grad-nexus" x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="50%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#4338ca" />
              </linearGradient>

              <linearGradient id="intro-grad-play" x1="0%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#fde047" />
              </linearGradient>

              <filter id="intro-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="5" result="blur1" />
                <feGaussianBlur stdDeviation="10" result="blur2" />
                <feMerge>
                  <feMergeNode in="blur2" />
                  <feMergeNode in="blur1" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Left Pillar */}
            <path
              className="vf-intro-path left-pillar"
              d="M 16 20 L 29 20 L 29 80 L 16 80 Z"
              fill="url(#intro-grad-left)"
              filter="url(#intro-glow)"
            />

            {/* Left Pillar Bevel Highlight */}
            <path
              className="vf-intro-bevel left-pillar-bevel"
              d="M 16 20 L 19 20 L 19 80 L 16 80 Z"
              fill="#ffffff"
              opacity="0.35"
            />

            {/* Right Pillar */}
            <path
              className="vf-intro-path right-pillar"
              d="M 71 20 L 84 20 L 84 80 L 71 80 Z"
              fill="url(#intro-grad-right)"
              filter="url(#intro-glow)"
            />

            {/* Right Pillar Bevel Highlight */}
            <path
              className="vf-intro-bevel right-pillar-bevel"
              d="M 81 20 L 84 20 L 84 80 L 81 80 Z"
              fill="#fffbeb"
              opacity="0.55"
            />

            {/* Left Diagonal Ribbon */}
            <path
              className="vf-intro-path diag-left-ribbon"
              d="M 24 20 L 37 20 L 50 46 L 50 72 Z"
              fill="url(#intro-grad-diag-l)"
              filter="url(#intro-glow)"
            />

            {/* Left Diagonal Highlight Bevel */}
            <path
              className="vf-intro-bevel diag-left-bevel"
              d="M 24 20 L 27 20 L 50 66 L 50 72 Z"
              fill="#ffffff"
              opacity="0.45"
            />

            {/* Right Diagonal Ribbon */}
            <path
              className="vf-intro-path diag-right-ribbon"
              d="M 63 20 L 76 20 L 50 72 L 50 46 Z"
              fill="url(#intro-grad-diag-r)"
              filter="url(#intro-glow)"
            />

            {/* Right Diagonal Highlight Bevel */}
            <path
              className="vf-intro-bevel diag-right-bevel"
              d="M 73 20 L 76 20 L 50 72 L 50 66 Z"
              fill="#fffbeb"
              opacity="0.45"
            />

            {/* Nexus Keystone Valley */}
            <path
              className="vf-intro-path nexus-keystone"
              d="M 44 60 L 50 48 L 56 60 L 50 72 Z"
              fill="url(#intro-grad-nexus)"
            />

            {/* Embedded Cinema Play Glyph */}
            <path
              className="vf-intro-play-glyph"
              d="M 44 26 L 56 33 L 44 40 Z"
              fill="url(#intro-grad-play)"
            />

            {/* Apex Horizon Anamorphic Star Spark */}
            <g className="vf-intro-crest-star" transform="translate(84, 20)">
              <line x1="-16" y1="0" x2="16" y2="0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
              <line x1="0" y1="-16" x2="0" y2="16" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
              <circle cx="0" cy="0" r="3.5" fill="#ffffff" />
            </g>
          </svg>
        </div>

        {/* Cinematic Kinetic Wordmark */}
        <div className="vf-intro-wordmark-row">
          <span className="vf-letter" style={{ animationDelay: '0.04s' }}>M</span>
          <span className="vf-letter" style={{ animationDelay: '0.08s' }}>O</span>
          <span className="vf-letter" style={{ animationDelay: '0.12s' }}>V</span>
          <span className="vf-letter" style={{ animationDelay: '0.16s' }}>I</span>
          <span className="vf-letter" style={{ animationDelay: '0.20s' }}>E</span>
          <span className="vf-letter accent" style={{ animationDelay: '0.24s' }}>F</span>
          <span className="vf-letter accent" style={{ animationDelay: '0.28s' }}>L</span>
          <span className="vf-letter accent" style={{ animationDelay: '0.32s' }}>I</span>
          <span className="vf-letter accent" style={{ animationDelay: '0.36s' }}>X</span>
        </div>

        {/* Hollywood Subtitle Tagline */}
        <div className="vf-intro-tagline">
          <span>YOUR PERSONAL CINEMA</span>
        </div>
      </div>

      {/* Bottom Sleek Laser Loading Meter */}
      <div className="vf-intro-footer">
        <div className="vf-intro-meter-track">
          <div className="vf-intro-meter-bar" />
        </div>
        {canSkip && (
          <span className="vf-intro-skip-pill">
            Tap anywhere to enter
          </span>
        )}
      </div>
    </div>
  );
}
