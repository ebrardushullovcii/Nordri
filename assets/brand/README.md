# Nordri brand assets

This directory is the source of truth for the approved Nordri branding: logo 113 and app icon 134. Keep the approved vectors, platform exports and export scripts here. Exploration sheets and original generated images remain under `output/`. The mark is a bold O containing three separate organic stones. The wordmark is uppercase NORDRI. All final files use the same vector symbol. Lettering is outlined, so no font installation is needed.

## Choose the file for the surface

| Use | File | Background |
| --- | --- | --- |
| Website header or in-app branding | `in-app/wordmark.svg` | Transparent |
| Header on a dark surface | `in-app/wordmark-on-dark.svg` | Transparent; white lettering |
| Standalone symbol | `in-app/mark.svg` | Transparent, including the O aperture |
| Symbol on a dark surface | `in-app/mark-on-dark.svg` | Transparent; lighter foreground |
| Monochrome printing or tinting | `in-app/mark-monochrome.svg`, `in-app/wordmark-monochrome.svg` | Transparent |
| Browser favicon | `web/favicon.svg`, `web/favicon.ico` | Transparent; SVG adapts to light/dark mode |
| PNG favicon fallback | `web/favicon-16.png` through `favicon-128.png` | Transparent |
| iPhone/iPad home-screen shortcut | `web/apple-touch-icon.png` | Opaque white square, 180 × 180; system clips corners |
| Web app icon | `web/icon-192.png`, `web/icon-512.png` | Rounded white tile; outside corners transparent |
| Web app maskable icon | `web/icon-maskable-192.png`, `web/icon-maskable-512.png` | Fully opaque white square; symbol inside safe zone |
| Windows executable, taskbar, shortcuts or installer | `desktop/windows/icon.ico` | White tile; outside corners transparent |
| macOS Electron app / Dock / Finder | `desktop/macos/icon.icns` | White tile; outside corners transparent |
| macOS source representations | `desktop/macos/Nordri.iconset/` | 1× and 2× sizes through 1024 pixels |
| Apple app-store image | `desktop/macos/apple-app-store-1024.png` | Opaque white square; no baked corner mask |
| Apple Icon Composer inputs | `desktop/macos/icon-composer-background.png`, `icon-composer-foreground.png` | Separate opaque background and transparent foreground |
| Linux launcher icon | `desktop/linux/` | PNG sizes 16–1024; transparent outside tile |
| Electron/macOS menu-bar template | `in-app/tray-template.png`, `tray-template@2x.png` | Black monochrome with transparent background; use as template image |
| Windows/Linux tray on dark backgrounds | `in-app/tray-white-16.png`, `tray-white-32.png` | White monochrome with transparent background |
| Social link preview | `social/og-image.jpg` or `og-image.png` | Opaque ivory, 1200 × 630 |
| Square social image | `social/square.png` | Opaque ivory, 1080 × 1080 |

Prefer SVG for page headers and in-app marks. PNG exports are included for applications that require raster images. Do not use the white desktop tile as a replacement for the transparent wordmark.

The 16–24 pixel marks and small desktop representations have slightly more space between the bottom two stones. This prevents them touching when reduced. The larger master artwork retains the original proportions.

## Website

Copy the files you need from `web/` into your site's public brand directory. `integration/website-head.html` contains favicon and home-screen-icon tags. `web/icons.webmanifest` supplies icon declarations; merge those into an existing manifest if the site already has one. Adding icons alone does not make a site installable or provide offline behavior.

## Electron

`integration/electron-build/` contains conventional `icon.ico`, `icon.icns`, `icon.png` and `icon.svg` names. Copy these into the desktop project's `build/` directory when integrating. Nordri currently explicitly points Windows at `build/icon.ico`. The included config snippet shows the paths for Windows, macOS and Linux; merge it into the existing config rather than replacing the config.

For a new native Apple project using Icon Composer, import the separate background and foreground PNGs into Apple's tool and export the resulting `.icon` document there. The included `.icns` is the ready-to-use icon container for the current Electron workflow.

## Source and regeneration

`source/` contains the approved, cleaned vector masters. They use real outlined paths and do not require fonts. Use these sources when changing or exporting the branding.

The final SVGs share one palette and symbol geometry; the wordmark's O is replaced with that same symbol. The desktop tile is rebuilt from that geometry with a white fill and subtle grey outline.

To re-export, install `sharp` for Node and `Pillow` for Python, then run `node assets/brand/export-assets.cjs` followed by `python3 assets/brand/export-containers.py` from the repo root. The second command also requires macOS `iconutil`. `inventory.json` lists the expected PNG dimensions and transparency.

## Format references

- [Electron Builder icon formats](https://www.electron.build/docs/features/icons-and-images/)
- [Apple app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons/)
- [MDN web icon and maskable safe-zone guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)

The assets have not been installed into the live site or application. Container structure, pixel dimensions, alpha channels, vector content and favicon shape separation are checked by the export script. A packaged Windows application has not been tested here.
