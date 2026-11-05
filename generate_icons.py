import os
import subprocess
import tempfile
from PIL import Image, ImageDraw

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
RES_DIR = os.path.join(ROOT_DIR, "android", "app", "src", "main", "res")
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

SVG_FOREGROUND = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 1024px;
    height: 1024px;
    background: transparent;
    overflow: hidden;
  }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <!-- Left Wing Ribbon Gradient — Crimson to Ruby -->
    <linearGradient id="vf-grad-left" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff0055" />
      <stop offset="45%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#be123c" />
    </linearGradient>

    <!-- Right Wing Ribbon Gradient — Electric Sunset to Cinema Gold -->
    <linearGradient id="vf-grad-right" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff2a55" />
      <stop offset="50%" stop-color="#ff6b00" />
      <stop offset="100%" stop-color="#ffb703" />
    </linearGradient>

    <!-- Center Fold Nexus Gradient — Deep Violet to Cosmic Indigo -->
    <linearGradient id="vf-grad-center" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#c084fc" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#4338ca" />
    </linearGradient>

    <!-- Play Glyph Jewel Gradient -->
    <linearGradient id="vf-grad-play" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fde047" />
    </linearGradient>

    <!-- Intense Core Glow Filter -->
    <filter id="vf-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="30" result="blur1" />
      <feGaussianBlur stdDeviation="14" result="blur2" />
      <feMerge>
        <feMergeNode in="blur1" />
        <feMergeNode in="blur2" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <filter id="vf-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#000000" flood-opacity="0.85" />
    </filter>
  </defs>

  <!-- Ambient Light Aura in Safe Zone -->
  <circle cx="512" cy="512" r="260" fill="url(#vf-grad-left)" opacity="0.35" filter="url(#vf-glow)" />
  <circle cx="535" cy="505" r="220" fill="url(#vf-grad-right)" opacity="0.30" filter="url(#vf-glow)" />

  <!-- Center V Prism Structure (Safe zone centered at 512, 512) -->
  <g transform="translate(262, 262) scale(5.0)" filter="url(#vf-shadow)">
    <!-- Left Wing Main Ribbon -->
    <path d="M 16 16 L 36 16 L 50 68 L 41 84 L 16 16 Z" fill="url(#vf-grad-left)" />

    <!-- Left Wing Bevel Reflection -->
    <path d="M 28 16 L 36 16 L 50 68 L 45 74 Z" fill="#ffffff" opacity="0.36" />

    <!-- Right Wing Main Ribbon -->
    <path d="M 84 16 L 64 16 L 50 68 L 59 84 L 84 16 Z" fill="url(#vf-grad-right)" />

    <!-- Right Wing Golden Accent Edge -->
    <path d="M 72 16 L 84 16 L 59 84 L 54 75 Z" fill="#ffedd5" opacity="0.48" />

    <!-- Center Fold Nexus Ribbon -->
    <path d="M 41 84 L 50 68 L 59 84 L 50 92 Z" fill="url(#vf-grad-center)" />

    <!-- Embedded Cinema Play Glyph (Center Triangle) -->
    <path d="M 44 40 L 60 50 L 44 60 Z" fill="url(#vf-grad-play)" opacity="0.95" />

    <!-- Top Right Horizon Light Sparkle -->
    <g transform="translate(84, 16)">
      <line x1="-12" y1="0" x2="12" y2="0" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
      <line x1="0" y1="-12" x2="0" y2="12" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
      <line x1="-6" y1="-6" x2="6" y2="6" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
      <line x1="-6" y1="6" x2="6" y2="-6" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="0" cy="0" r="3.2" fill="#ffffff" />
    </g>
  </g>
