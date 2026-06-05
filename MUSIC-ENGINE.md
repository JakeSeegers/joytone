# Godaigo Adaptive Music Engine

`music-engine.js` is a self-contained, dependency-free implementation of the
Godaigo Elements adaptive music framework. The board writes the music: as tiles
are revealed, scrolls are cast, and one element comes to dominate, the engine
unmutes voices, reshapes the groove, and builds toward a convergence finale only
that specific game could produce.

Every voice is synthesised live through the Web Audio API — there are no audio
assets to ship. It runs its own `AudioContext`, independent of anything else on
the page.

A live preview/sandbox is built into the generator (`index.html`) as the
**🎴 Adaptive** strip, so you can hear the behaviour before wiring it into the
game.

---

## Quick start

```html
<script src="music-engine.js"></script>
<script>
  const music = new GodaigoMusicEngine({ bpm: 84 });
  // start() must be called from a user gesture (click/tap) to satisfy autoplay rules
  startButton.addEventListener('click', () => music.start());
</script>
```

---

## The architecture (one shared grid)

Everything is locked to one global BPM and one key (A minor pentatonic, the
neutral bed). On top of an **always-audible base layer** sit six element stems,
each with its own melodic leitmotif *and* its own percussion personality:

| Stem | Voice (synth) | Percussion personality |
|------|---------------|------------------------|
| Earth | low sawtooth drone, falling bass | slow, heavy frame drum on strong beats |
| Water | soft sine arpeggio, rising & turning back | fluid off-beat shakers + rim |
| Fire | distorted saw shamisen, syncopated | driving taiko (the rhythmic engine) |
| Wind | breathy triangle, high & ascending | light, quick high wood-ticks |
| Void | sub-bass sine, one shifting tone | almost nothing — a deep sub-pulse |
| Catacomb | detuned cluster (min2 + tritone) | irregular, syncopated clicks |

Percussion is a **first-class layer**, not a sidecar: the base spine anchors the
mix, each element brings its own groove that fades in/out with its stem, and a
game-state modulator adds swing / drive / crescendo so the *feel* of the music —
not just its volume — tracks the board.

---

## Public API

| Method | Purpose |
|--------|---------|
| `start()` → Promise | Build the audio graph and begin scheduling (call from a user gesture). |
| `stop()` | Pause the scheduler. |
| `setBPM(bpm)` | Set the global tempo (40–200). |
| `setElementIntensity(element, 0..1)` | Directly set a stem's gain; tier is derived. |
| `setElementTiles(element, revealed, total)` | Density by tile count — maps the three tiers (§2). Preferred for `revealTile()`. |
| `setGameState('peaceful'\|'contested'\|'endgame')` | Rhythm-character shift (§5). |
| `castAccent(element)` | One-shot scroll accent (§4). |
| `openResponseWindow()` | Enter the standoff: duck + sustained held tone + building crescendo (§4). |
| `resolveResponseWindow(element \| null)` | Resolve into the responder's motif, or fade if no response (§4). |
| `counterAccent(element)` | Counter scroll: sharp dissonant cluster, then release (§4). |
| `triggerConvergence(dominantElements[])` | Stop generating; lock in the composed finale from the dominant elements (§6). |
| `reset()` | Return to silent, peaceful, generative play (e.g. rematch). |
| `triggerEvent(type, payload)` | Generic dispatch — see below. |
| `getState()` | Snapshot `{ running, gameState, converging, response, stems }` for UIs. |

`new GodaigoMusicEngine({ bpm, onStatus })` — `onStatus(msg)` is an optional
callback invoked with human-readable status strings.

### `triggerEvent` types

`'tile-revealed'` `{element, revealed, total}` · `'scroll-cast'` `element` ·
`'response-open'` · `'response-played'` `element` · `'counter-played'` `element` ·
`'response-none'` / `'response-close'` · `'turn-change'` · `'convergence'` `[elements]`

---

## The three density tiers (§2)

`setElementTiles` maps directly to the framework's discovery tiers:

- **1 tile → Tier 1** — the stem enters softly as a single solo voice.
- **3–4 tiles → Tier 2** — the solo becomes a section: an octave doubling is
  added and the percussion kit thickens.
- **most / all tiles → Tier 3** — the element moves to the foreground; its voice
  pushes forward and its groove fills out.

---

## The convergence (§6)

When the win condition fires, call `triggerConvergence(dominantElements)`. The
generative mix stops and a fixed `i–♭VI–♭III–♭VII` progression in A minor is
voiced by *only* the dominant elements, each in its own register over a full
kit — the only fully-composed music in the game. A Void+Fire board drives; an
Earth+Water board settles; a balanced board turns orchestral.

---

## Wiring it into Godaigo

| Game trigger | Source location | Call |
|---|---|---|
| Tile revealed | `revealTile()` in `game-core.js` | `music.setElementTiles(el, revealedCount, totalForEl)` |
| Scroll cast | `applyScrollEffects()` in `game-core.js` | `music.triggerEvent('scroll-cast', el)` |
| Response window opened | `openResponseWindow()` in `response-window.js` | `music.openResponseWindow()` |
| Response window resolved | `resolveResponseStack()` in `response-window.js` | `music.resolveResponseWindow(respondingEl \| null)` |
| Counter played | `response-window.js` | `music.counterAccent(el)` |
| Win condition met | win check in `game-core.js` | `music.triggerConvergence(dominantElements)` |
| Turn changes | turn handler in `lobby.js` | `music.triggerEvent('turn-change')` |
| Board tension read | (your board analysis) | `music.setGameState('peaceful'\|'contested'\|'endgame')` |

`dominantElements` should be the elements that claimed the most tiles / whose
scrolls resolved most often / that the winner activated.

---

## Tuning

Motifs (`MOTIFS`), percussion patterns (`PERCUSSION`) and timbres (`VOICES`) are
plain data tables at the top of `music-engine.js` — edit them to retune any
element's character. The contrary-motion contours are deliberate (§3); keep
neighbouring elements moving in opposite directions so any blind-drop
combination stays consonant.
