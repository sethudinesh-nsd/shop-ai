# Vision architecture

## Where things live

```
server/services/vision/
  index.js                      <- the ONLY file other code should require
  schemas.js                    <- prompts + the wardrobe metadata shape
  providers/
    groqVisionProvider.js       <- talks to Groq's vision API
    (geminiVisionProvider.js)   <- add later, same contract
    (openaiVisionProvider.js)   <- add later, same contract
```

Everything else in the app — `agent.js`, `tools.js`, `server.js`, the
wardrobe upload flow — calls one of two functions on `services/vision`:

- `analyzeWardrobeItem(image)` → structured JSON metadata (category, colors,
  material, fit, ...). Used by the wardrobe upload endpoint.
- `describeImagesForChat(images, userText)` → a plain-English description of
  what's in the photo(s). Used by AI Chat before the stylist model replies.

Neither function, nor any of their callers, knows *how* the image gets
analyzed. That's entirely inside `providers/groqVisionProvider.js`.

## Swapping providers

1. Create `server/services/vision/providers/geminiVisionProvider.js` (or
   whichever) that exports:
   ```js
   async function analyzeImages({ images, systemPrompt, jsonMode }) {
     // images: array of data URLs
     // returns: raw text response (string)
   }
   module.exports = { analyzeImages };
   ```
2. Register it in the `PROVIDERS` map at the top of `vision/index.js`.
3. Set `VISION_PROVIDER=gemini` in `.env`.

No other file changes. `agent.js`, `tools.js`, `server.js`, and both
frontends are provider-agnostic by construction.

## Data flow

**Chat:** `js/script.js` reads uploaded files as data URLs → sends them in
`POST /api/chat/stream` as `images: [...]` → `agent.js` calls
`vision.describeImagesForChat()` in parallel with tool selection → the
description is injected into the prompt as an `IMAGE ANALYSIS` block →
`systemPrompt.js` tells the model to treat that block as its own eyes.

**Wardrobe:** `js/wardrobe.js` saves the item immediately in an
`analyzing` state (so the UI never feels stuck) → `POST
/api/vision/wardrobe` → `vision.analyzeWardrobeItem()` → structured fields
come back and prefill the card; the user can still edit anything via the
"Edit details" disclosure.

## Extending to future features

Outfit Planner, Duplicate Clothing Detection, Similar Product Search, Style
Memory, etc. should all reuse `analyzeWardrobeItem()` for reading a garment,
or add a small new exported function in `vision/index.js` that calls
`provider.analyzeImages()` with a new prompt from `schemas.js` — never a new
inline fetch to a vision API from inside a route or frontend file. That's
the one rule that keeps this from becoming N separate vision integrations.