</svg>
</body>
</html>
"""

SVG_FULL_ICON = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 1024px;
    height: 1024px;
    background: #0b0a12;
    overflow: hidden;
  }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <!-- Dark Radial Gradient Background -->
    <radialGradient id="bg-grad" cx="50%" cy="45%" r="75%">
      <stop offset="0%" stop-color="#19152b" />
      <stop offset="50%" stop-color="#0e0b17" />
      <stop offset="100%" stop-color="#050409" />
    </radialGradient>

    <!-- Subtle Rim Gradient -->
    <linearGradient id="rim-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff0055" stop-opacity="0.6" />
      <stop offset="50%" stop-color="#ffb703" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#4338ca" stop-opacity="0.5" />
    </linearGradient>

    <linearGradient id="vf-grad-left" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff0055" />
      <stop offset="45%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#be123c" />
    </linearGradient>

    <linearGradient id="vf-grad-right" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff2a55" />
      <stop offset="50%" stop-color="#ff6b00" />
      <stop offset="100%" stop-color="#ffb703" />
    </linearGradient>

    <linearGradient id="vf-grad-center" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#c084fc" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#4338ca" />
    </linearGradient>

    <linearGradient id="vf-grad-play" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fde047" />
    </linearGradient>

    <filter id="vf-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="35" result="blur1" />
      <feGaussianBlur stdDeviation="15" result="blur2" />
      <feMerge>
        <feMergeNode in="blur1" />
        <feMergeNode in="blur2" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <filter id="vf-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#000000" flood-opacity="0.9" />
    </filter>
  </defs>

  <!-- Deep Obsidian Background Tile -->
  <rect x="0" y="0" width="1024" height="1024" fill="url(#bg-grad)" />

  <!-- Ambient Light Aura -->
  <circle cx="512" cy="512" r="320" fill="url(#vf-grad-left)" opacity="0.32" filter="url(#vf-glow)" />
  <circle cx="540" cy="500" r="260" fill="url(#vf-grad-right)" opacity="0.28" filter="url(#vf-glow)" />

  <!-- Center V Prism Structure (Scaled larger for standalone icon: 6.4x) -->
  <g transform="translate(192, 192) scale(6.4)" filter="url(#vf-shadow)">
    <!-- Left Wing Main Ribbon -->
    <path d="M 16 16 L 36 16 L 50 68 L 41 84 L 16 16 Z" fill="url(#vf-grad-left)" />

    <!-- Left Wing Bevel Reflection -->
    <path d="M 28 16 L 36 16 L 50 68 L 45 74 Z" fill="#ffffff" opacity="0.36" />

    <!-- Right Wing Main Ribbon -->
    <path d="M 84 16 L 64 16 L 50 68 L 59 84 L 84 16 Z" fill="url(#vf-grad-right)" />

    <!-- Right Wing Golden Accent Edge -->
    <path d="M 72 16 L 84 16 L 59 84 L 54 75 Z" fill="#ffedd5" opacity="0.48" />

    <!-- Center Fold Nexus Ribbon -->
    <path d="M 41 84 L 50 68 L 59 84 L 50 92 Z" fill="url(#vf-grad-center)" />

    <!-- Embedded Cinema Play Glyph (Center Triangle) -->
    <path d="M 44 40 L 60 50 L 44 60 Z" fill="url(#vf-grad-play)" opacity="0.95" />

    <!-- Top Right Horizon Light Sparkle -->
    <g transform="translate(84, 16)">
      <line x1="-14" y1="0" x2="14" y2="0" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" />
      <line x1="0" y1="-14" x2="0" y2="14" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" />
      <line x1="-7" y1="-7" x2="7" y2="7" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" />
      <line x1="-7" y1="7" x2="7" y2="-7" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="0" cy="0" r="3.6" fill="#ffffff" />
    </g>
  </g>

  <!-- High-end Cinema Inner Rim Stroke -->
  <rect x="16" y="16" width="992" height="992" rx="200" ry="200" fill="none" stroke="url(#rim-grad)" stroke-width="6" opacity="0.35" />
</svg>
</body>
</html>
"""

