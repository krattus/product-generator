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

// Nutrition table HTML template matching WooCommerce export format
const NUTRITION_TABLE_TEMPLATE = `<table class="w-fit min-w-(--thread-content-width)" data-start="28" data-end="158">
<thead data-start="28" data-end="70">
<tr data-start="28" data-end="70">
<th data-start="28" data-end="44" data-col-size="sm"><strong data-start="30" data-end="43">Toimeaine</strong></th>
<th data-start="44" data-end="56" data-col-size="sm"><strong data-start="46" data-end="55">Kogus (1 kapsel)</strong></th>
<th data-start="56" data-end="70" data-col-size="sm"><strong data-start="58" data-end="67">% NRV</strong>*</th>
</tr>
</thead>
<tbody data-start="115" data-end="158">
[TABLE_ROWS]
</tbody>
</table>`;

const NUTRITION_ROW_TEMPLATE = `<tr data-start="[START]" data-end="[END]">
<td data-start="[START]" data-end="[MID1]" data-col-size="sm">[INGREDIENT]</td>
<td data-col-size="sm" data-start="[MID1]" data-end="[MID2]">[AMOUNT]</td>
<td data-col-size="sm" data-start="[MID2]" data-end="[END]">[NRV]</td>
</tr>`;

// Language configurations
const LANGUAGE_CONFIG = {
  et: {
    name: 'Estonian',
    nativeName: 'Eesti',
    systemPrompt: `Sa oled ekspert e-kaubanduse tootekirjelduste loomisel toidulisandite ja tervisetoodete jaoks. Kasuta AINULT EFSA (Euroopa Toiduohutusameti) poolt heakskiidetud tõenduspõhiseid väiteid. Vastad alati JSON formaadis.

OLULINE: Sinu genereeritud HTML peab järgima täpselt etteantud struktuuri andmebaasi ühilduvuse tagamiseks.`,
    contentPrompt: (productName, rawContent) => `Sa oled professionaalne e-poe tootekirjelduste looja toidulisandite ja tervisetoodete jaoks. Loo põhjalik tootekirjeldus järgmise toote jaoks.

TOOTE NIMI: ${productName}

KOGUTUD INFO:
${rawContent || 'Info puudub - loo kirjeldus toote nime põhjal'}

OLULINE: Kasuta AINULT EFSA (Euroopa Toiduohutusameti) poolt heakskiidetud tõenduspõhiseid tervisväiteid!

KIRJELDUSE HTML FORMAAT (kasuta täpselt seda struktuuri):
<p data-start="193" data-end="538"><strong data-start="193" data-end="228">[Toote nimi] </strong> [Toote põhikirjeldus - mis see on, kellele mõeldud, peamised omadused]</p>
<p data-start="540" data-end="706">[Lisainfo - toimeainete päritolu, teaduslik taust]</p>
<ul data-start="738" data-end="975">
 	<li data-start="738" data-end="782">
<p data-start="740" data-end="782">[Eelis 1]</p>
</li>
 	<li data-start="783" data-end="842">
<p data-start="785" data-end="842">[Eelis 2]</p>
</li>
 	<li data-start="843" data-end="910">
<p data-start="845" data-end="910">[Eelis 3]</p>
</li>
 	<li data-start="911" data-end="975">
<p data-start="913" data-end="975">[Eelis 4]</p>
</li>
</ul>
<p data-start="977" data-end="1092">[Kokkuvõttev lõik - miks valida see toode]</p>
<p data-start="1099" data-end="1174">Tootja: [Tootja nimi, riik]<br data-start="1139" data-end="1142" />Netokogus: [kogus kapslit/tabletti] / [kaal g]</p>

KOOSTISOSADE TABEL (sisaldus_ja_koostisosad) - kasuta täpselt seda JSON struktuuri:
{
  "nutrition_table": [
    {"ingredient": "Toimeaine nimi", "amount": "100 mg", "nrv": "50" või "–"}
  ],
  "ingredients_list": "Koostisosade loetelu komadega eraldatult",
  "allergens": "Sisaldab: X, Y VÕI Ei sisalda levinud allergeene",
  "free_from": "GMO-vaba, laktoosivaba jne (kui asjakohane)"
}

KASUTAMINE JA HOIUSTAMINE (kasutamine_ja_hoiustamine) - kasuta täpselt seda HTML struktuuri:
<p data-start="1845" data-end="1862"><strong data-start="1845" data-end="1860">Kasutamine
</strong><span class="relative -mx-px my-[-0.2rem] rounded px-px py-[0.2rem] transition-colors duration-100 ease-in-out">[Täpne annustamisjuhis]</span></p>
<p data-start="1908" data-end="1926"><strong data-start="1908" data-end="1924">Hoiustamine
</strong>[Hoiustamistingimused]</p>
<p data-start="1972" data-end="1988"><strong data-start="1972" data-end="1986">Hoiatused
</strong><span class="relative -mx-px my-[-0.2rem] rounded px-px py-[0.2rem] transition-colors duration-100 ease-in-out">Mitte ületada soovitatud ööpäevast annust. </span><span class="relative -mx-px my-[-0.2rem] rounded px-px py-[0.2rem] transition-colors duration-100 ease-in-out">Mitte kasutada toidulisandit mitmekesise toitumise asendajana! </span><span class="relative -mx-px my-[-0.2rem] rounded px-px py-[0.2rem] transition-colors duration-100 ease-in-out">Hoida laste eest kättesaamatus kohas.</span></p>

Vasta JSON formaadis:
{
  "name": "${productName} - [täiendus kui vaja]",
  "ean": "[EAN/GTIN kood kui leitud kogutud infost, muidu null]",
  "short_description": "Toidulisand\\n\\n[Lühike tootekirjeldus 30-50 sõna. Peamised müügiargumendid. Kasuta \\n reavahetusteks.]",
  "description": "[HTML kirjeldus ülaltoodud formaadis]",
  "category_suggestion": "Vitamiinid ja mineraalid > [Alamkategooria]",
  "suggested_price_eur": [number või null],
  "brand": "[Brändi nimi]",
  "weight": "[Netokaal grammides, ainult number]",
  "nutrition_data": {
    "nutrition_table": [...],
    "ingredients_list": "...",
    "allergens": "...",
    "free_from": "..."
  },
  "usage_html": "[HTML kasutamine/hoiustamine ülaltoodud formaadis]"
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

DESCRIPTION HTML FORMAT (use this exact structure):
<p data-start="193" data-end="538"><strong data-start="193" data-end="228">[Product name] </strong> [Main product description - what it is, who it's for, key features]</p>
<p data-start="540" data-end="706">[Additional info - ingredient origins, scientific background]</p>
<ul data-start="738" data-end="975">
 	<li data-start="738" data-end="782">
<p data-start="740" data-end="782">[Benefit 1]</p>
</li>
 	<li data-start="783" data-end="842">
<p data-start="785" data-end="842">[Benefit 2]</p>
</li>
 	<li data-start="843" data-end="910">
<p data-start="845" data-end="910">[Benefit 3]</p>
</li>
 	<li data-start="911" data-end="975">
<p data-start="913" data-end="975">[Benefit 4]</p>
</li>
</ul>
<p data-start="977" data-end="1092">[Summary paragraph - why choose this product]</p>
<p data-start="1099" data-end="1174">Manufacturer: [Name, Country]<br data-start="1139" data-end="1142" />Net quantity: [count capsules/tablets] / [weight g]</p>

Respond in JSON format:
{
  "name": "Product name in English",
  "ean": "[EAN/GTIN code if found in gathered information, otherwise null]",
  "short_description": "Short product description (30-50 words). Main selling points.",
  "description": "[HTML description in format above]",
  "category_suggestion": "Suggested product category",
  "suggested_price_eur": [number or null],
  "brand": "Brand name",
  "weight": "[Net weight in grams, number only]",
  "nutrition_data": {
    "nutrition_table": [{"ingredient": "Name", "amount": "100 mg", "nrv": "50" or "–"}],
    "ingredients_list": "Ingredient list comma separated",
    "allergens": "Contains: X, Y OR Does not contain common allergens",
    "free_from": "GMO-free, lactose-free etc if applicable"
  },
  "usage_html": "[HTML usage/storage instructions]"
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

HTML ФОРМАТ ОПИСАНИЯ (используйте точно эту структуру):
<p data-start="193" data-end="538"><strong data-start="193" data-end="228">[Название продукта] </strong> [Основное описание - что это, для кого, ключевые особенности]</p>
<p data-start="540" data-end="706">[Дополнительная информация - происхождение ингредиентов, научная база]</p>
<ul data-start="738" data-end="975">
 	<li data-start="738" data-end="782">
<p data-start="740" data-end="782">[Преимущество 1]</p>
</li>
 	<li data-start="783" data-end="842">
<p data-start="785" data-end="842">[Преимущество 2]</p>
</li>
 	<li data-start="843" data-end="910">
<p data-start="845" data-end="910">[Преимущество 3]</p>
</li>
 	<li data-start="911" data-end="975">
<p data-start="913" data-end="975">[Преимущество 4]</p>
</li>
</ul>
<p data-start="977" data-end="1092">[Итоговый абзац - почему выбрать этот продукт]</p>
<p data-start="1099" data-end="1174">Производитель: [Название, Страна]<br data-start="1139" data-end="1142" />Нетто: [количество капсул/таблеток] / [вес г]</p>

Ответьте в формате JSON:
{
  "name": "Название товара на русском языке",
  "ean": "[EAN/GTIN код если найден в собранной информации, иначе null]",
  "short_description": "Краткое описание товара (30-50 слов). Основные аргументы.",
  "description": "[HTML описание в формате выше]",
  "category_suggestion": "Рекомендуемая категория товара",
  "suggested_price_eur": [число или null],
  "brand": "Название бренда",
  "weight": "[Вес нетто в граммах, только число]",
  "nutrition_data": {
    "nutrition_table": [{"ingredient": "Название", "amount": "100 мг", "nrv": "50" или "–"}],
    "ingredients_list": "Список ингредиентов через запятую",
    "allergens": "Содержит: X, Y ИЛИ Не содержит распространённых аллергенов",
    "free_from": "Без ГМО, без лактозы и т.д. если применимо"
  },
  "usage_html": "[HTML инструкции по применению/хранению]"
}

Отвечайте ТОЛЬКО JSON, без дополнительных пояснений.`
  }
};

