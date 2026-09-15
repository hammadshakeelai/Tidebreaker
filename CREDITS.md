# Credits

Tidebreaker is built on open-source code and public-domain audio. Thank you to everyone below.

## Code and fonts

| Project | Used for | License |
| :--- | :--- | :--- |
| [three.js](https://github.com/mrdoob/three.js) | WebGL rendering, geometry utilities | MIT |
| [Vite](https://github.com/vitejs/vite) | Dev server and production bundling | MIT |
| [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant) via [Fontsource](https://github.com/fontsource/fontsource) | Display type | OFL-1.1 |
| [IBM Plex Mono](https://github.com/IBM/plex) via Fontsource | Instrument labels and numbers | OFL-1.1 |
| [Figtree](https://github.com/erikdkennedy/figtree) via Fontsource | UI text | OFL-1.1 |

## Sound

Every sound is **CC0 / public domain**. The files in `public/audio/` are made from the originals by
[`tools/audio/build-audio.mjs`](tools/audio/build-audio.mjs), which trims them, turns loops into
seamless loops with a crossfade, normalizes levels and encodes Ogg Vorbis and AAC copies. The exact
source URL for every file is listed in [`tools/audio/sources.json`](tools/audio/sources.json).

| In-game sound | Source | Author |
| :--- | :--- | :--- |
| Outboard engine layers (`engine_low/mid/high`) | [Racing car engine sound loops](https://opengameart.org/content/racing-car-engine-sound-loops) | domasx2 |
| Distant wave washes | [Beach Ocean Waves](https://opengameart.org/content/beach-ocean-waves) | jasinski (freesound), packaged by qubodup |
| Hull water rush, splashes | 40 CC0 water / splash / slime SFX | rubberduck (OpenGameArt) |
| Spray hiss, wind | 30 CC0 SFX loops | rubberduck (OpenGameArt) |
| Beacon bell, finish gong | 100 CC0 SFX | rubberduck (OpenGameArt) |
| Boost whooshes | Micro Pack: Organic Wooshes | Benjamin Burnes (Abstraction) |
| Harbour music loop | 2HTC Samples Vol 4, "Beachwalker: Shoreline Walk" | Benjamin Burnes (Abstraction) |
| Countdown, menu and UI sounds | [Interface Sounds](https://kenney.nl/assets/interface-sounds) (GitHub mirror: [Calinou/kenney-interface-sounds](https://github.com/Calinou/kenney-interface-sounds)) | Kenney |
| Rock, buoy and boat impacts | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney |

Most of the rubberduck, Abstraction and Kenney packs were collected from the
[lavenderdotpet/CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds) repository.

## Inspiration

The pastel low-poly ocean look was inspired by golden-hour sailing art and procedural ocean demos. All models,
shaders and code in this repository were written from scratch.