SVG_SPLASH_PORTRAIT = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 1080px;
    height: 1920px;
    background: #07050d;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" fill="none">
  <defs>
    <radialGradient id="splash-bg" cx="50%" cy="46%" r="65%">
      <stop offset="0%" stop-color="#241738" />
      <stop offset="40%" stop-color="#120c1d" />
      <stop offset="100%" stop-color="#050308" />
    </radialGradient>

    <linearGradient id="vf-grad-left" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff0055" />
      <stop offset="45%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#be123c" />
    </linearGradient>

    <linearGradient id="vf-grad-right" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff2a55" />
      <stop offset="50%" stop-color="#ff6b00" />
      <stop offset="100%" stop-color="#ffb703" />
    </linearGradient>

    <linearGradient id="vf-grad-center" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#c084fc" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#4338ca" />
    </linearGradient>

    <linearGradient id="vf-grad-play" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fde047" />
    </linearGradient>

    <linearGradient id="vf-grad-flix" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff0055" />
      <stop offset="100%" stop-color="#ff6b00" />
    </linearGradient>

    <filter id="splash-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="40" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <filter id="splash-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="28" stdDeviation="24" flood-color="#000000" flood-opacity="0.9" />
    </filter>
  </defs>

  <!-- Deep Cosmic Canvas -->
  <rect x="0" y="0" width="1080" height="1920" fill="url(#splash-bg)" />

  <!-- Ambient Light Blooms -->
  <circle cx="540" cy="820" r="380" fill="url(#vf-grad-left)" opacity="0.25" filter="url(#splash-glow)" />
  <circle cx="570" cy="800" r="300" fill="url(#vf-grad-right)" opacity="0.22" filter="url(#splash-glow)" />

  <!-- Center V Prism Structure (Scaled to 340px at cx=540, cy=820) -->
  <g transform="translate(370, 650) scale(3.4)" filter="url(#splash-shadow)">
    <!-- Left Wing Main Ribbon -->
    <path d="M 16 16 L 36 16 L 50 68 L 41 84 L 16 16 Z" fill="url(#vf-grad-left)" />

    <!-- Left Wing Bevel Reflection -->
    <path d="M 28 16 L 36 16 L 50 68 L 45 74 Z" fill="#ffffff" opacity="0.36" />

    <!-- Right Wing Main Ribbon -->
    <path d="M 84 16 L 64 16 L 50 68 L 59 84 L 84 16 Z" fill="url(#vf-grad-right)" />

    <!-- Right Wing Golden Accent Edge -->
    <path d="M 72 16 L 84 16 L 59 84 L 54 75 Z" fill="#ffedd5" opacity="0.48" />

    <!-- Center Fold Nexus Ribbon -->
    <path d="M 41 84 L 50 68 L 59 84 L 50 92 Z" fill="url(#vf-grad-center)" />

    <!-- Embedded Cinema Play Glyph -->
    <path d="M 44 40 L 60 50 L 44 60 Z" fill="url(#vf-grad-play)" opacity="0.95" />

    <!-- Top Right Horizon Light Sparkle -->
    <g transform="translate(84, 16)">
      <line x1="-16" y1="0" x2="16" y2="0" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" />
      <line x1="0" y1="-16" x2="0" y2="16" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" />
      <line x1="-8" y1="-8" x2="8" y2="8" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
      <line x1="-8" y1="8" x2="8" y2="-8" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="0" cy="0" r="4.0" fill="#ffffff" />
    </g>
  </g>

  <!-- Wordmark "VIKYFLIX" -->
  <g transform="translate(540, 1070)" text-anchor="middle">
    <text font-size="58" font-weight="900" letter-spacing="14" fill="#ffffff">
      VIKY<tspan fill="url(#vf-grad-flix)">FLIX</tspan>
    </text>
  </g>

  <!-- Tagline "YOUR PERSONAL CINEMA" -->
  <g transform="translate(540, 1130)" text-anchor="middle">
    <text font-size="19" font-weight="700" letter-spacing="8" fill="#ffb703" opacity="0.88">
      YOUR PERSONAL CINEMA
    </text>
  </g>
