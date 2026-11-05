import React, { useState, useEffect } from 'react';
import {
  Clapperboard,
  Search,
  Sun,
  Moon,
  RefreshCw,
  Bookmark,
  Download
} from 'lucide-react';

import VikyFlixLogo from './VikyFlixLogo';
import '../styles/shell.css';
import '../styles/logo.css';

function Navbar({
  activeTab,
  onTabChange,
  onOpenSearch,
  theme,
  onToggleTheme,
  onRescan,
  isRescanning = false,
  watchlistCount = 0,
  onReplayIntro,
  updateAvailable = false,
  onOpenUpdate
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const isScrolled = window.scrollY > 24;
          setScrolled(prev => (prev !== isScrolled ? isScrolled : prev));
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const links = [
    { id: 'home', label: 'Home' },
    { id: 'series', label: 'Series' },
    { id: 'movies', label: 'Movies' },
    { id: 'genres', label: 'Genres' },
    { id: 'languages', label: 'Languages' },
    { id: 'watchlist', label: 'My List' }
  ];

  return (
    <header className={`vf-nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="vf-nav-inner">
        {/* Brand */}
        <button
          className="vf-brand"
          onClick={() => {
            if (activeTab === 'home' && onReplayIntro) {
              onReplayIntro();
            } else {
              onTabChange('home');
            }
          }}
          aria-label="MovieFlix home"
          title="MovieFlix (Tap while on Home to replay cinematic intro)"
        >
          <VikyFlixLogo size={28} variant="mark" animated glow />
          <span className="vf-brand-wordmark">
            <span className="vf-word-viky">MOVIE</span>
            <span className="vf-word-flix">FLIX</span>
            <span className="vf-word-pop" role="img" aria-label="popcorn">🍿</span>
          </span>
        </button>

        {/* Primary navigation (desktop) */}
        <nav className="vf-nav-links desktop-only" aria-label="Primary">
          {links.map((link) => (
            <button
              key={link.id}
              className={`vf-nav-link ${activeTab === link.id ? 'is-active' : ''}`}
              onClick={() => onTabChange(link.id)}
              aria-current={activeTab === link.id ? 'page' : undefined}
            >
              <span>{link.label}</span>
              {link.id === 'watchlist' && watchlistCount > 0 && (
                <span className="vf-nav-count">{watchlistCount}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="vf-nav-actions">
          {updateAvailable && (
            <button
              className="vf-nav-update-btn"
              onClick={onOpenUpdate}
              title="New version available! Click to update"
              aria-label="Update App"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '100px',
                background: 'linear-gradient(135deg, #e50914, #ff2a55)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(229, 9, 20, 0.55)'
              }}
            >
              <Download size={14} />
              <span>Update</span>
            </button>
          )}

          {activeTab !== 'movies' && activeTab !== 'series' && (
            <button
              className="vf-nav-search"
              onClick={onOpenSearch}
              title="Search movies, series, genres…"
              aria-label="Search"
            >
              <Search size={16} />
              <span className="vf-nav-search-text desktop-only">Search titles, genres…</span>
              <kbd className="vf-nav-search-kbd desktop-only">Ctrl K</kbd>
            </button>
          )}

          <button
            className="vf-nav-icon"
            onClick={onRescan}
            disabled={isRescanning}
            title="Rescan media library"
            aria-label="Sync Media Library"
          >
            <RefreshCw size={17} className={isRescanning ? 'vf-spin' : ''} />
          </button>

          <button
            className="vf-nav-icon"
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export default React.memo(Navbar);
