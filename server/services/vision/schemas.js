/**
 * ============================================================================
 * VISION SCHEMAS — shared shapes + prompts for every vision consumer.
 *
 * This is the ONE place that defines "what we ask the model to look for."
 * Both the wardrobe feature and (later) things like Duplicate Clothing
 * Detection or Personal Style Memory read from WARDROBE_FIELDS /
 * WARDROBE_JSON_SHAPE, so the metadata shape never drifts between features.
 * ============================================================================
 */

// Keep in sync with WARDROBE_CATEGORIES in js/wardrobe.js (frontend has no
// build step / module system, so it can't `require()` this file — it'sc
// duplicated there on purpose, with a comment pointing back here).
const WARDROBE_FIELDS = [
  'category',
  'subcategory',
  'colors',
  'material',
  'pattern',
  'fit',
  'sleeve',
  'neckline',
  'style',
  'season',
  'occasion',
  'confidence',
];

// Default/empty shape — used when vision fails, so the caller always gets
// a well-formed object back and the UI can fall back to manual entry
// instead of throwing.
const WARDROBE_JSON_SHAPE = {
  category: '',
  subcategory: '',
  colors: [],
  material: '',
  pattern: '',
  fit: '',
  sleeve: '',
  neckline: '',
  style: '',
  season: '',
  occasion: '',
  confidence: 0,
};

const WARDROBE_SYSTEM_PROMPT = `
You are a garment recognition system for a wardrobe app. Look at the photo
of a single clothing item and reply with ONLY valid JSON (no markdown
fences, no commentary, no text before or after) in exactly this shape:

{
  "category": "top" | "bottom" | "footwear" | "outerwear" | "accessory",
  "subcategory": string,   // e.g. "t-shirt", "chinos", "sneakers", "tote bag"
  "colors": string[],      // dominant colors, most dominant first, lowercase
  "material": string,      // best visual guess, e.g. "cotton", "denim", "leather"
  "pattern": string,       // "solid", "striped", "checked", "floral", "printed", etc.
  "fit": string,           // "slim", "regular", "oversized", or "N/A"
  "sleeve": string,        // "full", "half", "sleeveless", or "N/A"
  "neckline": string,      // "crew", "v-neck", "collared", or "N/A"
  "style": string,         // "casual", "formal", "streetwear", "athleisure", etc.
  "season": string,        // "summer", "winter", "monsoon", "all-season"
  "occasion": string,      // "everyday", "work", "party", "wedding", "gym"
  "confidence": number     // 0-1, your own confidence in this reading
}

Rules:
- If a field genuinely doesn't apply to the item (e.g. "sleeve" on shoes), use "N/A" — never omit the key.
- Never invent extra keys, never wrap the JSON in markdown, never add explanation text.
- If the photo is blurry, cropped, or ambiguous, still fill every field with your best guess and reflect the uncertainty honestly in "confidence".
`;

/**
 * Chat vision doesn't want structured JSON back — the stylist model needs
 * prose it can reason over conversationally. Built as a function (not a
 * constant) so the user's own message can be woven in as guidance for what
 * to focus on (e.g. "is this shirt too formal for a beach day?" should bias
 * the description toward fabric/formality, not just a flat inventory).
 */
function buildChatVisionPrompt(userText) {
  return `
You are the vision layer for Shop AI, a personal styling assistant. Look at
the uploaded image(s) and describe, in plain prose, everything a stylist
would need to know to respond well: what's in the photo (a person, an
outfit, a single garment, a screenshot from Pinterest/Instagram, or an
inspiration/reference image), garment types, colors, fit, notable styling
details, and — if it's a selfie or outfit photo — build, skin tone, and
what's already being worn, described plainly and only insofar as it's
useful for styling advice.

${userText ? `The user's message alongside this image was: "${userText}"\nWeight your description toward whatever is relevant to that.` : ''}

Write 3-6 sentences of dense, concrete description. Do not give styling
advice yourself — that's the stylist model's job downstream, using your
description as its "eyes." Just describe accurately.
`;
}

module.exports = {
  WARDROBE_FIELDS,
  WARDROBE_JSON_SHAPE,
  WARDROBE_SYSTEM_PROMPT,
  buildChatVisionPrompt,
};