</svg>
</body>
</html>
"""

SVG_SPLASH_LANDSCAPE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 1920px;
    height: 1080px;
    background: #07050d;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" fill="none">
  <defs>
    <radialGradient id="splash-bg-land" cx="50%" cy="48%" r="65%">
      <stop offset="0%" stop-color="#241738" />
      <stop offset="40%" stop-color="#120c1d" />
      <stop offset="100%" stop-color="#050308" />
    </radialGradient>

    <linearGradient id="vf-grad-left" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff0055" />
      <stop offset="45%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#be123c" />
    </linearGradient>

    <linearGradient id="vf-grad-right" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff2a55" />
      <stop offset="50%" stop-color="#ff6b00" />
      <stop offset="100%" stop-color="#ffb703" />
    </linearGradient>

    <linearGradient id="vf-grad-center" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#c084fc" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#4338ca" />
    </linearGradient>

    <linearGradient id="vf-grad-play" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fde047" />
    </linearGradient>

    <linearGradient id="vf-grad-flix" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff0055" />
      <stop offset="100%" stop-color="#ff6b00" />
    </linearGradient>

    <filter id="splash-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="40" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <filter id="splash-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="28" stdDeviation="24" flood-color="#000000" flood-opacity="0.9" />
    </filter>
  </defs>

  <rect x="0" y="0" width="1920" height="1080" fill="url(#splash-bg-land)" />

  <circle cx="960" cy="450" r="340" fill="url(#vf-grad-left)" opacity="0.25" filter="url(#splash-glow)" />
  <circle cx="990" cy="430" r="280" fill="url(#vf-grad-right)" opacity="0.22" filter="url(#splash-glow)" />

  <!-- Center V Prism Structure (Scaled to 320px at cx=960, cy=450) -->
  <g transform="translate(800, 290) scale(3.2)" filter="url(#splash-shadow)">
    <path d="M 16 16 L 36 16 L 50 68 L 41 84 L 16 16 Z" fill="url(#vf-grad-left)" />
    <path d="M 28 16 L 36 16 L 50 68 L 45 74 Z" fill="#ffffff" opacity="0.36" />
    <path d="M 84 16 L 64 16 L 50 68 L 59 84 L 84 16 Z" fill="url(#vf-grad-right)" />
    <path d="M 72 16 L 84 16 L 59 84 L 54 75 Z" fill="#ffedd5" opacity="0.48" />
    <path d="M 41 84 L 50 68 L 59 84 L 50 92 Z" fill="url(#vf-grad-center)" />
    <path d="M 44 40 L 60 50 L 44 60 Z" fill="url(#vf-grad-play)" opacity="0.95" />

    <g transform="translate(84, 16)">
      <line x1="-16" y1="0" x2="16" y2="0" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" />
      <line x1="0" y1="-16" x2="0" y2="16" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" />
      <line x1="-8" y1="-8" x2="8" y2="8" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
      <line x1="-8" y1="8" x2="8" y2="-8" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="0" cy="0" r="4.0" fill="#ffffff" />
    </g>
  </g>

  <!-- Wordmark "VIKYFLIX" -->
  <g transform="translate(960, 680)" text-anchor="middle">
    <text font-size="54" font-weight="900" letter-spacing="14" fill="#ffffff">
      VIKY<tspan fill="url(#vf-grad-flix)">FLIX</tspan>
    </text>
  </g>

  <!-- Tagline "YOUR PERSONAL CINEMA" -->
  <g transform="translate(960, 740)" text-anchor="middle">
    <text font-size="18" font-weight="700" letter-spacing="8" fill="#ffb703" opacity="0.88">
      YOUR PERSONAL CINEMA
    </text>
  </g>
</svg>
</body>
</html>
"""

