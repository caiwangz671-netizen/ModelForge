import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_DIR = ROOT / "desktop"
FRONTEND_PUBLIC = ROOT / "frontend" / "public"
PNG_PATH = DESKTOP_DIR / "icon.png"
ICO_PATH = DESKTOP_DIR / "icon.ico"
ICNS_PATH = DESKTOP_DIR / "icon.icns"
FAVICON_PATH = FRONTEND_PUBLIC / "favicon.ico"
LOGO_WEB_PATH = FRONTEND_PUBLIC / "logo.png"
LOGO_ASSETS_PATH = ROOT / "frontend" / "src" / "assets" / "logo.png"

SIZE = 1024
# Standard ICO sizes
ICO_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
# Standard ICNS sizes
ICNS_SIZES = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]

def main() -> None:
    if not PNG_PATH.exists():
        print(f"Error: Source icon not found at {PNG_PATH}")
        sys.exit(1)

    print(f"Loading source icon from {PNG_PATH}...")
    img = Image.open(PNG_PATH).convert("RGBA")
    
    # Ensure it's square and 1024x1024
    if img.size != (SIZE, SIZE):
        print(f"Resizing source icon from {img.size} to ({SIZE}, {SIZE})...")
        img = img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)

    # 1. Save Desktop Icons
    print(f"Generating {ICO_PATH}...")
    # sizes must be sorted for some formats
    sorted_ico_sizes = sorted(ICO_SIZES, key=lambda x: x[0])
    img.save(ICO_PATH, format="ICO", sizes=sorted_ico_sizes)

    print(f"Generating {ICNS_PATH}...")
    try:
        # sizes must be sorted for some formats
        sorted_icns_sizes = sorted(ICNS_SIZES, key=lambda x: x[0])
        img.save(ICNS_PATH, format="ICNS", sizes=sorted_icns_sizes)
    except Exception as e:
        print(f"Warning: Failed to generate ICNS (native Mac format might require specific PIL build): {e}")

    # 2. Save Web Assets
    FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)
    
    print(f"Generating {LOGO_WEB_PATH}...")
    web_logo = img.resize((512, 512), Image.Resampling.LANCZOS)
    web_logo.save(LOGO_WEB_PATH)
    
    # Also save to assets for Vite import
    LOGO_ASSETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    web_logo.save(LOGO_ASSETS_PATH)

    print(f"Generating {FAVICON_PATH}...")
    favicon_img = img.resize((32, 32), Image.Resampling.LANCZOS)
    favicon_img.save(FAVICON_PATH, format="ICO", sizes=[(16, 16), (32, 32)])

    print("\nIcon migration complete!")
    print(f"Desktop Source: {PNG_PATH}")
    print(f"Windows Icon:   {ICO_PATH}")
    print(f"macOS Icon:     {ICNS_PATH}")
    print(f"Web Favicon:    {FAVICON_PATH}")
    print(f"Web Logo (Pub): {LOGO_WEB_PATH}")
    print(f"Web Logo (Ast): {LOGO_ASSETS_PATH}")

if __name__ == "__main__":
    main()
