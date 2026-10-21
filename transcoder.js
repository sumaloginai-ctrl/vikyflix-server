const { spawn, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const activeTranscodes = new Map();

// Detect a working hardware H.264 encoder once, cached for the process lifetime.
// undefined = not probed yet, null = none available (use software libx264).
let cachedHwEncoder;
function detectHwEncoder() {
  if (cachedHwEncoder !== undefined) return cachedHwEncoder;

  // Escape hatch: set TRANSCODE_HW=off or force CPU
  if ((process.env.TRANSCODE_HW || '').toLowerCase() === 'off') {
    cachedHwEncoder = null;
    console.log('[Transcoder] Using libx264 ultrafast (multi-threaded software CPU).');
    return cachedHwEncoder;
  }

  // NVENC (NVIDIA) has low latency startup. Intel QSV has noticeable D3D context startup delay on Windows,
  // so we prefer NVENC if an NVIDIA GPU is installed, or software libx264 ultrafast (zerolatency) for 1-2s instant starts.
  const candidates = ['h264_nvenc'];
  for (const enc of candidates) {
    try {
      execSync(
        `ffmpeg -hide_banner -f lavfi -i testsrc=duration=1:size=640x360:rate=15 -c:v ${enc} -f null -`,
        { stdio: 'ignore', timeout: 3000 }
      );
      cachedHwEncoder = enc;
      console.log(`[Transcoder] Hardware encoder available: ${enc}`);
      return cachedHwEncoder;
    } catch (e) {}
  }

  cachedHwEncoder = null;
  console.log('[Transcoder] Using libx264 ultrafast zerolatency (multi-threaded CPU, instant start).');
  return cachedHwEncoder;
}

function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Generate thumbnail frame using FFmpeg
function generateLocalThumbnail(movie, cacheDir, callback) {
  const outputFolder = path.join(cacheDir, movie.id);
  const thumbPath = path.join(outputFolder, 'thumb.jpg');

  ensureDirExists(outputFolder);

  if (fs.existsSync(thumbPath)) {
    return callback(null, thumbPath);
  }

  const args = [
    '-ss', '00:02:00',
    '-i', movie.filePath,
    '-vframes', '1',
    '-q:v', '2',
    '-vf', 'scale=600:-1',
    '-y',
    thumbPath
  ];

  const proc = spawn('ffmpeg', args);
  proc.on('close', (code) => {
    if (fs.existsSync(thumbPath)) {
      callback(null, thumbPath);
    } else {
      const fallbackProc = spawn('ffmpeg', [
        '-ss', '00:00:15',
        '-i', movie.filePath,
        '-vframes', '1',
        '-q:v', '2',
        '-vf', 'scale=600:-1',
        '-y',
        thumbPath
      ]);
      fallbackProc.on('close', () => {
        if (fs.existsSync(thumbPath)) callback(null, thumbPath);
        else callback(new Error('Thumb failed'));
      });
    }
  });
}

// Extract subtitle stream to WebVTT
function extractSubtitleTrack(movie, cacheDir, subIndex, callback) {
  const outputFolder = path.join(cacheDir, movie.id);
  const vttPath = path.join(outputFolder, `sub_${subIndex}.vtt`);

  ensureDirExists(outputFolder);

  if (fs.existsSync(vttPath)) {
    return callback(null, vttPath);
  }

  const args = [
    '-i', movie.filePath,
    '-map', `0:${subIndex}`,
    '-f', 'webvtt',
    '-y',
    vttPath
  ];

  const proc = spawn('ffmpeg', args);
  proc.on('close', (code) => {
    if (fs.existsSync(vttPath)) {
      callback(null, vttPath);
    } else {
      callback(new Error('Subtitle extraction failed'));
    }
  });
}

// Codec memoization cache
const codecCache = new Map();
function probeVideoCodec(filePath) {
  if (codecCache.has(filePath)) return codecCache.get(filePath);
  try {
    const res = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { encoding: 'utf8', timeout: 3000 });
    const codec = res.stdout ? res.stdout.trim().toLowerCase() : 'h264';
    codecCache.set(filePath, codec || 'h264');
    return codec || 'h264';
  } catch (e) {
    return 'h264';
  }
}

