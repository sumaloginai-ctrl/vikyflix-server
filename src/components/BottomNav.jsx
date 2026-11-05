import React from 'react';
import { Home, Film, Tv, Bookmark } from 'lucide-react';

import '../styles/shell.css';

export default function BottomNav({
  activeTab,
  onTabChange,
  watchlistCount = 0
}) {
  const items = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'movies', label: 'Movies', icon: Film },
    { id: 'series', label: 'Series', icon: Tv },
    { id: 'watchlist', label: 'My List', icon: Bookmark }
  ];

  return (
    <nav className="vf-dock mobile-only" aria-label="Primary">
      <div className="vf-dock-inner">
        {items.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              className={`vf-dock-item ${isActive ? 'is-active' : ''}`}
              onClick={() => onTabChange(id)}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="vf-dock-icon">
                <Icon size={21} strokeWidth={isActive ? 2.3 : 1.9} />
                {id === 'watchlist' && watchlistCount > 0 && (
                  <span className="vf-dock-badge">{watchlistCount > 99 ? '99+' : watchlistCount}</span>
                )}
              </span>
              <span className="vf-dock-label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
