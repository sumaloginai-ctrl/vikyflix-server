import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { StatusBar } from '@capacitor/status-bar';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import {
  subtitleKeyFor,
  reviveStoredSubtitles,
  storeSubtitle,
  removeStoredSubtitle
} from './subtitleStore';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Volume1,
  Maximize2,
  Minimize2,
  ArrowLeft,
  X,
  Subtitles,
  Gauge,
  Check,
  Trash2,
  Upload,
  Search,
  Download,
  Loader2,
  Settings,
  Headphones,
  Sun,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Clapperboard
} from 'lucide-react';

import { API_BASE } from './config';
import { reportPlayerError } from './telemetry.js';
import { reportPlay, reportPlayEnd, reportPlayProgress } from './activity.js';
import { cleanCatalogTitle as cleanPlayTitle } from './onlineLibrary';
import './styles/player.css';

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const SEEK_STEP = 10;

const VIEW_MODES = [
  { id: 'contain', label: 'Fit to Screen', desc: 'Original aspect ratio', short: 'FIT' },
  { id: 'cover', label: 'Zoom to Fill', desc: 'Fills entire screen', short: 'FILL' },
  { id: '16-9', label: '16:9 Cinema', desc: 'Standard widescreen', short: '16:9' }
];

const QUALITY_OPTIONS = [
  { id: 'auto', label: 'Auto', tag: 'AUTO' },
  { id: '4k', label: '4K (2160p)', tag: '4K' },
  { id: '1080p', label: '1080p (FHD)', tag: '1080p' },
  { id: '720p', label: '720p (HD)', tag: '720p' },
  { id: '480p', label: '480p (SD)', tag: '480p' }
];

// Online (MovieBox) streams are direct MP4s our proxy serves in discrete CDN
// resolutions — no transcode ladder, so the menu offers exactly what the
// source has (the server picks the nearest available when one is missing).
const ONLINE_QUALITY_OPTIONS = [
  { id: 'auto', label: 'Auto', tag: 'AUTO' },
  { id: '1080', label: '1080p (FHD)', tag: '1080p' },
  { id: '720', label: '720p (HD)', tag: '720p' },
  { id: '480', label: '480p (SD)', tag: '480p' },
  { id: '360', label: '360p', tag: '360p' }
];