/**
 * Build ingredients HTML from structured nutrition data
 */
function buildIngredientsHtml(nutritionData) {
  if (!nutritionData) return '';

  const { nutrition_table, ingredients_list, allergens, free_from } = nutritionData;

  // Build table rows
  let tableRows = '';
  if (nutrition_table && Array.isArray(nutrition_table)) {
    tableRows = nutrition_table.map((row, index) => {
      const start = 115 + (index * 43);
      const mid1 = start + 16;
      const mid2 = mid1 + 12;
      const end = start + 43;

      return NUTRITION_ROW_TEMPLATE
        .replace(/\[START\]/g, start)
        .replace(/\[MID1\]/g, mid1)
        .replace(/\[MID2\]/g, mid2)
        .replace(/\[END\]/g, end)
        .replace('[INGREDIENT]', row.ingredient || '')
        .replace('[AMOUNT]', row.amount || '')
        .replace('[NRV]', row.nrv === '–' || row.nrv === '-' || !row.nrv ? '– **' : row.nrv);
    }).join('\n');
  }

  const table = NUTRITION_TABLE_TEMPLATE.replace('[TABLE_ROWS]', tableRows);

  // Build full HTML structure
  let html = `<div class="_tableContainer_80l1q_1">
<div class="_tableWrapper_80l1q_14 group flex w-fit flex-col-reverse" tabindex="-1">
<div class="_tableContainer_80l1q_1">
<div class="_tableWrapper_80l1q_14 group flex w-fit flex-col-reverse" tabindex="-1">
${table}
</div>
</div>
<p data-start="160" data-end="247" data-is-last-node="" data-is-only-node="">* %NRV – Täiskasvanu päevane võrdluskogus<br data-start="202" data-end="205" />** – Päevane võrdluskogus ei ole määratud</p>
<p data-start="160" data-end="247" data-is-last-node="" data-is-only-node=""><strong>Koostisosad
</strong>${ingredients_list || ''}<strong>
</strong></p>`;

  // Add allergens if present
  if (allergens) {
    html += `
<p><strong>Allergeenid</strong><br />${allergens}</p>`;
  }

  // Add free_from if present
  if (free_from) {
    html += `
<p><strong>Ei sisalda</strong><br />${free_from}</p>`;
  }

  html += `
</div>
</div>`;

  return html;
}