// Transcode video to HLS with selected audio track & resolution quality (supports 4K 2160p, 1080p, 720p, 480p)
function startHlsTranscode(movie, cacheDir, audioIndex, quality, startTime, onReady) {
  const audioTag = (audioIndex !== undefined && audioIndex !== null && audioIndex !== '' && audioIndex !== 'default') ? `audio_${audioIndex}` : 'audio_default';

  let cleanQuality = quality ? quality.toLowerCase() : 'auto';
  if (cleanQuality === '2160p') cleanQuality = '4k';
  const qualityTag = ['480p', '720p', '1080p', '4k'].includes(cleanQuality) ? `quality_${cleanQuality}` : 'quality_auto';

  // Seek offset (seconds) the transcode should start from. Each offset gets its
  // own output folder so the player can jump anywhere in the movie on demand.
  const startSec = Math.max(0, Math.floor(parseFloat(startTime) || 0));
  const startTag = startSec > 0 ? `_start_${startSec}` : '';

  const streamFolderTag = `${audioTag}_${qualityTag}${startTag}`;
  const outputFolder = path.join(cacheDir, movie.id, streamFolderTag);
  const playlistPath = path.join(outputFolder, 'index.m3u8');
  const transcodeKey = `${movie.id}_${streamFolderTag}`;

  ensureDirExists(outputFolder);

  // 1. If an active FFmpeg transcode process is ALREADY running for this stream:
  if (activeTranscodes.has(transcodeKey)) {
    if (fs.existsSync(playlistPath)) {
      try {
        const content = fs.readFileSync(playlistPath, 'utf8');
        if (content.includes('.ts')) {
          return onReady(playlistPath);
        }
      } catch (e) {}
    }

    const interval = setInterval(() => {
      if (fs.existsSync(playlistPath)) {
        try {
          const content = fs.readFileSync(playlistPath, 'utf8');
          if (content.includes('.ts')) {
            clearInterval(interval);
            onReady(playlistPath);
          }
        } catch (e) {}
      }
    }, 100);
    return;
  }

  // 2. If transcode is NOT currently running, but a 100% fully-completed transcode exists:
  if (fs.existsSync(playlistPath)) {
    try {
      const content = fs.readFileSync(playlistPath, 'utf8');
      if (content.includes('#EXT-X-ENDLIST')) {
        return onReady(playlistPath);
      }
    } catch (e) {}
    
    // Incomplete / partial playlist from a previous terminated session: clean it up so we start fresh
    try {
      fs.rmSync(outputFolder, { recursive: true, force: true });
      ensureDirExists(outputFolder);
    } catch (e) {}
  }

  // Kill any old or superseded transcode processes for the same movie before starting a new one
  stopMovieTranscodes(movie.id, transcodeKey);

  console.log(`[Transcoder] Starting stream for '${movie.title}' [${streamFolderTag}]...`);

  const vCodec = probeVideoCodec(movie.filePath);
  const isH264 = vCodec === 'h264';

  const hwEncoder = detectHwEncoder();

  // Input seeking (-ss before -i) is fast and lets us start the HLS timeline at
  // 0 while representing the movie from startSec onward.
  const ffmpegArgs = ['-threads', '0'];
  // GPU-accelerated decoding when a hardware encoder is present. 'auto' falls
  // back to software decode for any codec the GPU can't handle, so it's safe.
  if (hwEncoder) {
    ffmpegArgs.push('-hwaccel', 'auto');
  }
  if (startSec > 0) {
    ffmpegArgs.push('-ss', String(startSec));
  }
  ffmpegArgs.push(
    '-i', movie.filePath,
    '-map', '0:v:0'
  );

  if (audioIndex !== undefined && audioIndex !== null && audioIndex !== '' && audioIndex !== 'default') {
    ffmpegArgs.push('-map', `0:${audioIndex}`);
  } else {
    ffmpegArgs.push('-map', '0:a:0?');
  }

  // Quality resolution scaling logic.
  // Standard H264 movies (<=1080p) in Auto mode use direct copy for 100x instant playback and 0% CPU!
  const isLargeOr4k = (movie.filename || '').toLowerCase().includes('2160p') || (movie.filename || '').toLowerCase().includes('4k');
  const canDirectCopy = isH264 && qualityTag === 'quality_auto' && !isLargeOr4k;

  if (canDirectCopy) {
    // Ultra fast direct copy for original H264
    ffmpegArgs.push(
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ac', '2',
      '-af', 'aresample=async=1000'
    );
  } else {
    // Scale according to chosen quality
    let scaleFilter = '';
    let videoBitrate = '3500k';

    switch (qualityTag) {
      case 'quality_480p':
        scaleFilter = 'scale=-2:480,format=yuv420p';
        videoBitrate = '900k';
        break;
      case 'quality_720p':
        scaleFilter = 'scale=-2:720,format=yuv420p';
        videoBitrate = '1800k';
        break;
      case 'quality_1080p':
        scaleFilter = 'scale=-2:1080,format=yuv420p';
        videoBitrate = '3800k';
        break;
      case 'quality_4k':
        scaleFilter = 'scale=-2:2160,format=yuv420p';
        videoBitrate = '6500k';
        break;
      default:
        // Auto: 720p at 2 Mbps for smooth non-stop streaming over any connection
        scaleFilter = "scale=-2:'min(720,ih)',format=yuv420p";
        videoBitrate = '2000k';
        break;
    }

    if (hwEncoder === 'h264_nvenc') {
      if (scaleFilter) ffmpegArgs.push('-vf', scaleFilter);
      ffmpegArgs.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',
        '-b:v', videoBitrate,
        '-maxrate', videoBitrate,
        '-bufsize', '6000k',
        '-g', '72',
        '-keyint_min', '24',
        '-pix_fmt', 'yuv420p'
      );
    } else {
      // High-performance multi-threaded CPU transcode
      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency'
      );
      if (scaleFilter) ffmpegArgs.push('-vf', scaleFilter);
      ffmpegArgs.push(
        '-b:v', videoBitrate,
        '-maxrate', videoBitrate,
        '-bufsize', '6000k',
        '-g', '72',
        '-keyint_min', '24',
        '-sc_threshold', '0',
        '-pix_fmt', 'yuv420p'
      );
    }

    ffmpegArgs.push(
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ac', '2',
      '-af', 'aresample=async=1000'
    );
  }

  ffmpegArgs.push(
    '-avoid_negative_ts', 'make_zero',
    '-f', 'hls',
    '-hls_time', '3',
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outputFolder, `${streamFolderTag}_%05d.ts`),
    playlistPath
  );

  // stdio: 'ignore' prevents the OS 64KB stderr pipe buffer from filling up and freezing FFmpeg at 15 minutes!
  const ffmpegProc = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'ignore', 'ignore']
  });

  activeTranscodes.set(transcodeKey, {
    proc: ffmpegProc,
    movieId: movie.id,
    movieTitle: movie.title,
    lastRequested: Date.now(),
    playlistPath
  });

  ffmpegProc.on('close', (code) => {
    activeTranscodes.delete(transcodeKey);
  });

  ffmpegProc.on('error', (err) => {
    activeTranscodes.delete(transcodeKey);
    console.error(`[Transcoder] Error for '${movie.title}':`, err.message);
  });

  let attempts = 0;
  const checkInterval = setInterval(() => {
    attempts++;
    if (fs.existsSync(playlistPath)) {
      try {
        const content = fs.readFileSync(playlistPath, 'utf8');
        if (content.includes('.ts') || attempts > 30) {
          clearInterval(checkInterval);
          onReady(playlistPath);
        }
      } catch (e) {}
    }
  }, 150);
}

