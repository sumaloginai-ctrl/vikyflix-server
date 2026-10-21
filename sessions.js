const os = require('os');

const activeSessions = new Map();

// Parse user agent into human-readable device and browser name
function parseDeviceName(userAgent = '') {
  const ua = userAgent.toLowerCase();

  let device = '🖥️ PC';
  if (ua.includes('iphone')) device = '📱 iPhone';
  else if (ua.includes('ipad')) device = '📱 iPad';
  else if (ua.includes('android')) {
    device = ua.includes('mobile') ? '📱 Android Phone' : '📱 Android Tablet';
  } else if (ua.includes('windows')) device = '💻 Windows PC';
  else if (ua.includes('macintosh') || ua.includes('mac os')) device = '🍎 Mac';
  else if (ua.includes('linux')) device = '🐧 Linux';
  else if (ua.includes('smart-tv') || ua.includes('googletv') || ua.includes('appletv') || ua.includes('tizen')) device = '📺 Smart TV';

  let browser = 'Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('opera/') || ua.includes('opr/')) browser = 'Opera';

  return `${device} (${browser})`;
}

// Extract real client IP (supporting Cloudflare tunnel, reverse proxies, and direct connections)
function extractClientIp(req) {
  let ip = req.headers['cf-connecting-ip'] || 
           req.headers['x-real-ip'] || 
           (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
           req.socket?.remoteAddress || 
           '127.0.0.1';

  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  return ip;
}

// Record or update viewer heartbeat
function recordHeartbeat({ sessionId, ip, userAgent, movieId, movieTitle, poster, quality, currentTime, duration }) {
  const now = Date.now();
  const id = sessionId || `${ip}_${movieId}`;

  const existing = activeSessions.get(id);

  activeSessions.set(id, {
    sessionId: id,
    ip: ip || existing?.ip || 'Unknown',
    device: parseDeviceName(userAgent || existing?.userAgent || ''),
    movieId: movieId || existing?.movieId,
    movieTitle: movieTitle || existing?.movieTitle || 'Movie Stream',
    poster: poster || existing?.poster || null,
    quality: (quality || existing?.quality || 'auto').toUpperCase(),
    currentTime: Math.floor(currentTime || existing?.currentTime || 0),
    duration: Math.floor(duration || existing?.duration || 0),
    startedAt: existing?.startedAt || now,
    lastActive: now
  });
}

// Remove a session explicitly (e.g. when closed or terminated)
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

// Get all active sessions, filtering out those with no heartbeat for >30 seconds
function getActiveSessions() {
  const now = Date.now();
  const SESSION_TIMEOUT_MS = 30000; // 30 seconds

  for (const [id, session] of activeSessions.entries()) {
    if (now - session.lastActive > SESSION_TIMEOUT_MS) {
      activeSessions.delete(id);
    }
  }

  return Array.from(activeSessions.values()).map(s => ({
    ...s,
    activeSinceSec: Math.floor((now - s.startedAt) / 1000),
    lastSeenSec: Math.floor((now - s.lastActive) / 1000)
  }));
}

// Format bytes into human-readable string
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

// Get system resource consumption
function getSystemMetrics() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    processRam: formatBytes(mem.rss),
    processRamBytes: mem.rss,
    systemRamUsed: formatBytes(usedMem),
    systemRamTotal: formatBytes(totalMem),
    systemRamPercentage: Math.round((usedMem / totalMem) * 100),
    cpuCores: os.cpus().length,
    activeStreamsCount: activeSessions.size,
    uptimeSec: Math.floor(process.uptime())
  };
}

module.exports = {
  recordHeartbeat,
  removeSession,
  getActiveSessions,
  getSystemMetrics,
  extractClientIp,
  parseDeviceName
};