export default function VideoPlayer({ movie, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const hudTimeoutRef = useRef(null);
  const hlsRef = useRef(null);
  const fileInputRef = useRef(null);
  const tapTimerRef = useRef(null);
  const menusOpenRef = useRef(false);

  // Touch tracking refs
  const touchStartRef = useRef({ x: 0, y: 0, time: 0, isBrightness: false, isVolume: false, startVal: 0, isGestureActive: false, hasMoved: false });
  const lastTapRef = useRef({ time: 0, x: 0, zone: null });
  const lastTouchTimeRef = useRef(0);
  const ignoreClickUntilRef = useRef(0);

  // Player state
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [streamError, setStreamError] = useState(null);
  // Absolute movie-time (seconds) at which the current transcoded stream begins.
  // Seeking far ahead restarts the transcode from this offset via ?start=.
  const [streamStart, setStreamStart] = useState(0);
  const [duration, setDuration] = useState(movie.duration || 0);
  const [volume, setVolume] = useState(1);
  const [brightness, setBrightness] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('vikyflix_view_mode') || 'cover';
    } catch (e) {
      return 'cover';
    }
  });
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showRemainingTime, setShowRemainingTime] = useState(false);
  // Seek bar: the position the head is dragged to (null = not scrubbing) and
  // how much of the timeline the decoder has already buffered.
  const [scrubTime, setScrubTime] = useState(null);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [seekHint, setSeekHint] = useState(null);

  // On-screen HUD feedback
  const [gestureHUD, setGestureHUD] = useState(null);
  const [viewToast, setViewToast] = useState(null);

  // Track state
  const [movieDetails, setMovieDetails] = useState(movie);
  const [selectedAudioIndex, setSelectedAudioIndex] = useState(null);
  const [activeSubtitle, setActiveSubtitle] = useState({ type: 'none', label: 'Off' });
  const [customSubtitles, setCustomSubtitles] = useState([]);

  // Modals & Menus
  const [showOnlineSubModal, setShowOnlineSubModal] = useState(false);

  // Dropdown menus
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);

  // Online Subtitles Search State
  const [onlineSubs, setOnlineSubs] = useState([]);
  const [searchingSubs, setSearchingSubs] = useState(false);
  const [subSearchQuery, setSubSearchQuery] = useState(movie.title);
  const [downloadingSubId, setDownloadingSubId] = useState(null);

  // 2X Speed Long Press State & Refs
  const [is2xSpeedActive, setIs2xSpeedActive] = useState(false);
  const longPressTimerRef = useRef(null);
  const previousSpeedRef = useRef(1.0);
  const isHolding2xRef = useRef(false);

  // Episode navigation state — a series episode can step to its neighbours
  // without leaving the player (online: ?se=&ep=, local: swap the stream).
  const [mediaOverride, setMediaOverride] = useState(null);
  const [onlineEpisode, setOnlineEpisode] = useState(null);
  const [episodeList, setEpisodeList] = useState([]);
  const [episodeIndex, setEpisodeIndex] = useState(-1);

  const startLongPress2x = useCallback(() => {
    if (!videoRef.current || showOnlineSubModal) return;
    previousSpeedRef.current = videoRef.current.playbackRate || playbackSpeed || 1.0;

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

    longPressTimerRef.current = setTimeout(() => {
      isHolding2xRef.current = true;
      if (videoRef.current) {
        videoRef.current.playbackRate = 2.0;
      }
      setIs2xSpeedActive(true);
      try {
        if (navigator.vibrate) navigator.vibrate(35);
      } catch (e) {}
    }, 380);
  }, [showOnlineSubModal, playbackSpeed]);

  const endLongPress2x = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isHolding2xRef.current) {
      isHolding2xRef.current = false;
      if (videoRef.current) {
        videoRef.current.playbackRate = previousSpeedRef.current || 1.0;
      }
      setIs2xSpeedActive(false);
      return true;
    }
    return false;
  }, []);

  const isPlayingRef = useRef(isPlaying);
  const showModalRef = useRef(showOnlineSubModal);
  const streamStartRef = useRef(0);
  // Playback position to restore after swapping to an alternate audio edition
  const audioResumeRef = useRef(null);
  const recoverAndPlayRef = useRef(null);
  const pauseTimestampRef = useRef(0);

  // Initial playback position to restore on start (Continue Watching / Resume)
  const initialResumeRef = useRef((() => {
    try {
      if (movie.watchProgress && movie.watchProgress > 10) {
        return Math.floor(movie.watchProgress);
      }
      const stored = JSON.parse(localStorage.getItem('vickyflix_watch_progress') || '{}');
      const item = stored[movie.id];
      if (item && item.currentTime > 10 && (!item.duration || item.currentTime / item.duration < 0.95)) {
        return Math.floor(item.currentTime);
      }
    } catch (e) {}
    return 0;
  })());
  const lastAutoRecoverRef = useRef(0);

  // MovieBox titles stream through the proxy with CDN-pinned resolutions
  const isOnlineTitle = movie.source === 'MovieBox' || String(movie.id || '').startsWith('mb_');
  const isOnlineMovieRef = useRef(isOnlineTitle);

  // The media that is actually playing. It only differs from the `movie` prop
  // while the user steps through a local series' episodes.
  const media = mediaOverride || movie;

  // Which episode of a series is on screen (online shows override it with
  // the ?se=&ep= pair, local series carry it on the episode itself).
  // For any series title, default to Season 1, Episode 1 if not explicitly specified.
  const isSeriesShow = Boolean(media.isSeries || media.subjectType === 2 || media.seriesTitle);
  const activeSeasonNumber = isSeriesShow ? (onlineEpisode?.season ?? media.seasonNumber ?? 1) : null;
  const activeEpisodeNumber = isSeriesShow ? (onlineEpisode?.episode ?? media.episodeNumber ?? 1) : null;
  const hasEpisodeContext = isSeriesShow && activeSeasonNumber != null && activeEpisodeNumber != null;

  // ---- watch-time tracking: what was watched + for how long ----
  const watchSessionRef = useRef(null);
  const watchTickRef = useRef(null);
  const lastProgressSentRef = useRef(0);

  const endWatchSession = () => {
    const session = watchSessionRef.current;
    if (watchTickRef.current) { clearInterval(watchTickRef.current); watchTickRef.current = null; }
    watchSessionRef.current = null;
    if (!session) return;
    const watchedSeconds = Math.round(session.watchedMs / 1000);
    if (watchedSeconds < 2) return; // tap-and-close noise
    reportPlayEnd({
      playId: session.playId,
      mediaId: session.mediaId,
      title: session.title,
      se: session.se,
      ep: session.ep,
      watchedSeconds,
      percent: Math.round(session.percent || 0),
      completed: (session.percent || 0) >= 90
    });
  };

  const beginWatchSession = () => {
    if (watchSessionRef.current) return;
    const session = {
      playId: `ply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      mediaId: media && (media.id || media.subjectId),
      title: media && media.title,
      se: hasEpisodeContext ? activeSeasonNumber : undefined,
      ep: hasEpisodeContext ? activeEpisodeNumber : undefined,
      watchedMs: 0,
      percent: 0
    };
    watchSessionRef.current = session;
    reportPlay({ mediaId: session.mediaId, title: session.title, se: session.se, ep: session.ep, playId: session.playId });
    lastProgressSentRef.current = Date.now();
    // Count real playing time only (paused/seeking/buffering are excluded).
    watchTickRef.current = setInterval(() => {
      const current = watchSessionRef.current;
      const video = videoRef.current;
      if (!current || !video) return;
      if (!video.paused && !video.seeking && video.readyState >= 2) current.watchedMs += 1000;
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        current.percent = Math.min(100, (video.currentTime / video.duration) * 100);
      }
      if (Date.now() - lastProgressSentRef.current >= 60000) {
        lastProgressSentRef.current = Date.now();
        reportPlayProgress({
          playId: current.playId,
          mediaId: current.mediaId,
          title: current.title,
          se: current.se,
          ep: current.ep,
          watchedSeconds: Math.round(current.watchedMs / 1000),
          percent: Math.round(current.percent || 0)
        });
      }
    }, 1000);
  };

  // End the session when the player unmounts or switches to another title.
  useEffect(() => () => { endWatchSession(); }, [media.id]);

  // Persistent subtitles: downloaded/imported tracks survive leaving the
  // player (and app restarts). Stored per title — and per episode for
  // series, so switching episodes swaps in that episode's saved set.
  const subtitleStoreKey = useMemo(
    () => subtitleKeyFor(media, activeSeasonNumber, activeEpisodeNumber),
    [media.id, media.subjectId, activeSeasonNumber, activeEpisodeNumber]
  );
  const subtitleStoreKeyRef = useRef(subtitleStoreKey);
  useEffect(() => {
    subtitleStoreKeyRef.current = subtitleStoreKey;
    setCustomSubtitles(reviveStoredSubtitles(subtitleStoreKey));
    setActiveSubtitle(prev =>
      prev.type === 'custom'
        ? { type: 'none', label: 'Off' }
        : prev
    );
  }, [subtitleStoreKey]);

  // Immersive playback: hide the Android status bar (wifi / data icons),
  // enter fullscreen and lock to landscape the moment the player opens.
  // Everything is restored when the player closes.
  // Landscape the moment the player opens (the ScreenOrientation plugin does
  // the real rotation inside the Android WebView — the DOM orientation API
  // silently rejects lock() there). The web fullscreen call is NOT used: it
  // swallows the Android system navigation bar. All restored on close.
  useEffect(() => {
    const native = window.Capacitor?.isNativePlatform?.();
    if (native) {
      try { StatusBar.hide().catch(() => {}); } catch (e) {}
    }

    // Modern Android Immersive Sticky Fullscreen: completely hides bottom navigation gestures & status bar
    try {
      if (window.AndroidFullscreen?.enterImmersive) {
        window.AndroidFullscreen.enterImmersive();
      }
    } catch (e) {}

    // HTML5 Element Fullscreen
    try {
      const el = containerRef.current || document.documentElement;
      if (el && el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el && el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } catch (e) {}

    (async () => {
      try {
        await ScreenOrientation.lock({ orientation: 'landscape' });
      } catch (e) {
        try {
          if (window.screen?.orientation?.lock) {
            window.screen.orientation.lock('landscape').catch(() => {});
          }
        } catch (e2) {}
      }
    })();
    setIsFullscreen(true);

    return () => {
      try {
        if (window.AndroidFullscreen?.exitImmersive) {
          window.AndroidFullscreen.exitImmersive();
        }
      } catch (e) {}

      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
      } catch (e) {}

      (async () => {
        try {
          await ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
          await ScreenOrientation.unlock().catch(() => {});
        } catch (e) {}
      })();
      try {
        if (window.screen?.orientation?.unlock) {
          window.screen.orientation.unlock();
        }
      } catch (e) {}
      if (native) {
        try { StatusBar.hide().catch(() => {}); } catch (e) {}
      }
    };
  }, []);

  // Keep the stream-offset ref in sync for use inside stable callbacks.
  useEffect(() => {
    streamStartRef.current = streamStart;
  }, [streamStart]);

  // Synchronize modal state refs
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    showModalRef.current = showOnlineSubModal;
  }, [isPlaying, showOnlineSubModal]);

  // Keep the "a menu is open" flag in a ref so the auto-hide timer can keep
  // the chrome up while the user reads a menu.
  useEffect(() => {
    menusOpenRef.current =
      showAudioMenu || showSubtitleMenu || showSpeedMenu || showQualityMenu || showViewMenu;
  }, [showAudioMenu, showSubtitleMenu, showSpeedMenu, showQualityMenu, showViewMenu]);

  const closeAllMenus = useCallback(() => {
    setShowAudioMenu(false);
    setShowSubtitleMenu(false);
    setShowSpeedMenu(false);
    setShowQualityMenu(false);
    setShowViewMenu(false);
  }, []);

  // Controls hide/show timer — 3.5s of inactivity, then the chrome slides
  // away. While a menu is open the chrome stays put (the next interaction
  // re-arms the timer).
  const armControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlayingRef.current && !showModalRef.current && !menusOpenRef.current) {
        setShowControls(false);
        closeAllMenus();
      }
    }, 3500);
  }, [closeAllMenus]);

  const triggerShowControls = useCallback(() => {
    setShowControls(true);
    armControlsTimeout();
  }, [armControlsTimeout]);

  // Playback control actions
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const isStalePause = pauseTimestampRef.current > 0 && (Date.now() - pauseTimestampRef.current > 20000);
      pauseTimestampRef.current = 0;

      // If the stream dropped, disconnected or errored while paused, recover cleanly
      if (isStalePause || video.error || video.readyState === 0 || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        if (recoverAndPlayRef.current) {
          recoverAndPlayRef.current(video.currentTime || currentTime);
          return;
        }
      }
      video.play().then(() => {
        setIsPlaying(true);
        setStreamError(null);
      }).catch((err) => {
        console.warn('[Player] play() failed after pause, initiating recovery:', err);
        if (recoverAndPlayRef.current) {
          recoverAndPlayRef.current(video.currentTime || currentTime);
        }
      });
    } else {
      video.pause();
      pauseTimestampRef.current = Date.now();
      setIsPlaying(false);
    }
  }, [currentTime]);

  // Seek to an absolute movie-time. If the target is within the region the
  // current stream already covers, seek in place; otherwise restart the
  // transcode from that point (via streamStart -> ?start=) so playback lands
  // exactly where the user picked instead of clamping to the buffered end.
  const seekToAbsolute = useCallback((target) => {
    const video = videoRef.current;
    const maxDur = (movieDetails?.duration && movieDetails.duration > 60)
      ? movieDetails.duration
      : (media.duration && media.duration > 60)
      ? media.duration
      : duration || 100;
    const clamped = Math.max(0, Math.min(target, maxDur));

    if (!video) {
      setStreamStart(clamped);
      setCurrentTime(clamped);
      return;
    }

    const rel = clamped - streamStartRef.current;
    let seekableEnd = 0;
    try {
      if (video.seekable && video.seekable.length > 0) {
        seekableEnd = video.seekable.end(video.seekable.length - 1);
      }
    } catch (e) {}

    if (rel >= 0 && rel <= seekableEnd + 0.5) {
      video.currentTime = rel;
      setCurrentTime(clamped);
    } else {
      setLoading(true);
      setStreamStart(clamped);
      setCurrentTime(clamped);
    }
  }, [duration, media.duration, movieDetails]);

  const seekBy = useCallback((seconds) => {
    const video = videoRef.current;
    const base = streamStartRef.current + (video?.currentTime || 0);
    seekToAbsolute(base + seconds);
  }, [seekToAbsolute]);

  // Scrubbing: the head follows the finger, the stream is only re-pointed
  // once the gesture ends (one seek, not a seek per pixel).
  const handleScrubInput = useCallback((e) => {
    setScrubTime(parseFloat(e.target.value));
  }, []);

  const commitScrub = useCallback(() => {
    if (scrubTime == null) return;
    seekToAbsolute(scrubTime);
    setScrubTime(null);
    triggerShowControls();
  }, [scrubTime, seekToAbsolute, triggerShowControls]);

  const updateBuffered = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    let end = 0;
    try {
      if (!v.buffered || v.buffered.length === 0) return;
      const t = v.currentTime || 0;
      for (let i = 0; i < v.buffered.length; i++) {
        const s = v.buffered.start(i);
        const e = v.buffered.end(i);
        if (t >= s - 0.5 && t <= e) { end = e; break; }
        if (e > end) end = e;
      }
    } catch (e) {
      return;
    }
    setBufferedTime(streamStartRef.current + end);
  }, []);

  const adjustVolume = useCallback((delta) => {
    const video = videoRef.current;
    if (!video) return;
    const newVol = Math.max(0, Math.min(1, volume + delta));
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
    setGestureHUD({ type: 'volume', value: Math.round(newVol * 100) });
    setTimeout(() => setGestureHUD(null), 1000);
  }, [volume]);

  const toggleMute = useCallback((e) => {
    if (e) e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    const currentMuted = video.muted || isMuted || (volume === 0);
    const nextMuted = !currentMuted;

    video.muted = nextMuted;
    setIsMuted(nextMuted);

    if (!nextMuted) {
      const targetVol = volume > 0 ? volume : 1.0;
      video.volume = targetVol;
      setVolume(targetVol);
      setGestureHUD({ type: 'volume', value: Math.round(targetVol * 100) });
      setViewToast(`Sound On (${Math.round(targetVol * 100)}%)`);
    } else {
      setGestureHUD({ type: 'volume', value: 0 });
      setViewToast('Sound Muted');
    }

    setTimeout(() => {
      setGestureHUD(null);
      setViewToast(null);
    }, 1200);
  }, [isMuted, volume]);

  const handleSpeedChange = useCallback((speed) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = speed;
      setPlaybackSpeed(speed);
      setShowSpeedMenu(false);
    }
    triggerShowControls();
  }, [triggerShowControls]);

  const handleViewModeChange = useCallback((mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('vikyflix_view_mode', mode);
    } catch (e) {}
    setShowViewMenu(false);
    const found = VIEW_MODES.find(m => m.id === mode);
    setViewToast(found ? found.label : mode);
    setTimeout(() => setViewToast(null), 1400);
    triggerShowControls();
  }, [triggerShowControls]);

  const toggleViewModeFitFill = useCallback(() => {
    const nextMode = viewMode === 'cover' ? 'contain' : 'cover';
    handleViewModeChange(nextMode);
  }, [viewMode, handleViewModeChange]);

  const cycleViewMode = useCallback(() => {
    const ids = VIEW_MODES.map(m => m.id);
    const currIdx = ids.indexOf(viewMode);
    const nextIdx = (currIdx + 1) % ids.length;
    handleViewModeChange(ids[nextIdx]);
  }, [viewMode, handleViewModeChange]);

  const handleQualityChange = useCallback((q) => {
    if (q === selectedQuality) {
      setShowQualityMenu(false);
      return;
    }
    // Preserve the playback position across the reload (same mechanism the
    // audio-edition swap uses) — both local and online streams.
    const v = videoRef.current;
    if (v && v.currentTime > 0) {
      audioResumeRef.current = v.currentTime;
    }
    setSelectedQuality(q);
    setShowQualityMenu(false);
    const pool = isOnlineMovieRef.current ? ONLINE_QUALITY_OPTIONS : QUALITY_OPTIONS;
    const found = pool.find(item => item.id === q);
    setViewToast(found ? `Quality: ${found.label}` : q);
    setTimeout(() => setViewToast(null), 1400);
  }, [selectedQuality]);

  // Fullscreen Handler - Guaranteed 1-Click Toggle
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const isCurrentlyFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );

    if (!isCurrentlyFullscreen) {
      try {
        if (window.AndroidFullscreen?.enterImmersive) {
          window.AndroidFullscreen.enterImmersive();
        }
      } catch (e) {}
      try {
        if (container.requestFullscreen) container.requestFullscreen().catch(() => {});
        else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
      } catch (e) {}
      (async () => {
        try {
          await ScreenOrientation.lock({ type: 'landscape' });
        } catch (e) {
          try {
            if (window.screen?.orientation?.lock) {
              window.screen.orientation.lock('landscape').catch(() => {});
            }
          } catch (e2) {}
        }
      })();
      setIsFullscreen(true);
    } else {
      try {
        if (window.AndroidFullscreen?.exitImmersive) {
          window.AndroidFullscreen.exitImmersive();
        }
      } catch (e) {}
      try {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch (e) {}
      (async () => {
        try {
          await ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
          await ScreenOrientation.unlock().catch(() => {});
        } catch (e) {}
      })();
      try {
        if (window.screen?.orientation?.unlock) {
          window.screen.orientation.unlock();
        }
      } catch (e) {}
      setIsFullscreen(false);
    }
  }, []);

  // Fetch full details if tracks not present (local library items only —
  // MovieBox online items have no /api/movies/:id record)
  useEffect(() => {
    const isOnlineMovie = media.source === 'MovieBox' || String(media.id || '').startsWith('mb_');
    if (!isOnlineMovie && (!media.tracks || !media.duration)) {
      fetch(`${API_BASE}/api/movies/${media.id}`)
        .then(r => r.json())
        .then(data => {
          if (data.movie) {
            setMovieDetails(data.movie);
            if (data.movie.duration) {
              setDuration(prev => prev || data.movie.duration);
            }
          }
        })
        .catch(() => {});
    }
  }, [media.id, media.tracks, media.duration]);

  // Clean stream URL
  const getStreamUrl = useCallback(() => {
    // MovieBox online items:
    const isOnline = media.source === 'MovieBox' || String(media.id || '').startsWith('mb_');
    if (isOnline) {
      const qs = new URLSearchParams();
      const versions = media.audioVersions || [];
      let targetSubjectId = media.subjectId || String(media.id || '').replace(/^mb_/, '');
      let targetDetailPath = media.detailPath || '';

      if (selectedAudioIndex !== null && versions[selectedAudioIndex]) {
        targetSubjectId = versions[selectedAudioIndex].subjectId;
        if (versions[selectedAudioIndex].detailPath) {
          targetDetailPath = versions[selectedAudioIndex].detailPath;
        }
        qs.set('audio', versions[selectedAudioIndex].subjectId);
      }
      if (isSeriesShow && activeSeasonNumber != null && activeEpisodeNumber != null) {
        qs.set('se', String(activeSeasonNumber));
        qs.set('ep', String(activeEpisodeNumber));
      }
      if (['360', '480', '720', '1080'].includes(selectedQuality)) {
        qs.set('res', selectedQuality);
      }

      // 1. Android APK: Stremio Method (Direct in-app streaming server on 127.0.0.1)
      // Resolves upstream and pipes chunks directly on the phone's residential connection
      // Zero home PC bandwidth, zero disk writes, 24/7 global playback
      if (window.AndroidStreamBridge?.getPort) {
        try {
          const localPort = window.AndroidStreamBridge.getPort();
          if (localPort > 0) {
            const localQs = new URLSearchParams();
            localQs.set('subjectId', targetSubjectId);
            if (targetDetailPath) localQs.set('detailPath', targetDetailPath);
            if (isSeriesShow && activeSeasonNumber != null && activeEpisodeNumber != null) {
              localQs.set('se', String(activeSeasonNumber));
              localQs.set('ep', String(activeEpisodeNumber));
            }
            if (['360', '480', '720', '1080'].includes(selectedQuality)) {
              localQs.set('res', selectedQuality);
            }
            return `http://127.0.0.1:${localPort}/play?${localQs.toString()}`;
          }
        } catch (e) {
          console.warn('[Stremio] Native stream fallback:', e);
        }
      }

      // 2. Fallback for Desktop Web / Browser (routes through PC proxy)
      const q = qs.toString();
      return `${API_BASE}/api/moviebox/stream/${media.id}${q ? `?${q}` : ''}`;
    }

    if (media.videoUrl) return media.videoUrl;

    const params = new URLSearchParams();
    if (selectedAudioIndex !== null) params.append('audioIndex', selectedAudioIndex);
    if (selectedQuality !== 'auto') params.append('quality', selectedQuality);
    if (streamStart > 0) params.append('start', Math.floor(streamStart));

    const qs = params.toString();
    return `${API_BASE}/api/stream/${media.id}/index.m3u8${qs ? `?${qs}` : ''}`;
  }, [media.id, media.videoUrl, media.source, media.subjectId, media.detailPath, media.audioVersions, activeSeasonNumber, activeEpisodeNumber, selectedAudioIndex, selectedQuality, streamStart]);

  const streamUrl = getStreamUrl();

  const recoverAndPlay = useCallback((resumeTime) => {
    const video = videoRef.current;
    if (!video) return;
    setLoading(true);
    setStreamError(null);
    const targetTime = resumeTime !== undefined ? resumeTime : (video.currentTime || currentTime || 0);

    const isDirectMp4 = streamUrl.endsWith('.mp4') || streamUrl.includes('.mp4?') || !streamUrl.includes('.m3u8');
    if (isDirectMp4) {
      const freshUrl = streamUrl + (streamUrl.includes('?') ? '&' : '?') + 'r=' + Date.now();
      try {
        video.pause();
      } catch (e) {}

      let recovered = false;
      const onReady = () => {
        if (recovered) return;
        recovered = true;

        const startPlayback = () => {
          video.play().then(() => {
            setIsPlaying(true);
            setLoading(false);
            setStreamError(null);
          }).catch((err) => {
            console.warn('[Player] Play after recovery failed, retrying muted:', err);
            video.muted = true;
            setIsMuted(true);
            video.play().then(() => {
              setIsPlaying(true);
              setLoading(false);
              setStreamError(null);
            }).catch(() => setLoading(false));
          });
        };

        if (targetTime > 0) {
          try {
            video.currentTime = targetTime;
          } catch (e) {}
          video.addEventListener('seeked', startPlayback, { once: true });
          setTimeout(startPlayback, 1000);
        } else {
          startPlayback();
        }
      };

      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.src = freshUrl;
      video.load();
    } else if (hlsRef.current) {
      const hls = hlsRef.current;
      hls.stopLoad();
      hls.loadSource(streamUrl);
      hls.startLoad(targetTime > 0 ? targetTime : -1);

      const onManifest = () => {
        const startPlayback = () => {
          video.play().then(() => {
            setIsPlaying(true);
            setLoading(false);
            setStreamError(null);
          }).catch(() => {
            video.muted = true;
            setIsMuted(true);
            video.play().then(() => {
              setIsPlaying(true);
              setLoading(false);
              setStreamError(null);
            }).catch(() => setLoading(false));
          });
        };

        if (targetTime > 0) {
          try {
            video.currentTime = targetTime;
          } catch (e) {}
          video.addEventListener('seeked', startPlayback, { once: true });
          setTimeout(startPlayback, 1000);
        } else {
          startPlayback();
        }
      };
      hls.once(Hls.Events.MANIFEST_PARSED, onManifest);
    }
  }, [streamUrl, currentTime]);

  useEffect(() => {
    recoverAndPlayRef.current = recoverAndPlay;
  }, [recoverAndPlay]);

  // Surface failures instead of spinning forever: if no data has arrived
  // after 40s, show the error overlay (Retry / Close).
  useEffect(() => {
    setStreamError(null);
    const t = setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.readyState === 0) {
        setStreamError('Connection is taking too long. The stream may be busy right now.');
      }
    }, 40000);
    return () => clearTimeout(t);
  }, [streamUrl]);

  // Initialize HLS Player or Native MP4 Stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isDirectMp4 = streamUrl.endsWith('.mp4') || streamUrl.includes('.mp4?') || !streamUrl.includes('.m3u8');

    if (isDirectMp4) {
      video.src = streamUrl;
      const onNativeReady = () => {
        setLoading(false);
        const resumePos = audioResumeRef.current != null
          ? audioResumeRef.current
          : (initialResumeRef.current > 0 ? initialResumeRef.current : 0);
        audioResumeRef.current = null;
        initialResumeRef.current = 0;

        const startPlayback = () => {
          video.play().then(() => {
            setIsPlaying(true);
            setLoading(false);
            setStreamError(null);
          }).catch(() => {
            video.muted = true;
            setIsMuted(true);
            video.play().then(() => {
              setIsPlaying(true);
              setLoading(false);
            }).catch(() => {});
          });
        };

        if (resumePos > 0) {
          try {
            video.currentTime = resumePos;
            setCurrentTime(resumePos);
          } catch (e) {}
          video.addEventListener('seeked', startPlayback, { once: true });
          setTimeout(startPlayback, 1000);
        } else {
          startPlayback();
        }
      };
      video.addEventListener('loadedmetadata', onNativeReady, { once: true });
      video.addEventListener('canplay', () => setLoading(false));
      video.addEventListener('loadeddata', () => setLoading(false));
      return () => {
        video.removeEventListener('loadedmetadata', onNativeReady);
      };
    } else if (Hls.isSupported()) {
      const resumePos = initialResumeRef.current > 0 ? initialResumeRef.current : -1;
      const hls = new Hls({
        enableWorker: true,
        startPosition: resumePos,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 60,
        maxMaxBufferLength: 180,
        maxBufferSize: 80 * 1000 * 1000,
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeMaxRetry: 10,
        nudgeOffset: 0.1,
        manifestLoadingTimeOut: 25000,
        manifestLoadingMaxRetry: 10,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 25000,
        levelLoadingMaxRetry: 10,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 500
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        const targetResume = initialResumeRef.current;
        initialResumeRef.current = 0;

        const startPlayback = () => {
          video.play().then(() => {
            setIsPlaying(true);
            setLoading(false);
            setStreamError(null);
          }).catch(() => {
            video.muted = true;
            setIsMuted(true);
            video.play().catch(() => {});
          });
        };

        if (targetResume > 0) {
          try {
            video.currentTime = targetResume;
            setCurrentTime(targetResume);
          } catch (e) {}
          video.addEventListener('seeked', startPlayback, { once: true });
          setTimeout(startPlayback, 1000);
        } else {
          startPlayback();
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setLoading(false);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS] Network error, auto-recovering...', data.details);
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS] Media error, auto-recovering...', data.details);
              hls.recoverMediaError();
              break;
            default:
              console.warn('[HLS] Fatal error, restarting stream...', data.details);
              reportPlayerError({ kind: 'hls_fatal', code: data.details, detail: data.type, mediaId: media && media.id });
              hls.destroy();
              break;
          }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          // If video buffer momentarily stalls, gently nudge playback to continue
          if (video && !video.paused && video.readyState >= 2) {
            video.play().catch(() => {});
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      const onNativeReady = () => {
        setLoading(false);
        const resumePos = audioResumeRef.current != null
          ? audioResumeRef.current
          : (initialResumeRef.current > 0 ? initialResumeRef.current : 0);
        audioResumeRef.current = null;
        initialResumeRef.current = 0;

        const startPlayback = () => {
          video.play().then(() => {
            setIsPlaying(true);
            setLoading(false);
            setStreamError(null);
          }).catch(() => {
            video.muted = true;
            setIsMuted(true);
            video.play().catch(() => {});
          });
        };

        if (resumePos > 0) {
          try {
            video.currentTime = resumePos;
            setCurrentTime(resumePos);
          } catch (e) {}
          video.addEventListener('seeked', startPlayback, { once: true });
          setTimeout(startPlayback, 1000);
        } else {
          startPlayback();
        }
      };
      video.addEventListener('loadedmetadata', onNativeReady, { once: true });
      video.addEventListener('canplay', () => setLoading(false));
      video.addEventListener('loadeddata', () => setLoading(false));
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl]);

  // Generate stable session id for this player instance
  const sessionIdRef = useRef(`session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);

  // On unmount / close player: Immediately tell server to terminate background FFmpeg transcode
  useEffect(() => {
    return () => {
      if (media?.id) {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`${API_BASE}/api/stream/${media.id}/stop?sessionId=${sessionIdRef.current}`);
        } else {
          fetch(`${API_BASE}/api/stream/${media.id}/stop?sessionId=${sessionIdRef.current}`).catch(() => {});
        }
      }
    };
  }, [media?.id]);

  // Save watch progress to localStorage for Continue Watching shelf
  useEffect(() => {
    if (!media?.id || !currentTime || currentTime < 10) return;
    try {
      const stored = JSON.parse(localStorage.getItem('vickyflix_watch_progress') || '{}');
      const totalDur = movieDetails?.duration || media?.duration || duration || 1;
      if (currentTime / totalDur > 0.95) {
        delete stored[media.id];
      } else {
        stored[media.id] = {
          movieId: media.id,
          subjectId: media.subjectId,
          detailPath: media.detailPath || movieDetails?.detailPath || null,
          movieTitle: movieDetails?.title || media.title,
          poster: media.poster || movieDetails?.poster,
          isSeries: Boolean(isSeriesShow),
          seasonNumber: isSeriesShow ? activeSeasonNumber : null,
          episodeNumber: isSeriesShow ? activeEpisodeNumber : null,
          currentTime: Math.floor(currentTime),
          duration: Math.floor(totalDur),
          lastWatched: Date.now()
        };
      }
      localStorage.setItem('vickyflix_watch_progress', JSON.stringify(stored));
    } catch (e) {}
  }, [media?.id, Math.floor(currentTime / 5), duration, movieDetails?.duration, media?.duration, activeSeasonNumber, activeEpisodeNumber, isSeriesShow]);

  // Synchronize auto-hide timer on play
  useEffect(() => {
    if (isPlaying && !showOnlineSubModal) {
      triggerShowControls();
    }
  }, [isPlaying, showOnlineSubModal, triggerShowControls]);

  // Timers are cleared when the player goes away.
  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, []);

  // Single tap toggles the chrome. Shared by mouse clicks and the delayed
  // touch path (a second tap inside the window becomes a seek instead).
  const applyToggleControls = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setShowControls((prev) => {
      const nextState = !prev;
      if (!nextState) {
        closeAllMenus();
      }
      return nextState;
    });
    setTimeout(() => {
      setShowControls((current) => {
        if (current) {
          if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = setTimeout(() => {
            if (isPlayingRef.current && !showModalRef.current && !menusOpenRef.current) {
              setShowControls(false);
              closeAllMenus();
            }
          }, 4000);
        }
        return current;
      });
    }, 40);
  }, [closeAllMenus]);

  // Toggle controls on single tap/click
  const handleToggleControls = (e) => {
    if (Date.now() < ignoreClickUntilRef.current) {
      return;
    }

    if (isHolding2xRef.current) return;

    if (
      e.target.closest('.player-top-bar') ||
      e.target.closest('.player-bottom-bar') ||
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('.floating-menu') ||
      e.target.closest('.online-sub-modal-card') ||
      e.target.closest('.gesture-hud-card') ||
      e.target.closest('.unmute-banner-pill') ||
      e.target.closest('.center-transport-overlay')
    ) {
      return;
    }

    applyToggleControls();
  };

  // Mouse handlers for desktop click-and-hold 2x speed
  const handleMouseDown = (e) => {
    if (
      e.target.closest('.player-top-bar') ||
      e.target.closest('.player-bottom-bar') ||
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('.floating-menu') ||
      e.target.closest('.online-sub-modal-card') ||
      e.target.closest('.unmute-banner-pill') ||
      e.target.closest('.center-transport-overlay')
    ) {
      return;
    }
    startLongPress2x();
  };

  const handleMouseUp = () => {
    endLongPress2x();
  };

  // Touch Gestures: Long Press 2X Speed, Left Thumb Brightness, Right Thumb Volume
  const handleTouchStart = (e) => {
    lastTouchTimeRef.current = Date.now();
    const touch = e.touches[0];
    if (!touch || !containerRef.current || showOnlineSubModal) return;

    if (
      e.target.closest('.player-top-bar') ||
      e.target.closest('.player-bottom-bar') ||
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('.floating-menu') ||
      e.target.closest('.online-sub-modal-card') ||
      e.target.closest('.unmute-banner-pill') ||
      e.target.closest('.center-transport-overlay')
    ) {
      touchStartRef.current.isGestureActive = false;
      return;
    }

    startLongPress2x();

    const rect = containerRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const isLeftHalf = x < rect.width / 2;

    touchStartRef.current = {
      x,
      y,
      time: Date.now(),
      isGestureActive: true,
      hasMoved: false,
      isBrightness: isLeftHalf,
      isVolume: !isLeftHalf,
      startVal: isLeftHalf ? brightness : (videoRef.current?.volume ?? volume)
    };
  };

  const handleTouchMove = (e) => {
    lastTouchTimeRef.current = Date.now();
    const touch = e.touches[0];
    if (!touch || !containerRef.current || showOnlineSubModal || !touchStartRef.current?.isGestureActive) return;

    const rect = containerRef.current.getBoundingClientRect();
    const currentY = touch.clientY - rect.top;
    const deltaX = touch.clientX - rect.left - touchStartRef.current.x;
    const deltaY = touchStartRef.current.y - currentY;
    const sensitivity = rect.height * 0.75;

    // If movement is detected, cancel 2X long-press timer
    if (Math.abs(deltaY) > 15 || Math.abs(deltaX) > 15) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }

    // Require deliberate vertical drag for HUD
    if (Math.abs(deltaY) > 25 && Math.abs(deltaY) > Math.abs(deltaX) * 1.3 && !isHolding2xRef.current) {
      touchStartRef.current.hasMoved = true;
      if (touchStartRef.current.isBrightness) {
        const newBright = Math.min(1.5, Math.max(0.2, touchStartRef.current.startVal + (deltaY / sensitivity)));
        setBrightness(newBright);
        setGestureHUD({ type: 'brightness', value: Math.round((newBright / 1.5) * 100) });
      } else if (touchStartRef.current.isVolume) {
        const newVol = Math.min(1, Math.max(0, touchStartRef.current.startVal + (deltaY / sensitivity)));
        if (videoRef.current) {
          videoRef.current.volume = newVol;
          videoRef.current.muted = newVol === 0;
        }
        setVolume(newVol);
        setIsMuted(newVol === 0);
        setGestureHUD({ type: 'volume', value: Math.round(newVol * 100) });
      }
    }
  };

  const handleTouchEnd = (e) => {
    const now = Date.now();
    lastTouchTimeRef.current = now;

    if (gestureHUD) {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
      hudTimeoutRef.current = setTimeout(() => setGestureHUD(null), 900);
    }

    const wasHolding2x = endLongPress2x();
    if (wasHolding2x) {
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch || !containerRef.current || showOnlineSubModal) return;

    if (
      e.target.closest('.player-top-bar') ||
      e.target.closest('.player-bottom-bar') ||
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('.floating-menu') ||
      e.target.closest('.online-sub-modal-card') ||
      e.target.closest('.unmute-banner-pill') ||
      e.target.closest('.center-transport-overlay')
    ) {
      return;
    }

    if (touchStartRef.current?.hasMoved) {
      touchStartRef.current.isGestureActive = false;
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;

    const touchDuration = now - (touchStartRef.current?.time || now);
    const touchDistance = Math.abs(touch.clientY - rect.top - (touchStartRef.current?.y || (touch.clientY - rect.top)));

    if (touchDistance > 20) return;

    // Tap zones: the outer thirds seek on a double tap, the middle third is
    // the plain "toggle the chrome" surface.
    const zone = x < rect.width / 3 ? 'left' : (x > (rect.width * 2) / 3 ? 'right' : 'center');
    const last = lastTapRef.current;

    if (zone !== 'center' && last.zone === zone && now - last.time < 320 && touchDuration < 300) {
      // Double tap on the left/right third → jump 10 seconds
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = { time: 0, x: 0, zone: null };
      const delta = zone === 'left' ? -SEEK_STEP : SEEK_STEP;
      seekBy(delta);
      setSeekHint({ zone, delta });
      setTimeout(() => setSeekHint(null), 700);
      triggerShowControls();
      return;
    }

    if (zone === 'center' && last.zone === 'center' && now - last.time < 320 && touchDuration < 300) {
      // Double tap in the center zone → instant toggle between Zoom to Fill (Full Screen) and Fit to Screen
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = { time: 0, x: 0, zone: null };
      toggleViewModeFitFill();
      return;
    }

    ignoreClickUntilRef.current = Date.now() + 600;
    lastTapRef.current = { time: now, x, zone };

    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }

    applyToggleControls();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || showOnlineSubModal) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
        case 'enter':
        case 'select':
        case 'mediaplaypause':
        case 'mediaplay':
        case 'mediapause':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
        case 'j':
        case 'mediarewind':
          e.preventDefault();
          seekBy(-SEEK_STEP);
          break;
        case 'arrowright':
        case 'l':
        case 'mediafastforward':
          e.preventDefault();
          seekBy(SEEK_STEP);
          break;
        case 'arrowup':
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case 'arrowdown':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'v':
          e.preventDefault();
          cycleViewMode();
          break;
        case 'escape':
        case 'back':
        case 'browserback':
          e.preventDefault();
          if (menusOpenRef.current) {
            closeAllMenus();
          } else {
            onClose();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seekBy, adjustVolume, toggleFullscreen, toggleMute, cycleViewMode, onClose, showOnlineSubModal, closeAllMenus]);

  // Fullscreen & Orientation Listeners
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement ||
        videoRef.current?.webkitDisplayingFullscreen
      );
      setIsFullscreen(isFs);
      triggerShowControls();
    };

    const handleOrientationChange = () => {
      triggerShowControls();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);

    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', handleOrientationChange);
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);

      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', handleOrientationChange);
      }
    };
  }, [triggerShowControls]);

  // ------------------------------------------------------------------
  // Episode navigation
  // ------------------------------------------------------------------
  // A series episode arrives with season/episode numbers. For online
  // (MovieBox) shows the server's episode map tells us what else exists, so
  // the transport row can step through ?se=&ep=. For local series the same
  // information comes from the library's series tree.
  useEffect(() => {
    if (!movie.episodeNumber || !movie.seasonNumber) return undefined;
    let dead = false;

    if (isOnlineTitle) {
      if (!movie.subjectId) return undefined;

      // Stremio method: native Android fetches seasons directly via local residential proxy
      if (window.AndroidStreamBridge?.getPort) {
        try {
          const localPort = window.AndroidStreamBridge.getPort();
          if (localPort > 0 && movie.detailPath) {
            fetch(`http://127.0.0.1:${localPort}/episodes?detailPath=${encodeURIComponent(movie.detailPath)}`)
              .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
              .then(d => {
                if (dead) return;
                const seasons = (d.seasons || [])
                  .map(s => ({ se: Number(s.se), maxEp: Number(s.maxEp) || 0 }))
                  .filter(s => s.se && s.maxEp > 0)
                  .sort((a, b) => a.se - b.se);
                const list = [];
                seasons.forEach(s => {
                  for (let e = 1; e <= s.maxEp; e++) list.push({ season: s.se, episode: e });
                });
                const idx = list.findIndex(e => e.season === movie.seasonNumber && e.episode === movie.episodeNumber);
                setEpisodeList(list);
                setEpisodeIndex(idx);
              })
              .catch(() => {});
            return () => { dead = true; };
          }
        } catch (e) {
          console.warn('[Stremio] Native episodes fallback:', e);
        }
      }

      fetch(`${API_BASE}/api/moviebox/episodes/${movie.subjectId}`)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(d => {
          if (dead) return;
          const seasons = (d.seasons || [])
            .map(s => ({ se: Number(s.se), maxEp: Number(s.maxEp) || 0 }))
            .filter(s => s.se && s.maxEp > 0)
            .sort((a, b) => a.se - b.se);
          const list = [];
          seasons.forEach(s => {
            for (let e = 1; e <= s.maxEp; e++) list.push({ season: s.se, episode: e });
          });
          const idx = list.findIndex(e => e.season === movie.seasonNumber && e.episode === movie.episodeNumber);
          setEpisodeList(list);
          setEpisodeIndex(idx);
        })
        .catch(() => {});
      return () => { dead = true; };
    }

    fetch(`${API_BASE}/api/series`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (dead) return;
        const shows = d.series || [];
        const show = shows.find(s =>
          (s.seasons || []).some(se => (se.episodes || []).some(ep => ep.id === movie.id))
        );
        if (!show) return;
        const list = [];
        (show.seasons || []).forEach(se => {
          (se.episodes || []).forEach(ep => {
            list.push({
              ...ep,
              seasonNumber: se.seasonNumber,
              episodeNumber: ep.episodeNumber,
              seriesTitle: show.title
            });
          });
        });
        const idx = list.findIndex(ep => ep.id === movie.id);
        setEpisodeList(list);
        setEpisodeIndex(idx);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [movie.id, movie.episodeNumber, movie.seasonNumber, movie.subjectId, isOnlineTitle]);

  const prevEpisode = episodeIndex > 0 ? episodeList[episodeIndex - 1] : null;
  const nextEpisode = (episodeIndex >= 0 && episodeIndex < episodeList.length - 1) ? episodeList[episodeIndex + 1] : null;

  const switchEpisode = useCallback((entry) => {
    if (!entry) return;
    audioResumeRef.current = null;
    setStreamStart(0);
    setCurrentTime(0);
    setBufferedTime(0);
    setScrubTime(null);
    setSelectedAudioIndex(null);
    setActiveSubtitle({ type: 'none', label: 'Off' });
    setDuration(entry.duration || 0);
    setLoading(true);
    if (isOnlineTitle) {
      setOnlineEpisode({ season: entry.season, episode: entry.episode });
      setEpisodeIndex(episodeList.findIndex(e => e.season === entry.season && e.episode === entry.episode));
      setViewToast(`Episode ${entry.episode}`);
    } else {
      setMediaOverride({ ...entry });
      setMovieDetails({ ...entry });
      setEpisodeIndex(episodeList.findIndex(e => e.id === entry.id));
      setViewToast(`Episode ${entry.episodeNumber}`);
    }
    setTimeout(() => setViewToast(null), 1400);
    triggerShowControls();
  }, [episodeList, isOnlineTitle, triggerShowControls]);

