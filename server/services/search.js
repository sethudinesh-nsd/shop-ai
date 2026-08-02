const { tavily } = require("@tavily/core");

const client = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

async function searchWeb(query) {
  try {
    const response = await client.search(query, {
      maxResults: 5,
      searchDepth: "basic",
      includeImages: true,
      includeImageDescriptions: true,
    });

    return {
      results: response.results || [],
      images: response.images || [], // Tavily returns image URLs (and descriptions if requested)
    };
  } catch (error) {
    console.error("Tavily Error:", error);
    return { results: [], images: [] };
  }
}

module.exports = { searchWeb };