/**
 * ============================================================================
 * VISION SERVICE
 * ============================================================================
 */

const geminiVisionProvider = require('./providers/geminiVisionProvider');
// We must import the schemas! This was accidentally deleted.
const {
  WARDROBE_FIELDS,
  WARDROBE_JSON_SHAPE,
  WARDROBE_SYSTEM_PROMPT,
  buildChatVisionPrompt,
} = require('./schemas');

const PROVIDERS = {
  gemini: geminiVisionProvider,
};

const provider = PROVIDERS[process.env.VISION_PROVIDER || 'gemini'];

function toDataUrl(image) {
  if (typeof image === 'string') {
    if (!image.startsWith('data:')) {
      throw new Error('Image strings must be data URLs (data:image/...;base64,...)');
    }
    return image;
  }
  if (image && image.base64) {
    const mime = image.mimeType || 'image/jpeg';
    return `data:${mime};base64,${image.base64}`;
  }
  throw new Error('Unsupported image format passed to vision service');
}

function safeParseJson(text) {
  if (!text) return null;
  
  // Aggressively extract everything between the first { and the last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = text.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (err) {
      console.error('Vision JSON parse error (extracted):', err.message, '\nExtracted:', jsonStr);
    }
  }
  
  // Fallback to trying the whole raw text
  try {
    return JSON.parse(text.trim());
  } catch (err) {
    console.error('Vision JSON parse error:', err.message, '\nRaw response:', text);
    return null;
  }
}

async function analyzeWardrobeItem(image) {
  let dataUrl;
  try {
    dataUrl = toDataUrl(image);
  } catch (err) {
    console.error('Wardrobe vision: bad image input:', err.message);
    return { ...WARDROBE_JSON_SHAPE };
  }

  let raw;
  try {
    raw = await provider.analyzeImages({
      images: [dataUrl],
      systemPrompt: WARDROBE_SYSTEM_PROMPT,
      jsonMode: true,
    });
  } catch (err) {
    console.error('Wardrobe vision request failed:', err.message);
    return { ...WARDROBE_JSON_SHAPE };
  }

  const parsed = safeParseJson(raw);
  if (!parsed) return { ...WARDROBE_JSON_SHAPE };

  const clean = {};
  WARDROBE_FIELDS.forEach((field) => {
    clean[field] = parsed[field] ?? WARDROBE_JSON_SHAPE[field];
  });
  if (!Array.isArray(clean.colors)) {
    clean.colors = clean.colors ? [String(clean.colors)] : [];
  }
  return clean;
}

async function describeImagesForChat(images, userText = '') {
  if (!images || images.length === 0) return '';

  let dataUrls;
  try {
    dataUrls = images.map(toDataUrl);
  } catch (err) {
    console.error('Chat vision: bad image input:', err.message);
    return '';
  }

  try {
    const description = await provider.analyzeImages({
      images: dataUrls,
      systemPrompt: buildChatVisionPrompt(userText),
      jsonMode: false,
    });
    return (description || '').trim();
  } catch (err) {
    console.error('Chat vision request failed:', err.message);
    return '';
  }
}

module.exports = {
  analyzeWardrobeItem,
  describeImagesForChat,
};