def render_html_to_png(html_content, output_png_path, width, height):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html_content)
        temp_html = f.name

    try:
        cmd = [
            EDGE_PATH,
            "--headless=new",
            "--disable-gpu",
            "--default-background-color=00000000",
            f"--window-size={width},{height}",
            f"--screenshot={output_png_path}",
            temp_html
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if not os.path.exists(output_png_path):
            raise RuntimeError(f"Edge failed to create screenshot: {res.stderr.decode()}")
    finally:
        if os.path.exists(temp_html):
            os.remove(temp_html)

def main():
    print("Step 1: Rendering Master High-Res Assets via Edge Headless...")
    build_dir = os.path.join(ROOT_DIR, "build_assets")
    os.makedirs(build_dir, exist_ok=True)

    master_fg_path = os.path.join(build_dir, "master_foreground.png")
    master_full_path = os.path.join(build_dir, "master_full_icon.png")
    master_splash_port = os.path.join(build_dir, "master_splash_port.png")
    master_splash_land = os.path.join(build_dir, "master_splash_land.png")

    render_html_to_png(SVG_FOREGROUND, master_fg_path, 1024, 1024)
    render_html_to_png(SVG_FULL_ICON, master_full_path, 1024, 1024)
    render_html_to_png(SVG_SPLASH_PORTRAIT, master_splash_port, 1080, 1920)
    render_html_to_png(SVG_SPLASH_LANDSCAPE, master_splash_land, 1920, 1080)

    print("Master assets rendered successfully.")

    # Load masters in Pillow
    img_fg = Image.open(master_fg_path).convert("RGBA")
    img_full = Image.open(master_full_path).convert("RGBA")
    img_splash_p = Image.open(master_splash_port).convert("RGBA")
    img_splash_l = Image.open(master_splash_land).convert("RGBA")

    # Helper: Create circular round icon
    def make_round(img):
        w, h = img.size
        mask = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, w, h), fill=255)
        round_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        round_img.paste(img, (0, 0), mask=mask)
        return round_img

    img_round = make_round(img_full)

    # 1. Launcher Mipmap Densities
    MIPMAP_CONFIG = [
        ("mipmap-mdpi", 48, 108),
        ("mipmap-hdpi", 72, 162),
        ("mipmap-xhdpi", 96, 216),
        ("mipmap-xxhdpi", 144, 324),
        ("mipmap-xxxhdpi", 192, 432),
    ]

    print("Step 2: Generating Mipmap Launcher Icons...")
    for folder, icon_sz, fg_sz in MIPMAP_CONFIG:
        target_dir = os.path.join(RES_DIR, folder)
        os.makedirs(target_dir, exist_ok=True)

        # Standard launcher icon (squircle/rounded)
        res_full = img_full.resize((icon_sz, icon_sz), Image.Resampling.LANCZOS)
        res_full.save(os.path.join(target_dir, "ic_launcher.png"), "PNG")

        # Round launcher icon
        res_round = img_round.resize((icon_sz, icon_sz), Image.Resampling.LANCZOS)
        res_round.save(os.path.join(target_dir, "ic_launcher_round.png"), "PNG")

        # Adaptive icon foreground
        res_fg = img_fg.resize((fg_sz, fg_sz), Image.Resampling.LANCZOS)
        res_fg.save(os.path.join(target_dir, "ic_launcher_foreground.png"), "PNG")

        print(f"  -> Generated {folder}: icon {icon_sz}x{icon_sz}, fg {fg_sz}x{fg_sz}")

    # 2. Splash Screen Drawables
    SPLASH_PORTRAIT_CONFIG = [
        ("drawable", 1080, 1920),
        ("drawable-port-mdpi", 320, 480),
        ("drawable-port-hdpi", 480, 800),
        ("drawable-port-xhdpi", 720, 1280),
        ("drawable-port-xxhdpi", 960, 1600),
        ("drawable-port-xxxhdpi", 1280, 1920),
    ]

    SPLASH_LAND_CONFIG = [
        ("drawable-land-mdpi", 480, 320),
        ("drawable-land-hdpi", 800, 480),
        ("drawable-land-xhdpi", 1280, 720),
        ("drawable-land-xxhdpi", 1600, 960),
        ("drawable-land-xxxhdpi", 1920, 1080),
    ]

    print("Step 3: Generating Splash Screen Drawables...")
    for folder, w, h in SPLASH_PORTRAIT_CONFIG:
        target_dir = os.path.join(RES_DIR, folder)
        os.makedirs(target_dir, exist_ok=True)
        res = img_splash_p.resize((w, h), Image.Resampling.LANCZOS)
        res.save(os.path.join(target_dir, "splash.png"), "PNG")
        print(f"  -> Generated {folder}/splash.png ({w}x{h})")

    for folder, w, h in SPLASH_LAND_CONFIG:
        target_dir = os.path.join(RES_DIR, folder)
        os.makedirs(target_dir, exist_ok=True)
        res = img_splash_l.resize((w, h), Image.Resampling.LANCZOS)
        res.save(os.path.join(target_dir, "splash.png"), "PNG")
        print(f"  -> Generated {folder}/splash.png ({w}x{h})")

    print("All Android launcher icons and splash drawables generated successfully!")

if __name__ == "__main__":
    main()
