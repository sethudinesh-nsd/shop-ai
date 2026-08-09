const { searchWeb } = require('./search');
const vision = require('./vision');

const tools = {
  async search(query) {
    return await searchWeb(query);
  },

  // Kept as a tool (in addition to being called directly from agent.js
  // whenever chat images are present) so the tool-selector model can also
  // reach for vision explicitly later — e.g. "describe this product image
  // I found" during a search-tool turn. Same underlying vision service
  // either way; no duplicate logic.
  async vision(image) {
    return await vision.describeImagesForChat([image]);
  },

  async weather(location) {
    throw new Error('Weather tool not implemented yet.');
  },

  async memory(userId, action) {
    throw new Error('Memory tool not implemented yet.');
  },

  async shopping(query) {
    // For now, shopping uses the same web search.
    return await searchWeb(query);
  }
};

module.exports = tools;