// Stop any active transcode process for a movie (or except a specific session)
function stopMovieTranscodes(movieId, exceptKey = null) {
  for (const [key, entry] of activeTranscodes.entries()) {
    if (entry.movieId === movieId && key !== exceptKey) {
      console.log(`[Transcoder] Terminating replaced transcode session: ${key}`);
      try {
        entry.proc.kill('SIGKILL');
      } catch (e) {}
      activeTranscodes.delete(key);
    }
  }
}

// Update keepalive timestamp whenever client requests a segment or playlist
function touchMovieTranscode(movieId) {
  for (const entry of activeTranscodes.values()) {
    if (entry.movieId === movieId) {
      entry.lastRequested = Date.now();
    }
  }
}

// Inactivity Reaper: Terminates any background transcode if the client stops requesting chunks for >25s
setInterval(() => {
  const now = Date.now();
  const IDLE_TIMEOUT_MS = 180000; // 3 min — long enough that a full playback buffer never trips it mid-watch
  for (const [key, entry] of activeTranscodes.entries()) {
    if (now - entry.lastRequested > IDLE_TIMEOUT_MS) {
      console.log(`[Transcoder] Terminating idle transcode for '${entry.movieTitle}' (inactivity >25s). RAM freed.`);
      try {
        entry.proc.kill('SIGKILL');
      } catch (e) {}
      activeTranscodes.delete(key);
    }
  }
}, 5000);

