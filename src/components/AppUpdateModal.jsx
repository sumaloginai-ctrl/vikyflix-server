import React, { useEffect, useRef, useState } from 'react';
import { Download, Sparkles, X, CheckCircle2, Loader2 } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { reportFailure } from '../telemetry.js';
import '../styles/details.css';

export default function AppUpdateModal({
  updateInfo,
  onClose
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateError, setUpdateError] = useState('');

  const pollRef = useRef(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  if (!updateInfo) return null;

  // In the native app the update downloads INSIDE the app (as a real .apk
  // in the app cache — no browser, no chance of being renamed to .zip) and
  // Android's installer opens automatically. The browser path below is the
  // web-only fallback.
  const handleUpdate = async () => {
    setIsUpdating(true);
    setUpdateError('');
    setUpdateMessage('');
    try {
      const url = new URL(updateInfo.apkUrl);
      const expectedPath = updateInfo.packageName === 'uk.vikyflix.tv' ? '/download/tv' : '/download';
      if (url.protocol !== 'https:' || url.hostname !== 'vikyflix.uk' || url.port || url.username || url.password || url.hash || url.pathname !== expectedPath) {
        throw new Error('The update link is not from the official MovieFlix download server.');
      }
      const bridge = window.AndroidStreamBridge;
      const nativeInstallCapable = Boolean(
        bridge &&
        typeof bridge.startApkUpdate === 'function' &&
        (typeof bridge.canInstallApks !== 'function' || bridge.canInstallApks())
      );
      if (nativeInstallCapable) {
        setUpdateMessage('Downloading update…');
        // Re-read the manifest at download time: the APK on the server can be
        // redeployed between the update check and this tap, and the checksum
        // from the stale check would abort a perfectly good download.
        let expectedSha = updateInfo.apkSha256 || null;
        try {
          const fr = await fetch(
            `${url.origin}/api/app/version?platform=${updateInfo.packageName === 'uk.vikyflix.tv' ? 'tv' : 'mobile'}&t=${Date.now()}`,
            { cache: 'no-store' }
          );
          if (fr.ok) {
            const fd = await fr.json();
            if (fd.apkSha256) expectedSha = fd.apkSha256;
          }
        } catch (e) { /* fall back to the check-time checksum */ }
        // The native side verifies every byte it writes against this
        // checksum: a corrupt/transformed download is rejected before install.
        bridge.startApkUpdate(url.toString(), expectedSha, true);
        let lastPct = -1;
        pollRef.current = setInterval(() => {
          let st = 'idle';
          try { st = bridge.getApkUpdateState(); } catch (e) {}
          if (st === 'idle') {
            clearInterval(pollRef.current); pollRef.current = null;
            setUpdateError('The download could not start. Please try again.');
            setIsUpdating(false);
            reportFailure({ cls: 'update_download_failed', kind: 'could_not_start', code: 'idle', platform: 'android', src: 'update_modal' });
          } else if (st.startsWith('downloading:')) {
            const pct = parseInt(st.split(':')[1], 10) || 0;
            if (pct !== lastPct) { lastPct = pct; setUpdateMessage(`Downloading update… ${pct}%`); }
          } else if (st === 'permission') {
            clearInterval(pollRef.current); pollRef.current = null;
            setIsUpdating(false);
            setDownloadSuccess(true);
            setUpdateMessage('One-time setup: allow MovieFlix to install apps in the screen that just opened, then tap Update again to install instantly.');
            reportFailure({ cls: 'update_install_failed', kind: 'permission_required', code: 'permission', platform: 'android', src: 'update_modal' });
          } else if (st === 'ready' || st === 'installing') {
            clearInterval(pollRef.current); pollRef.current = null;
            setIsUpdating(false);
            setDownloadSuccess(true);
            setUpdateMessage('Update downloaded. Confirm the installation in the Android installer that just opened.');
          } else if (st.startsWith('error:')) {
            clearInterval(pollRef.current); pollRef.current = null;
            const reason = st.slice('error:'.length) || 'Download failed. Please try again.';
            reportFailure({ cls: 'update_download_failed', kind: 'native_error', code: 'native', detail: reason, src: 'update_modal' });
            setUpdateError(reason);
            setUpdateMessage('');
            setIsUpdating(false);
            // The downloaded file is valid and sits in the app cache — if the
            // installer could not open (e.g. missing install permission on an
            // older build), offer the browser route so the user is never stuck.
            try {
              Browser.open({ url: url.toString() }).catch(() => {});
            } catch (e) { /* browser unavailable; the error message stands */ }
          }
        }, 400);
        return;
      }
      try {
        await Browser.open({ url: url.toString() });
      } catch {
        window.location.href = url.toString();
      }
      setIsUpdating(false);
      setDownloadSuccess(true);
      setUpdateMessage('The official APK was opened in your browser. Finish the download and confirm installation there.');
    } catch (err) {
      console.error('Update error:', err);
      reportFailure({ cls: 'update_download_failed', kind: 'exception', code: 'client', detail: err && err.message, src: 'update_modal' });
      setUpdateError(err.message || 'Could not open the official update download.');
      setIsUpdating(false);
    }
  };

  return (
    <div
      className="det-modal-overlay"
      onClick={(e) => {
        e.stopPropagation();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 99999999,
        padding: '20px',
        overflowY: 'auto',
        boxSizing: 'border-box'
      }}
    >
      <div
        className="app-update-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(145deg, #161a23, #0d1017)',
          border: '1px solid rgba(255, 204, 0, 0.45)',
          borderRadius: '16px',
          width: '90%',
          maxWidth: '440px',
          padding: '28px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.95), 0 0 40px rgba(255, 204, 0, 0.3)',
          color: '#ffffff',
          position: 'relative',
          margin: 'auto'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#aaa'
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '10px', marginBottom: '16px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '15px',
              background: 'linear-gradient(135deg, #ffb347, #ff2a55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(255, 42, 85, 0.45), inset 0 1px 0 rgba(255,255,255,.35)'
            }}
          >
            <Sparkles size={25} color="#ffffff" />
          </div>
          <h3 style={{ margin: 0, fontFamily: "'Sora','Segoe UI',sans-serif", fontSize: '1.22rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            MovieFlix Update
          </h3>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: '99px',
              background: 'rgba(246, 196, 83, 0.12)',
              border: '1px solid rgba(246, 196, 83, 0.35)',
              color: '#f6c453',
              fontSize: '0.72rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase'
            }}
          >
            Version {updateInfo.versionName || '2.0.0'}
          </span>
        </div>

        <p style={{ fontSize: '0.88rem', color: 'rgba(226, 232, 242, 0.78)', lineHeight: 1.66, margin: '0 0 20px 0', textAlign: 'center', letterSpacing: '0.004em' }}>
          {updateInfo.releaseNotes || 'A new update is ready with faster cloud streaming, recency auto-sync, and TV remote D-Pad navigation.'}
        </p>

        {downloadSuccess ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#4ade80', fontSize: '0.95rem', fontWeight: 600, padding: '12px 0' }}>
            <CheckCircle2 size={20} />
            <span>{updateMessage || "Verified update. Confirm installation in Android's installer."}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            <button
              onClick={handleUpdate}
              disabled={isUpdating}
              tabIndex={0}
              autoFocus
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #e50914, #ff2a55)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 6px 20px rgba(229, 9, 20, 0.4)',
                outline: 'none',
                transition: 'all 0.2s ease'
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '3px solid #ffcc00';
                e.currentTarget.style.transform = 'scale(1.03)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {isUpdating ? (
                <>
                  <Loader2 size={18} className="vf-spin" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download size={18} />
                  <span>Update Now</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              disabled={isUpdating}
              tabIndex={0}
              style={{
                width: '100%',
                padding: '11px 20px',
                borderRadius: '12px',
                background: 'transparent',
                color: 'rgba(226, 232, 242, 0.55)',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.86rem',
                cursor: 'pointer',
                outline: 'none',
                transition: 'color 0.2s ease'
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '3px solid #ffcc00';
                e.currentTarget.style.transform = 'scale(1.03)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Later
            </button>
          </div>
        )}
        {updateError && (
          <p role="alert" style={{ color: '#fca5a5', fontSize: '0.88rem', lineHeight: 1.45, margin: '14px 0 0' }}>
            {updateError}
          </p>
        )}
        {updateMessage && !downloadSuccess && (
          <p role="status" style={{ color: '#fcd34d', fontSize: '0.88rem', lineHeight: 1.45, margin: '14px 0 0' }}>
            {updateMessage}
          </p>
        )}
      </div>
    </div>
  );
}
