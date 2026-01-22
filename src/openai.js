import OpenAI from 'openai';

let openaiClient = null;

/**
 * Initialize OpenAI client
 */
export function initOpenAI(apiKey) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required. Set it in your environment variables.');
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * Generate product content using OpenAI
 */
export async function generateProductContent(searchResults, logger) {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Call initOpenAI() first.');
  }

  const { productName, rawContent, confidence } = searchResults;

  logger?.info(`Generating content for "${productName}" (confidence: ${confidence})`);

  try {
    // Step 1: Generate base content in Estonian
    const baseContent = await generateBaseContent(productName, rawContent, logger);

    // Step 2: Generate SEO metadata
    const seoContent = await generateSEOContent(productName, baseContent.description_et, logger);

    // Step 3: Translate to English and Russian
    const translations = await translateContent(baseContent, logger);

    return {
      success: true,
      productName,
      sku: generateSKU(productName),
      ...baseContent,
      ...translations,
      ...seoContent,
      originalResearch: rawContent,
      confidence
    };

  } catch (error) {
    logger?.error(`OpenAI error for "${productName}": ${error.message}`);
    return {
      success: false,
      productName,
      error: error.message,
      confidence
    };
  }
}

/**
 * Generate base product content in Estonian
 */
async function generateBaseContent(productName, rawContent, logger) {
  const prompt = `Sa oled professionaalne e-poe tootekirjelduste looja. Loo atraktiivne tootekirjeldus järgmise toote jaoks.

TOOTE NIMI: ${productName}

KOGUTUD INFO:
${rawContent || 'Info puudub - loo kirjeldus toote nime põhjal'}

Vasta JSON formaadis:
{
  "name_et": "Toote nimi eesti keeles",
  "description_et": "Põhjalik tootekirjeldus (150-300 sõna). Kirjelda toote eeliseid, omadusi ja kasutusalasid. Kasuta veenvat müügikeelt.",
  "short_description_et": "Lühike tootekirjeldus (30-50 sõna). Peamised müügiargumendid.",
  "category_suggestion": "Soovituslik tootekategooria (nt Elektroonika, Kodumasinad, jne)",
  "suggested_price_eur": "Hinnanguline hind eurodes (number või null kui pole võimalik hinnata)"
}

Vasta AINULT JSON-iga, ilma lisaselgitusteta.`;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Sa oled ekspert e-kaubanduse tootekirjelduste loomisel. Vastad alati JSON formaadis.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 1500
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from OpenAI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Generate SEO content
 */
async function generateSEOContent(productName, descriptionEt, logger) {
  const prompt = `Loo SEO-optimeeritud metaandmed järgmise toote jaoks:

TOOTE NIMI: ${productName}
KIRJELDUS: ${descriptionEt}

Vasta JSON formaadis:
{
  "seo_title_et": "SEO pealkiri eesti keeles (max 60 tähemärki)",
  "seo_title_en": "SEO title in English (max 60 characters)",
  "seo_title_ru": "SEO заголовок на русском (max 60 символов)",
  "seo_description_et": "SEO kirjeldus eesti keeles (max 160 tähemärki)",
  "seo_description_en": "SEO description in English (max 160 characters)",
  "seo_description_ru": "SEO описание на русском (max 160 символов)"
}

Vasta AINULT JSON-iga.`;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Sa oled SEO ekspert. Lood optimeeritud metaandmeid e-poodidele. Vastad alati JSON formaadis.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 800
  });

  const content = response.choices[0]?.message?.content;
  const jsonMatch = content?.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse SEO JSON from OpenAI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Translate content to English and Russian
 */
async function translateContent(baseContent, logger) {
  const prompt = `Tõlgi järgmine e-poe tooteinfo inglise ja vene keelde. Säilita müügikeel ja stiil.

EESTIKEELNE INFO:
- Nimi: ${baseContent.name_et}
- Kirjeldus: ${baseContent.description_et}
- Lühikirjeldus: ${baseContent.short_description_et}

Vasta JSON formaadis:
{
  "name_en": "Product name in English",
  "name_ru": "Название товара на русском",
  "description_en": "Full product description in English",
  "description_ru": "Полное описание товара на русском",
  "short_description_en": "Short description in English",
  "short_description_ru": "Краткое описание на русском"
}

Vasta AINULT JSON-iga.`;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Sa oled professionaalne tõlkija. Tõlgid e-kaubanduse tekste, säilitades müügikeele. Vastad alati JSON formaadis.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 2000
  });

  const content = response.choices[0]?.message?.content;
  const jsonMatch = content?.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse translation JSON from OpenAI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Generate SKU from product name
 */
function generateSKU(productName) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const nameCode = productName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  return `${nameCode}-${timestamp}`;
}

/**
 * Rate-limited batch processing
 */
export async function processProductBatch(products, searchFn, logger, options = {}) {
  const { concurrency = 2, delayMs = 1000 } = options;
  const results = [];

  for (let i = 0; i < products.length; i += concurrency) {
    const batch = products.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (product) => {
        try {
          // Search for product info
          const searchResults = await searchFn(product, logger);

          // Generate content
          const content = await generateProductContent(searchResults, logger);

          // Merge search results with generated content
          return {
            ...content,
            images: searchResults.images || []
          };
        } catch (error) {
          logger?.error(`Failed to process "${product}": ${error.message}`);
          return {
            success: false,
            productName: product,
            error: error.message
          };
        }
      })
    );

    results.push(...batchResults);

    // Rate limiting delay between batches
    if (i + concurrency < products.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Get the OpenAI client instance
 */
export function getOpenAIClient() {
  return openaiClient;
}

export default {
  initOpenAI,
  getOpenAIClient,
  generateProductContent,
  processProductBatch
};
