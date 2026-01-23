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
 * Get the OpenAI client instance
 */
export function getOpenAIClient() {
  return openaiClient;
}

// Language configurations
const LANGUAGE_CONFIG = {
  et: {
    name: 'Estonian',
    nativeName: 'Eesti',
    systemPrompt: 'Sa oled ekspert e-kaubanduse tootekirjelduste loomisel. Vastad alati JSON formaadis.',
    contentPrompt: (productName, rawContent) => `Sa oled professionaalne e-poe tootekirjelduste looja. Loo atraktiivne tootekirjeldus järgmise toote jaoks.

TOOTE NIMI: ${productName}

KOGUTUD INFO:
${rawContent || 'Info puudub - loo kirjeldus toote nime põhjal'}

Vasta JSON formaadis:
{
  "name": "Toote nimi eesti keeles",
  "description": "Põhjalik tootekirjeldus (150-300 sõna). Kirjelda toote eeliseid, omadusi ja kasutusalasid. Kasuta veenvat müügikeelt. Kasuta HTML vormingut (<p>, <ul>, <li> jne).",
  "short_description": "Lühike tootekirjeldus (30-50 sõna). Peamised müügiargumendid.",
  "category_suggestion": "Soovituslik tootekategooria (nt Elektroonika, Tervis ja ilu, jne)",
  "suggested_price_eur": "Hinnanguline hind eurodes (ainult number või null kui pole võimalik hinnata)",
  "brand": "Brändi nimi (kui tuvastatav tootenimest)",
  "ingredients": "Koostisosad (kui tegemist on toidulisandi või kosmeetikaga, muidu null)",
  "usage_instructions": "Kasutamisjuhend (kui asjakohane, muidu null)"
}

Vasta AINULT JSON-iga, ilma lisaselgitusteta.`
  },
  en: {
    name: 'English',
    nativeName: 'English',
    systemPrompt: 'You are an expert in e-commerce product descriptions. Always respond in JSON format.',
    contentPrompt: (productName, rawContent) => `You are a professional e-commerce product description writer. Create an attractive product description for the following product.

PRODUCT NAME: ${productName}

GATHERED INFORMATION:
${rawContent || 'No information available - create description based on product name'}

Respond in JSON format:
{
  "name": "Product name in English",
  "description": "Comprehensive product description (150-300 words). Describe benefits, features, and use cases. Use persuasive sales language. Use HTML formatting (<p>, <ul>, <li> etc.).",
  "short_description": "Short product description (30-50 words). Main selling points.",
  "category_suggestion": "Suggested product category (e.g., Electronics, Health & Beauty, etc.)",
  "suggested_price_eur": "Estimated price in EUR (number only or null if cannot estimate)",
  "brand": "Brand name (if identifiable from product name)",
  "ingredients": "Ingredients (if supplement or cosmetic, otherwise null)",
  "usage_instructions": "Usage instructions (if applicable, otherwise null)"
}

Respond ONLY with JSON, no additional explanations.`
  },
  ru: {
    name: 'Russian',
    nativeName: 'Русский',
    systemPrompt: 'Вы эксперт по описаниям товаров для электронной коммерции. Всегда отвечайте в формате JSON.',
    contentPrompt: (productName, rawContent) => `Вы профессиональный копирайтер описаний товаров для интернет-магазинов. Создайте привлекательное описание для следующего товара.

НАЗВАНИЕ ТОВАРА: ${productName}

СОБРАННАЯ ИНФОРМАЦИЯ:
${rawContent || 'Информация отсутствует - создайте описание на основе названия товара'}

Ответьте в формате JSON:
{
  "name": "Название товара на русском языке",
  "description": "Подробное описание товара (150-300 слов). Опишите преимущества, характеристики и варианты использования. Используйте убедительный язык продаж. Используйте HTML форматирование (<p>, <ul>, <li> и т.д.).",
  "short_description": "Краткое описание товара (30-50 слов). Основные аргументы для покупки.",
  "category_suggestion": "Рекомендуемая категория товара (например, Электроника, Здоровье и красота и т.д.)",
  "suggested_price_eur": "Ориентировочная цена в евро (только число или null, если невозможно оценить)",
  "brand": "Название бренда (если определяется из названия товара)",
  "ingredients": "Состав (если это добавка или косметика, иначе null)",
  "usage_instructions": "Инструкция по применению (если применимо, иначе null)"
}

Отвечайте ТОЛЬКО JSON, без дополнительных пояснений.`
  }
};

/**
 * Generate product content using OpenAI in specified language
 */
export async function generateProductContent(searchResults, language = 'et', logger) {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Call initOpenAI() first.');
  }

  const { productName, rawContent, confidence } = searchResults;
  const langConfig = LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG.et;

  logger?.info(`Generating ${langConfig.name} content for "${productName}" (confidence: ${confidence})`);

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: langConfig.systemPrompt
        },
        {
          role: 'user',
          content: langConfig.contentPrompt(productName, rawContent)
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
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

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      success: true,
      productName,
      sku: generateSKU(productName),
      language,
      name: parsed.name || productName,
      description: parsed.description || '',
      short_description: parsed.short_description || '',
      category_suggestion: parsed.category_suggestion || '',
      suggested_price_eur: parsed.suggested_price_eur,
      brand: parsed.brand || '',
      ingredients: parsed.ingredients || '',
      usage_instructions: parsed.usage_instructions || '',
      originalResearch: rawContent,
      confidence
    };

  } catch (error) {
    logger?.error(`OpenAI error for "${productName}": ${error.message}`);
    return {
      success: false,
      productName,
      language,
      error: error.message,
      confidence
    };
  }
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

export default {
  initOpenAI,
  getOpenAIClient,
  generateProductContent
};
