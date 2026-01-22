import { getOpenAIClient } from './openai.js';

/**
 * Search for product information using OpenAI's web search
 */
export async function searchProduct(productName, logger) {
  const results = {
    productName,
    descriptions: [],
    specifications: [],
    features: [],
    images: [],
    prices: [],
    sources: [],
    rawContent: '',
    confidence: 'low'
  };

  const openai = getOpenAIClient();
  if (!openai) {
    logger?.error('OpenAI client not initialized');
    return results;
  }

  try {
    logger?.info(`Searching web for: "${productName}"`);

    // Use OpenAI's Responses API with web search
    const response = await openai.responses.create({
      model: 'gpt-4o',
      tools: [{ type: 'web_search_preview' }],
      input: `Search for detailed product information about: "${productName}"

Find and extract:
1. Product description and key features
2. Technical specifications
3. Benefits and use cases
4. Price range (if available)
5. Product images (URLs if available)

Focus on official product pages, manufacturer sites, and reputable retailers.`
    });

    // Extract the response content
    const outputText = response.output_text || '';

    if (outputText) {
      results.descriptions.push(outputText);
      results.rawContent = outputText;
      results.sources.push('OpenAI Web Search');

      // Try to extract any URLs mentioned as image sources
      const imageUrls = extractImageUrls(outputText);
      results.images.push(...imageUrls);
    }

    // Also extract citations/sources if available
    if (response.citations && Array.isArray(response.citations)) {
      for (const citation of response.citations) {
        if (citation.url) {
          results.sources.push(citation.url);
        }
      }
    }

    // Determine confidence based on data found
    results.confidence = calculateConfidence(results);

    logger?.info(`Web search found ${results.rawContent.length} chars of content for "${productName}"`);

  } catch (error) {
    logger?.error(`Web search error for "${productName}": ${error.message}`);

    // Fallback: If web search fails, try a regular completion to get basic info
    try {
      logger?.info(`Falling back to GPT knowledge for "${productName}"`);
      const fallbackContent = await getFallbackProductInfo(openai, productName, logger);
      if (fallbackContent) {
        results.descriptions.push(fallbackContent);
        results.rawContent = fallbackContent;
        results.sources.push('GPT Knowledge');
        results.confidence = 'medium';
      }
    } catch (fallbackError) {
      logger?.error(`Fallback also failed: ${fallbackError.message}`);
    }
  }

  return results;
}

/**
 * Fallback: Get product info from GPT's training data
 */
async function getFallbackProductInfo(openai, productName, logger) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a product research assistant. Provide detailed, accurate information about products based on your knowledge. Include specifications, features, benefits, and typical use cases.'
      },
      {
        role: 'user',
        content: `Provide detailed product information about: "${productName}"

Include:
- Product description
- Key features and specifications
- Benefits and use cases
- Target audience
- Any relevant details that would help create a product listing

Be factual and specific. If you're unsure about specific details, indicate that.`
      }
    ],
    temperature: 0.5,
    max_tokens: 1500
  });

  return response.choices[0]?.message?.content || '';
}

/**
 * Extract image URLs from text
 */
function extractImageUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+\.(?:jpg|jpeg|png|gif|webp)/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)].slice(0, 5); // Dedupe and limit to 5
}

/**
 * Calculate confidence level based on data found
 */
function calculateConfidence(results) {
  let score = 0;

  // Points for content length
  if (results.rawContent.length > 2000) score += 4;
  else if (results.rawContent.length > 1000) score += 3;
  else if (results.rawContent.length > 500) score += 2;
  else if (results.rawContent.length > 100) score += 1;

  // Points for sources
  if (results.sources.length >= 3) score += 2;
  else if (results.sources.length >= 1) score += 1;

  // Points for images
  if (results.images.length >= 2) score += 2;
  else if (results.images.length >= 1) score += 1;

  // Determine confidence level
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export default { searchProduct };