// Recursively total a folder's size and track its newest file mtime (for LRU).
function dirSizeInfo(dir) {
  let size = 0, newest = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = dirSizeInfo(full);
        size += sub.size;
        if (sub.newest > newest) newest = sub.newest;
      } else {
        try { const st = fs.statSync(full); size += st.size; if (st.mtimeMs > newest) newest = st.mtimeMs; } catch (e) {}
      }
    }
  } catch (e) {}
  return { size, newest };
}

function isMovieActive(movieId) {
  for (const entry of activeTranscodes.values()) {
    if (entry.movieId === movieId) return true;
  }
  return false;
}

// Keep the cache under a size cap by deleting the least-recently-used movie
// folders (never one that's actively streaming). Prevents runaway disk usage.
function pruneCache(cacheDir, maxBytes) {
  try {
    if (!fs.existsSync(cacheDir)) return;
    const dirs = fs.readdirSync(cacheDir, { withFileTypes: true }).filter(d => d.isDirectory());
    const items = dirs.map(d => {
      const full = path.join(cacheDir, d.name);
      const info = dirSizeInfo(full);
      return { id: d.name, path: full, size: info.size, newest: info.newest };
    });
    let total = items.reduce((s, i) => s + i.size, 0);
    if (total <= maxBytes) return;

    console.log(`[Cache] Size ${(total / 1e9).toFixed(1)} GB exceeds cap ${(maxBytes / 1e9).toFixed(1)} GB — pruning...`);
    items.sort((a, b) => a.newest - b.newest); // oldest first
    for (const it of items) {
      if (total <= maxBytes) break;
      if (isMovieActive(it.id)) continue;
      try {
        fs.rmSync(it.path, { recursive: true, force: true });
        total -= it.size;
        console.log(`[Cache] Pruned ${it.id} (${(it.size / 1e6).toFixed(0)} MB).`);
      } catch (e) {}
    }
    console.log(`[Cache] Cache now ~${(total / 1e9).toFixed(1)} GB.`);
  } catch (e) {}
}

module.exports = {
  startHlsTranscode,
  stopMovieTranscodes,
  touchMovieTranscode,
  pruneCache,
  generateLocalThumbnail,
  extractSubtitleTrack
};
