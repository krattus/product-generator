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
    systemPrompt: 'Sa oled ekspert e-kaubanduse tootekirjelduste loomisel toidulisandite ja tervisetoodete jaoks. Kasuta AINULT EFSA (Euroopa Toiduohutusameti) poolt heakskiidetud tõenduspõhiseid väiteid. Vastad alati JSON formaadis.',
    contentPrompt: (productName, rawContent) => `Sa oled professionaalne e-poe tootekirjelduste looja toidulisandite ja tervisetoodete jaoks. Loo põhjalik tootekirjeldus järgmise toote jaoks.

TOOTE NIMI: ${productName}

KOGUTUD INFO:
${rawContent || 'Info puudub - loo kirjeldus toote nime põhjal'}

OLULINE: Kasuta AINULT EFSA (Euroopa Toiduohutusameti) poolt heakskiidetud tõenduspõhiseid tervisväiteid!

Vasta JSON formaadis:
{
  "name": "${productName} - [Eestikeelne tootenimi]",
  "short_description": "Lühike tootekirjeldus (30-50 sõna). Peamised müügiargumendid.",
  "description": "Põhjalik tootekirjeldus (MINIMAALSELT 300 sõna). Struktureeritud ja ladusas eesti keeles. Kasuta HTML vormingut (<p>, <ul>, <li> jne). Sisalda:<ul><li>Toote üldkirjeldus ja eesmärk</li><li>Peamised eelised ja omadused bullet-pointidena</li><li>Kellele toode sobib</li><li>Miks valida just see toode</li></ul>Kasuta AINULT EFSA heakskiidetud tõenduspõhiseid väiteid!",
  "category_suggestion": "Soovituslik tootekategooria",
  "suggested_price_eur": "Hinnanguline hind eurodes (ainult number või null)",
  "brand": "Brändi nimi (kui tuvastatav)",
  "meta_sisaldus_ja_koostisosad": "Formaadis:\n\n<strong>Toitumisalane teave</strong>\n<div class='table-responsive'><table class='nutrition-table'><thead><tr><th>Toimeaine</th><th>Portsjon</th><th>%NRV*</th></tr></thead><tbody><tr><td>[Toimeaine]</td><td>[kogus]</td><td>[%NRV või **]</td></tr></tbody></table></div>\n<p><small>*NRV - Täiskasvanu päevane võrdluskogus<br>** - Päevane võrdluskogus ei ole määratud</small></p>\n\n<strong>Koostisosad</strong>\n<p>[Koostisosade loetelu komadega eraldatult ühel real]</p>\n\n<strong>Allergeenid</strong>\n<p>[Sisaldab: ... VÕI Ei sisalda levinud allergeene]</p>\n\n<strong>Ei sisalda</strong>\n<p>[nt GMO-vaba, suhkruvaba, gluteenivaba, laktoosivaba jms - kui asjakohane]</p>",
  "meta_kasutamine_ja_hoiustamine": "Formaadis:\n\n<strong>Kasutamine</strong>\n<p>[Täpne annustamisjuhis - mitu kapslit/tabletti, kui tihti, millega koos võtta]</p>\n\n<strong>Hoiustamine</strong>\n<p>[Hoiustamistingimused - temperatuur, valgus, niiskus jms]</p>\n\n<strong>Hoiatused</strong>\n<p>Mitte ületada soovitatud ööpäevast annust. Mitte kasutada toidulisandit mitmekesise toitumise asendajana! Hoida laste eest kättesaamatus kohas. [Lisa siia toote-spetsiifilised hoiatused, nt rasedatele, imetavatele emadele, teatud haiguste korral jms]</p>"
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
      model: 'gpt-5.2',
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
      max_completion_tokens: 4000
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
      meta_sisaldus_ja_koostisosad: parsed.meta_sisaldus_ja_koostisosad || parsed.ingredients || '',
      meta_kasutamine_ja_hoiustamine: parsed.meta_kasutamine_ja_hoiustamine || parsed.usage_instructions || '',
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
