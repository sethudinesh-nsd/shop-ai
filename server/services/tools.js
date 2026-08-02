

const { searchWeb } = require('./search');

const tools = {
  async search(query) {
    return await searchWeb(query);
  },

  async vision(image) {
    throw new Error('Vision tool not implemented yet.');
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