const ISO_LANG_MAP = {
  eng: 'English', hin: 'Hindi', tam: 'Tamil', tel: 'Telugu',
  mal: 'Malayalam', kan: 'Kannada', ben: 'Bengali', pan: 'Punjabi',
  spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian',
  rus: 'Russian', ara: 'Arabic', tur: 'Turkish', por: 'Portuguese',
  kor: 'Korean', jpn: 'Japanese', zho: 'Chinese', chi: 'Chinese',
  ind: 'Indonesian', vie: 'Vietnamese', tha: 'Thai', dut: 'Dutch',
  pol: 'Polish', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish'
};

  // Subtitle File Import
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        try {
          const isVtt = text.trim().startsWith('WEBVTT');
          const vttContent = isVtt ? text : ('WEBVTT\n\n' + text.replace(/\r\n|\r/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
          const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
          const blobUrl = URL.createObjectURL(blob);
          const label = file.name.replace(/\.(srt|vtt|sub)$/i, '');
          // Persist so the subtitle survives leaving the player
          const stored = storeSubtitle(subtitleStoreKeyRef.current, { label, vtt: vttContent });
          const newTrack = { type: 'custom', url: blobUrl, label, _storedId: stored?.id };
          setCustomSubtitles(prev => [...prev, newTrack]);
          setActiveSubtitle(newTrack);
          closeAllMenus();
          setViewToast(`Imported: ${label}`);
          setTimeout(() => setViewToast(null), 1500);
        } catch (err) {
          alert('Error importing subtitle file');
        }
      }
    };
    reader.readAsText(file);
  };

  // Search Online Subtitles
  const searchSubtitles = async () => {
    setSearchingSubs(true);
    setOnlineSubs([]);
    const cleanTitle = cleanPlayTitle(subSearchQuery || media.title || '');

    // 1. First, search OpenSubtitles globally via IMDb suggestion API (0 server dependence)
    try {
      const q = cleanTitle.toLowerCase().replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').trim();
      if (q) {
        const imdbRes = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${q}.json`);
        if (imdbRes.ok) {
          const imdbData = await imdbRes.json();
          const items = imdbData.d || [];
          const best = items.find(d => d.id?.startsWith('tt')) || items[0];
          if (best?.id) {
            const imdbId = best.id;
            const subApiUrl = (activeSeasonNumber != null && activeEpisodeNumber != null)
              ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${activeSeasonNumber}:${activeEpisodeNumber}.json`
              : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;

            const subRes = await fetch(subApiUrl);
            if (subRes.ok) {
              const subData = await subRes.json();
              const list = subData.subtitles || [];
              if (list.length > 0) {
                const mapped = list.map((s, idx) => ({
                  id: s.id || `sub_${idx}`,
                  lang: ISO_LANG_MAP[s.lang] || s.lang?.toUpperCase() || 'Subtitle',
                  name: s.subtitleFileName || `${ISO_LANG_MAP[s.lang] || s.lang} Subtitle`,
                  sourceUrl: s.url,
                  url: s.url
                }));
                setOnlineSubs(mapped);
                setSearchingSubs(false);
                return;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Subtitles] OpenSubtitles direct search failed, trying server:', e);
    }

    // 2. Fallback to server search
    try {
      const res = await fetch(`${API_BASE}/api/movies/${media.id}/subtitles/online?query=${encodeURIComponent(cleanTitle)}&year=${media.year || ''}`);
      if (res.ok) {
        const data = await res.json();
        setOnlineSubs(data.subtitles || []);
      }
    } catch (err) {
      console.error('[Subtitles] Server search error:', err);
    } finally {
      setSearchingSubs(false);
    }
  };

  const handleOpenOnlineSearch = () => {
    closeAllMenus();
    setShowOnlineSubModal(true);
    searchSubtitles();
  };

  const handleDownloadOnlineSub = async (sub, subKey) => {
    setDownloadingSubId(subKey);
    try {
      // 1. Direct fetch if URL is a direct subtitle link (CORS: *)
      const subUrl = sub.url || sub.sourceUrl;
      if (subUrl && (subUrl.startsWith('https://subs5.strem.io') || subUrl.startsWith('http'))) {
        try {
          const r = await fetch(subUrl);
          if (r.ok) {
            const srtText = await r.text();
            const isVtt = srtText.trim().startsWith('WEBVTT');
            const vttContent = isVtt ? srtText : ('WEBVTT\n\n' + srtText.replace(/\r\n|\r/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
            const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const label = `${sub.lang} (Online)`;
            // Persist so the download survives leaving the player
            const stored = storeSubtitle(subtitleStoreKeyRef.current, { label, vtt: vttContent });
            const newTrack = { type: 'custom', url: blobUrl, label, _storedId: stored?.id };
            setCustomSubtitles(prev => [...prev, newTrack]);
            setActiveSubtitle(newTrack);
            setShowOnlineSubModal(false);
            setViewToast(`Subtitle Activated: ${sub.lang}`);
            setTimeout(() => setViewToast(null), 1500);
            return;
          }
        } catch (directErr) {
          console.warn('[Subtitles] Direct download failed, trying server proxy:', directErr);
        }
      }

      // 2. Server proxy fallback
      const res = await fetch(`${API_BASE}/api/movies/${media.id}/subtitles/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: sub.sourceUrl || sub.url,
          lang: sub.lang,
          name: sub.name
        })
      });
      const data = await res.json();
      if (data.success) {
        const label = `${sub.lang} (Online)`;
        let vttUrl = data.vttUrl;
        let storedId = null;
        // Persist the subtitle text so it survives leaving the player.
        // (The server URL also persists, but a local copy works offline
        // and keeps every stored track uniform.)
        try {
          const vttRes = await fetch(data.vttUrl);
          if (vttRes.ok) {
            const vttText = await vttRes.text();
            const stored = storeSubtitle(subtitleStoreKeyRef.current, { label, vtt: vttText });
            if (stored) {
              storedId = stored.id;
              const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
              vttUrl = URL.createObjectURL(blob);
            }
          }
        } catch (persistErr) {
          console.warn('[Subtitles] Could not persist, using server URL:', persistErr);
        }
        const newTrack = { type: 'custom', url: vttUrl, label, _storedId: storedId };
        setCustomSubtitles(prev => [...prev, newTrack]);
        setActiveSubtitle(newTrack);
        setShowOnlineSubModal(false);
        setViewToast(`Subtitle Activated: ${sub.lang}`);
        setTimeout(() => setViewToast(null), 1500);
      }
    } catch {
      alert('Failed to download subtitle. Please try another option.');
    } finally {
      setDownloadingSubId(null);
    }
  };

  const formatTime = (secs) => {
    if (isNaN(secs) || secs <= 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getVideoClasses = () => {
    switch (viewMode) {
      case 'cover':
        return 'pro-video mode-cover';
      case 'fill':
        return 'pro-video mode-fill';
      case '16-9':
        return 'pro-video mode-widescreen';
      case 'contain':
      default:
        return 'pro-video mode-contain';
    }
  };

  const fullMovieDuration = (movieDetails?.duration && movieDetails.duration > 60)
    ? movieDetails.duration
    : (media.duration && media.duration > 60)
    ? media.duration
    : duration;

  const audioTracks = movieDetails?.tracks?.audioTracks || [];
  // MovieBox dub editions ("[Hindi]" / "(English)") surface through the same
  // Audio menu as local tracks — each entry is an alternate upstream subject
  // whose stream the proxy resolves on demand.
  const onlineAudioVersions = isOnlineTitle ? (media.audioVersions || []) : [];
  const subtitleTracks = movieDetails?.tracks?.subtitleTracks || [];
  const activeSubtitleSrc = activeSubtitle.type === 'embedded'
    ? `${API_BASE}/api/movies/${media.id}/subtitles/${activeSubtitle.index}.vtt`
    : activeSubtitle.type === 'custom'
    ? (activeSubtitle.url.startsWith('blob:') || activeSubtitle.url.startsWith('http')
        ? activeSubtitle.url
        : `${API_BASE}${activeSubtitle.url}`)
    : null;

  // The one and only quality/size indicator lives in the top bar.
  const qualityPool = isOnlineTitle ? ONLINE_QUALITY_OPTIONS : QUALITY_OPTIONS;
  const qualityTag = qualityPool.find(q => q.id === selectedQuality)?.tag || String(selectedQuality).toUpperCase();

  // Seek bar geometry
  const seekValue = scrubTime != null ? scrubTime : currentTime;
  const playedPct = fullMovieDuration > 0 ? Math.min(100, (seekValue / fullMovieDuration) * 100) : 0;
  const bufferedPct = fullMovieDuration > 0 ? Math.min(100, (bufferedTime / fullMovieDuration) * 100) : 0;
  const hasAudioEditions = onlineAudioVersions.length > 1 || audioTracks.length > 0;
  const hasSubtitles = subtitleTracks.length > 0 || customSubtitles.length > 0;
  const viewModeLabel = VIEW_MODES.find(m => m.id === viewMode)?.short || 'FIT';

  const audioButtonLabel = (() => {
    if (!hasAudioEditions) return 'Audio edition unavailable';
    if (selectedAudioIndex === null) return 'Audio edition: default';
    const ver = onlineAudioVersions[selectedAudioIndex];
    return ver?.language ? `Audio edition: ${ver.language}` : 'Audio edition';
  })();

  return (
    <div
      ref={containerRef}
      className={`pro-player-root ${isFullscreen ? 'fullscreen' : ''} ${is2xSpeedActive ? 'speed-2x-active' : ''}`}
      onClick={handleToggleControls}
      onMouseMove={triggerShowControls}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={endLongPress2x}
      onContextMenu={(e) => e.preventDefault()}
      style={{ filter: `brightness(${brightness})` }}
    >
      {/* 2X Speed Long-Press Floating Badge */}
      {is2xSpeedActive && (
        <div className="speed-2x-badge-pill">
          <span className="speed-2x-icon">⏩</span>
          <span className="speed-2x-text">2X Speed</span>
        </div>
      )}

      {/* Hidden File Input for Subtitle Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".srt,.vtt,.sub,.txt"
        style={{ display: 'none' }}
      />

      {/* Brightness / Volume HUD Slider */}
      {gestureHUD && (
        <div
          className={`gesture-hud-card ${gestureHUD.type === 'brightness' ? 'left-hud ply-hud-brightness' : 'right-hud'} ${gestureHUD.type !== 'brightness' && gestureHUD.value === 0 ? 'ply-hud-muted' : ''}`}
        >
          <div className="gesture-hud-icon">
            {gestureHUD.type === 'brightness' ? (
              <Sun size={24} />
            ) : gestureHUD.value === 0 ? (
              <VolumeX size={24} />
            ) : gestureHUD.value < 50 ? (
              <Volume1 size={24} />
            ) : (
              <Volume2 size={24} />
            )}
          </div>
          <div className="gesture-hud-bar-track">
            <div
              className="gesture-hud-bar-fill"
              style={{ height: `${gestureHUD.value}%` }}
            ></div>
          </div>
          <span className="gesture-hud-value">{gestureHUD.value}%</span>
        </div>
      )}

      {/* Toast Notification */}
      {viewToast && (
        <div className="view-mode-toast">
          <span>{viewToast}</span>
        </div>
      )}

      {/* Double-tap seek feedback */}
      {seekHint && (
        <div className={`ply-seek-hint ${seekHint.zone === 'left' ? 'is-left' : 'is-right'}`}>
          {seekHint.delta > 0 ? `+${seekHint.delta}s` : `${seekHint.delta}s`}
        </div>
      )}

      {/* Center transport — primary touch controls shown whenever chrome is visible */}
      {showControls && !loading && !streamError && (
        <div className="center-transport-overlay">
          {prevEpisode && (
            <button
              className="transport-circle-btn seek-side-btn episode-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                switchEpisode(prevEpisode);
                triggerShowControls();
              }}
              title="Previous episode"
              aria-label="Previous episode"
            >
              <SkipBack size={22} />
            </button>
          )}

          {/* Rewind 10s */}
          <button
            className="transport-circle-btn seek-side-btn"
            onClick={(e) => {
              e.stopPropagation();
              seekBy(-SEEK_STEP);
              triggerShowControls();
            }}
            title="Rewind 10s"
            aria-label="Rewind 10 seconds"
          >
            <Rewind size={26} />
          </button>

          {/* Center Main Play / Pause / Resume Button */}
          <button
            className="transport-circle-btn main-play-pause-btn"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
              triggerShowControls();
            }}
            title={isPlaying ? 'Pause' : 'Resume Playback'}
            aria-label={isPlaying ? 'Pause' : 'Resume'}
          >
            {isPlaying ? (
              <Pause size={32} fill="currentColor" />
            ) : (
              <Play size={32} fill="currentColor" style={{ marginLeft: '4px' }} />
            )}
          </button>

          {/* Forward 10s */}
          <button
            className="transport-circle-btn seek-side-btn"
            onClick={(e) => {
              e.stopPropagation();
              seekBy(SEEK_STEP);
              triggerShowControls();
            }}
            title="Forward 10s"
            aria-label="Forward 10 seconds"
          >
            <FastForward size={26} />
          </button>

        </div>
      )}

      {/* Unmute Pill when Autoplaying Muted */}
      {isMuted && isPlaying && !loading && (
        <button
          className="unmute-banner-pill"
          onClick={(e) => {
            e.stopPropagation();
            toggleMute(e);
          }}
          aria-label="Tap to Unmute"
        >
          <VolumeX size={16} />
          <span>Tap to Unmute</span>
        </button>
      )}

      {/* Ambient Backlight Glow Canvas */}
      <div className="player-ambient-backlight" aria-hidden="true" />

      {/* Video Element */}
      <video
        ref={videoRef}
        className={getVideoClasses()}
        playsInline
        webkit-playsinline="true"
        autoPlay
        crossOrigin="anonymous"
        onContextMenu={(e) => e.preventDefault()}
        onTimeUpdate={() => {
          if (loading) setLoading(false);
          setCurrentTime(streamStartRef.current + (videoRef.current?.currentTime || 0));
        }}
        onDurationChange={() => {
          const vd = videoRef.current?.duration;
          if (vd && isFinite(vd) && vd > 60 && (!media.duration || vd > media.duration)) {
            setDuration(vd);
          }
        }}
        onCanPlay={() => setLoading(false)}
        onLoadedData={() => setLoading(false)}
        onProgress={updateBuffered}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false);
          setStreamError(null);
          setIsPlaying(true);
          beginWatchSession();
        }}
        onPause={() => {
          setIsPlaying(false);
          pauseTimestampRef.current = Date.now();
        }}
        onEnded={() => {
          setIsPlaying(false);
          endWatchSession();
        }}
        onError={() => {
          const code = videoRef.current?.error?.code;
          console.warn('[Player] Video error code:', code);
          reportPlayerError({ kind: 'video_element', code, mediaId: media && media.id });
          // Try auto-recovery once before giving up
          const now = Date.now();
          if (now - lastAutoRecoverRef.current > 4000) {
            lastAutoRecoverRef.current = now;
            console.log('[Player] Initiating auto-recovery from stream error...');
            if (recoverAndPlayRef.current) {
              recoverAndPlayRef.current(videoRef.current?.currentTime || currentTime || 0);
              return;
            }
          }
          setLoading(false);
          setStreamError('This stream could not be loaded right now. Please try again in a moment.');
        }}
      >
        {activeSubtitleSrc && (
          <track
            key={activeSubtitleSrc}
            kind="subtitles"
            src={activeSubtitleSrc}
            srcLang="en"
            label={activeSubtitle.label}
            default
          />
        )}
      </video>

      {/* Buffering Indicator — branded Beam loader */}
      {loading && !streamError && (
        <div className="player-buffering">
          <div className="vf-loader-stack">
            <div className="vf-loader">
              <div className="vf-loader-gem">
                <Clapperboard size={22} />
              </div>
            </div>
            <span className="vf-loader-text">Streaming video ({selectedQuality.toUpperCase()})</span>
          </div>
        </div>
      )}

      {/* Playback Error Overlay */}
      {streamError && (
        <div className="player-error-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="player-error-card">
            <div className="player-error-icon"><TriangleAlert size={30} /></div>
            <h3>Playback Problem</h3>
            <p>{streamError}</p>
            <div className="player-error-actions">
              <button
                className="player-error-btn retry"
                onClick={() => {
                  setStreamError(null);
                  if (recoverAndPlayRef.current) {
                    recoverAndPlayRef.current(currentTime);
                  }
                }}
              >
                <RotateCcw size={16} />
                <span>Retry</span>
              </button>
              <button className="player-error-btn close" onClick={onClose}>
                <X size={16} />
                <span>Close Player</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header Overlay */}
      <div className={`player-top-bar ${showControls ? 'visible' : 'hidden'}`}>
        <div className="top-title-info">
          <button
            className="player-back-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Exit Player"
            aria-label="Exit player"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="top-title-wrap">
            <h3 title={media.title}>{cleanPlayTitle(media.title)}</h3>
            <div className="top-meta-row">
              {hasEpisodeContext && (
                <span className="ply-episode-chip">S{activeSeasonNumber} · E{activeEpisodeNumber}</span>
              )}
              <span className="top-quality-chip">{qualityTag}</span>
              {media.year && <span>• {media.year}</span>}
              {media.category && <span>• {media.category}</span>}
            </div>
          </div>
        </div>

        <div className="top-bar-quick-actions">
          {/* Audio edition */}
          <div className="menu-anchor">
            <button
              className={`ply-action-btn ${selectedAudioIndex !== null ? 'is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowAudioMenu(!showAudioMenu);
                setShowQualityMenu(false);
                setShowSubtitleMenu(false);
                setShowSpeedMenu(false);
                setShowViewMenu(false);
                triggerShowControls();
              }}
              title={audioButtonLabel}
              aria-label={audioButtonLabel}
              aria-haspopup="menu"
              aria-expanded={showAudioMenu}
            >
              <Headphones size={19} />
            </button>

            {showAudioMenu && (
              <div className="floating-menu audio-menu" role="menu">
                <div className="menu-title">Audio Edition</div>
                {!hasAudioEditions ? (
                  <div className="ply-menu-empty">
                    <Headphones size={18} />
                    <p>No alternate audio editions</p>
                    <span>This title is streamed with a single, fixed audio track.</span>
                  </div>
                ) : onlineAudioVersions.length > 1 ? (
                  onlineAudioVersions.map((ver, vi) => (
                    <button
                      key={ver.subjectId || vi}
                      className={`menu-option ${(selectedAudioIndex === null ? 0 : selectedAudioIndex) === vi ? 'selected' : ''}`}
                      onClick={() => {
                        // Remember the position so the new edition resumes there
                        const v = videoRef.current;
                        if (v && v.currentTime > 1) audioResumeRef.current = v.currentTime;
                        setSelectedAudioIndex(vi === 0 ? null : vi);
                        setShowAudioMenu(false);
                        triggerShowControls();
                      }}
                    >
                      <span>{ver.language}{vi === 0 ? ' (Default)' : ''}</span>
                      {(selectedAudioIndex === null ? 0 : selectedAudioIndex) === vi && <Check size={14} className="check-icon" />}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      className={`menu-option ${selectedAudioIndex === null ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedAudioIndex(null);
                        setShowAudioMenu(false);
                        triggerShowControls();
                      }}
                    >
                      <span>Default Audio</span>
                      {selectedAudioIndex === null && <Check size={14} className="check-icon" />}
                    </button>
                    {audioTracks.map((trk) => (
                      <button
                        key={trk.index}
                        className={`menu-option ${selectedAudioIndex === trk.index ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedAudioIndex(trk.index);
                          setShowAudioMenu(false);
                          triggerShowControls();
                        }}
                      >
                        <span>{trk.label}</span>
                        {selectedAudioIndex === trk.index && <Check size={14} className="check-icon" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Quality */}
          <div className="menu-anchor">
            <button
              className={`ply-action-btn ${showQualityMenu ? 'is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowQualityMenu(!showQualityMenu);
                setShowAudioMenu(false);
                setShowSubtitleMenu(false);
                setShowSpeedMenu(false);
                setShowViewMenu(false);
                triggerShowControls();
              }}
              title="Streaming quality"
              aria-label="Streaming quality"
              aria-haspopup="menu"
              aria-expanded={showQualityMenu}
            >
              <Settings size={19} />
            </button>

            {showQualityMenu && (
              <div className="floating-menu quality-menu" role="menu">
                <div className="menu-title">Quality</div>
                {qualityPool.map((q) => {
                  const isSelected = selectedQuality === q.id;
                  return (
                    <button
                      key={q.id}
                      className={`menu-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        handleQualityChange(q.id);
                        setShowQualityMenu(false);
                        triggerShowControls();
                      }}
                    >
                      <span>{q.label}</span>
                      {isSelected && <Check size={14} className="check-icon" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Playback speed */}
          <div className="menu-anchor">
            <button
              className="ply-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowSpeedMenu(!showSpeedMenu);
                setShowQualityMenu(false);
                setShowAudioMenu(false);
                setShowSubtitleMenu(false);
                setShowViewMenu(false);
                triggerShowControls();
              }}
              title={`Playback speed ${playbackSpeed}x`}
              aria-label={`Playback speed ${playbackSpeed}x`}
              aria-haspopup="menu"
              aria-expanded={showSpeedMenu}
            >
              <Gauge size={19} />
              {playbackSpeed !== 1.0 && <span className="btn-tag speed-tag">{playbackSpeed}x</span>}
            </button>

            {showSpeedMenu && (
              <div className="floating-menu speed-menu" role="menu">
                <div className="menu-title">Playback Speed</div>
                {SPEED_OPTIONS.map((speed) => (
                  <button
                    key={speed}
                    className={`menu-option ${playbackSpeed === speed ? 'selected' : ''}`}
                    onClick={() => handleSpeedChange(speed)}
                  >
                    <span>{speed === 1.0 ? 'Normal (1.0x)' : `${speed}x`}</span>
                    {playbackSpeed === speed && <Check size={14} className="check-icon" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subtitles */}
          <div className="menu-anchor">
            <button
              className={`ply-action-btn ${activeSubtitle.type !== 'none' ? 'is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowSubtitleMenu(!showSubtitleMenu);
                setShowQualityMenu(false);
                setShowAudioMenu(false);
                setShowSpeedMenu(false);
                setShowViewMenu(false);
                triggerShowControls();
              }}
              title="Subtitles"
              aria-label="Subtitles"
              aria-haspopup="menu"
              aria-expanded={showSubtitleMenu}
            >
              <Subtitles size={19} />
            </button>

            {showSubtitleMenu && (
              <div className="floating-menu subtitle-menu" role="menu">
                <div className="menu-title">Subtitles</div>

                <div className="sub-menu-actions">
                  <button
                    className="sub-action-pill"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} />
                    <span>Import .SRT / .VTT</span>
                  </button>
                  <button
                    className="sub-action-pill online"
                    onClick={handleOpenOnlineSearch}
                  >
                    <Search size={14} />
                    <span>Search Online</span>
                  </button>
                </div>

                {!hasSubtitles ? (
                  <div className="ply-menu-empty">
                    <Subtitles size={18} />
                    <p>No subtitles for this title</p>
                    <span>Import a subtitle file or search online to add one.</span>
                  </div>
                ) : (
                  <>
                    <button
                      className={`menu-option ${activeSubtitle.type === 'none' ? 'selected' : ''}`}
                      onClick={() => {
                        setActiveSubtitle({ type: 'none', label: 'Off' });
                        setShowSubtitleMenu(false);
                        triggerShowControls();
                      }}
                    >
                      <span>Off</span>
                      {activeSubtitle.type === 'none' && <Check size={14} className="check-icon" />}
                    </button>

                    {subtitleTracks.length > 0 && (
                      <div className="sub-section-header">Embedded in Video</div>
                    )}
                    {subtitleTracks.map((sub) => (
                      <button
                        key={sub.index}
                        className={`menu-option ${activeSubtitle.type === 'embedded' && activeSubtitle.index === sub.index ? 'selected' : ''}`}
                        onClick={() => {
                          setActiveSubtitle({ type: 'embedded', index: sub.index, label: sub.label });
                          setShowSubtitleMenu(false);
                          triggerShowControls();
                        }}
                      >
                        <span>{sub.label}</span>
                        {activeSubtitle.type === 'embedded' && activeSubtitle.index === sub.index && <Check size={14} className="check-icon" />}
                      </button>
                    ))}

                    {customSubtitles.length > 0 && (
                      <div className="sub-section-header">Imported & Downloaded</div>
                    )}
                    {customSubtitles.map((cs, idx) => (
                      <button
                        key={cs._storedId || idx}
                        className={`menu-option with-delete ${activeSubtitle.type === 'custom' && activeSubtitle.url === cs.url ? 'selected' : ''}`}
                        onClick={() => {
                          setActiveSubtitle(cs);
                          setShowSubtitleMenu(false);
                          triggerShowControls();
                        }}
                      >
                        <span>{cs.label}</span>
                        <span className="menu-option-actions">
                          {activeSubtitle.type === 'custom' && activeSubtitle.url === cs.url && <Check size={14} className="check-icon" />}
                          <span
                            className="sub-delete-btn"
                            role="button"
                            aria-label={`Delete ${cs.label}`}
                            title="Delete this saved subtitle"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeStoredSubtitle(subtitleStoreKeyRef.current, cs._storedId);
                              setCustomSubtitles(prev => prev.filter(p => p !== cs));
                              setActiveSubtitle(prev =>
                                prev.type === 'custom' && prev.url === cs.url
                                  ? { type: 'none', label: 'Off' }
                                  : prev
                              );
                              setViewToast(`Removed: ${cs.label}`);
                              setTimeout(() => setViewToast(null), 1400);
                            }}
                          >
                            <Trash2 size={13} />
                          </span>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <button
            className="quick-top-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Close Player"
            aria-label="Close player"
          >
            <X size={16} />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className={`player-bottom-bar ${showControls ? 'visible' : 'hidden'}`}>
        {/* 1 — Seek bar (buffered range + draggable head) */}
        <div className="progress-timeline-wrapper">
          <div className="ply-seek-track" aria-hidden="true">
            <div className="ply-seek-buffer" style={{ width: `${bufferedPct}%` }} />
            <div className="timeline-fill" style={{ width: `${playedPct}%` }} />
          </div>
          <input
            type="range"
            min="0"
            max={fullMovieDuration || 100}
            step="0.5"
            value={Math.max(0, Math.min(seekValue, fullMovieDuration || 100))}
            onChange={handleScrubInput}
            onPointerUp={commitScrub}
            onPointerCancel={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            className="timeline-slider"
            aria-label="Seek timeline"
            aria-valuetext={`${formatTime(seekValue)} of ${formatTime(fullMovieDuration)}`}
          />
        </div>

        {/* 2 — Metadata and quick actions row */}
        <div className="controls-row">
          <div className="ctrl-group-left">
            <button
              className="time-display"
              onClick={(e) => {
                e.stopPropagation();
                setShowRemainingTime(prev => !prev);
              }}
              title={showRemainingTime ? 'Showing remaining time (click for total duration)' : 'Showing total duration (click for remaining time)'}
              aria-label="Toggle remaining time"
            >
              <span>{formatTime(seekValue)}</span>
              <span className="time-sep">/</span>
              <span>{showRemainingTime ? `-${formatTime(Math.max(0, fullMovieDuration - seekValue))}` : formatTime(fullMovieDuration)}</span>
            </button>
          </div>

          <div className="ctrl-group-right">
            {nextEpisode && (
              <button
                className="ctrl-icon-btn episode-next-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  switchEpisode(nextEpisode);
                  triggerShowControls();
                }}
                title={`Next episode: ${nextEpisode.title || ''}`}
                aria-label="Next episode"
              >
                <SkipForward size={17} />
                <span className="btn-tag">Next</span>
              </button>
            )}
            <div className="volume-slider-group desktop-only">
              <button
                className="ctrl-icon-btn vol-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute(e);
                }}
                title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
                aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  e.stopPropagation();
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  setIsMuted(val === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = val;
                    videoRef.current.muted = (val === 0);
                  }
                }}
                className="volume-slider"
                aria-label="Volume slider"
              />
            </div>

            {/* Single Screen Size & Fit Control (Bottom Right) */}
            <button
              className="ctrl-icon-btn ply-fullscreen-btn"
              onClick={(e) => {
                e.stopPropagation();
                cycleViewMode();
                triggerShowControls();
              }}
              title={`Screen Size: ${VIEW_MODES.find(m => m.id === viewMode)?.label || 'Fit to Screen'} (Tap to change)`}
              aria-label={`Screen Size: ${VIEW_MODES.find(m => m.id === viewMode)?.label || 'Fit to Screen'}`}
            >
              {viewMode === 'cover' ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
            </button>
          </div>
        </div>
      </div>

        {/* Online Subtitle Search Modal */}
      {showOnlineSubModal && (
        <div className="online-sub-modal-backdrop" onClick={() => setShowOnlineSubModal(false)}>
          <div className="online-sub-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="online-sub-header">
              <div>
                <h3>Search Online Subtitles</h3>
                <span className="sub-modal-desc">Search &amp; download multilingual subtitles directly for {media.title}</span>
              </div>
              <button className="modal-close-icon" onClick={() => setShowOnlineSubModal(false)} aria-label="Close subtitle search">
                <X size={18} />
              </button>
            </div>

            {/* Search Input */}
            <div className="online-sub-search-row">
              <input
                type="text"
                value={subSearchQuery}
                onChange={(e) => setSubSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchSubtitles()}
                placeholder="Search movie title..."
                aria-label="Subtitle search query"
              />
              <button className="online-search-submit-btn" onClick={searchSubtitles} disabled={searchingSubs}>
                {searchingSubs ? <Loader2 size={16} className="spinning-icon" /> : <Search size={16} />}
                <span>Search</span>
              </button>
            </div>

            {/* Subtitle Results List */}
            <div className="online-sub-list-body">
              {searchingSubs ? (
                <div className="sub-loading-box">
                  <div className="vf-loader" style={{ '--vf-size': '46px' }}>
                    <div className="vf-loader-gem">
                      <Clapperboard size={16} />
                    </div>
                  </div>
                  <p>Searching worldwide subtitle databases...</p>
                </div>
              ) : onlineSubs.length === 0 ? (
                <div className="sub-empty-box">
                  <p>No subtitles found for "{subSearchQuery}". Try adjusting the title.</p>
                </div>
              ) : (
                onlineSubs.map((sub, index) => {
                  const subKey = sub.id || `${sub.lang}_${index}`;
                  const isThisDownloading = downloadingSubId === subKey;
                  return (
                    <div key={subKey} className="online-sub-item-card">
                      <div className="online-sub-info">
                        <span className="online-sub-lang">{sub.lang}</span>
                        <span className="online-sub-title" title={sub.name}>{sub.name}</span>
                      </div>
                      <button
                        className="online-sub-dl-btn"
                        onClick={() => handleDownloadOnlineSub(sub, subKey)}
                        disabled={downloadingSubId !== null}
                      >
                        {isThisDownloading ? (
                          <Loader2 size={14} className="spinning-icon" />
                        ) : (
                          <Download size={14} />
                        )}
                        <span>{isThisDownloading ? 'Downloading...' : 'Apply'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