/**
 * Generate product content using OpenAI in specified language
 * @param {object} searchResults - Search results from search.js
 * @param {string|object} languageOrLogger - Language code or logger object (for backwards compatibility)
 * @param {object} logger - Logger object (optional if languageOrLogger is logger)
 */
export async function generateProductContent(searchResults, languageOrLogger, logger) {
  // Handle backwards compatibility - if languageOrLogger is an object, it's the logger
  let language = 'et';
  if (typeof languageOrLogger === 'string') {
    language = languageOrLogger;
  } else if (languageOrLogger && typeof languageOrLogger === 'object') {
    logger = languageOrLogger;
  }
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Call initOpenAI() first.');
  }

  const { productName, rawContent, confidence, images } = searchResults;
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

    // Build ingredients HTML from structured data
    const ingredientsHtml = parsed.nutrition_data
      ? buildIngredientsHtml(parsed.nutrition_data)
      : (parsed.meta_sisaldus_ja_koostisosad || parsed.ingredients || '');

    return {
      success: true,
      productName,
      sku: generateSKU(productName),
      language,
      name: parsed.name || productName,
      ean: parsed.ean || '',
      description: parsed.description || '',
      short_description: parsed.short_description || '',
      category_suggestion: parsed.category_suggestion || '',
      suggested_price_eur: parsed.suggested_price_eur,
      brand: parsed.brand || '',
      weight: parsed.weight || '',
      images: images || [],
      meta_sisaldus_ja_koostisosad: ingredientsHtml,
      meta_kasutamine_ja_hoiustamine: parsed.usage_html || parsed.meta_kasutamine_ja_hoiustamine || parsed.usage_instructions || '',
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
      confidence,
      images: images || []
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
