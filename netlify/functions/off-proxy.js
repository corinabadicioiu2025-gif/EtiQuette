exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const search = event.queryStringParameters && event.queryStringParameters.search;
    if (!search) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Parametru search lipsă' })
      };
    }

    // ── Algoritm fuzzy matching — același ca în searchEtiQuette ──
    function normalizeText(text) {
      if (!text) return '';
      return text.toLowerCase()
        .replace(/[ăâ]/g, 'a').replace(/[îí]/g, 'i').replace(/[șş]/g, 's')
        .replace(/[țţ]/g, 't').replace(/[é]/g, 'e')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
    }

    function tokenize(text) {
      const stopwords = ['in', 'cu', 'de', 'la', 'si', 'sau', 'the', 'with', 'and', 'for'];
      return normalizeText(text).split(' ')
        .filter(w => w.length > 2 && !stopwords.includes(w));
    }

    function calcScor(tokensQuery, tokensProdus) {
      if (!tokensQuery.length || !tokensProdus.length) return 0;
      const comuni = tokensQuery.filter(t => tokensProdus.includes(t)).length;
      const baza = Math.min(tokensQuery.length, tokensProdus.length);
      return Math.round((comuni / baza) * 100);
    }

    // ── Funcție de căutare în OFF ────────────────────────────────
    async function searchOFF(query) {
      const credStr = 'carolina2025:5wPgVPzGK*!g8_F';
      const credentials = (typeof Buffer !== 'undefined')
        ? Buffer.from(credStr).toString('base64')
        : btoa(credStr);

      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=8&fields=product_name,brands,ingredients_text,nutriments,labels`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EtiQuette/1.0 (contact@etiquette.app)',
          'Authorization': `Basic ${credentials}`
        },
        timeout: 8000
      });

      if (!response.ok) {
        console.log('OFF status:', response.status, 'pentru query:', query);
        return [];
      }

      let data;
      try {
        data = await response.json();
      } catch(jsonErr) {
        console.log('OFF JSON parse error pentru query:', query);
        return [];
      }

      return (data.products || []).filter(p =>
        p.ingredients_text && p.ingredients_text.length > 10
      );
    }

    // ── Construim variantele de query ────────────────────────────
    const words = search.trim().split(/\s+/);
    const query1 = search.trim();
    const query2 = words.length > 2 ? words.slice(0, -1).join(' ') : null;

    const tokensQuery = tokenize(search);
    const PRAG_MINIM = 70;

    console.log('OFF search query:', search);
    console.log('Tokens query:', tokensQuery);

    let bestProduct = null;
    let bestScor = 0;

    async function searchAndScore(query) {
      const products = await searchOFF(query);
      products.forEach(p => {
        const productText = (p.product_name || '') + ' ' + (p.brands || '');
        const tokensProdus = tokenize(productText);
        const scor = calcScor(tokensQuery, tokensProdus);
        console.log(`  Candidat: "${productText}" -> scor ${scor}%`);
        if (scor > bestScor) {
          bestScor = scor;
          bestProduct = p;
        }
      });
    }

    // Stratul 1 — query complet
    await searchAndScore(query1);

    // Stratul 2 — fără ultimul cuvânt dacă nu am găsit
    if (bestScor < PRAG_MINIM && query2 && query2 !== query1) {
      await searchAndScore(query2);
    }

    console.log('Best match: ' + (bestProduct ? bestProduct.product_name : 'none') + ' -> scor ' + bestScor + '%');

    if (!bestProduct || bestScor < PRAG_MINIM) {
      console.log('Scor ' + bestScor + '% < prag ' + PRAG_MINIM + '% -> found: false');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: false })
      };
    }

    const p = bestProduct;
    const n = p.nutriments || {};
    const sodiumG = n['sodium_100g'] || null;
    const sodiumMg = sodiumG !== null ? Math.round(sodiumG * 1000) : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        product_name: p.product_name || '',
        brand: p.brands || '',
        ingredients: p.ingredients_text || '',
        scor_match: bestScor,
        nutrition: {
          energy_kj:     n['energy-kj_100g']    || null,
          fat:           n['fat_100g']           || null,
          saturated_fat: n['saturated-fat_100g'] || null,
          carbohydrates: n['carbohydrates_100g'] || null,
          sugars:        n['sugars_100g']        || null,
          fiber:         n['fiber_100g']         || null,
          protein:       n['proteins_100g']      || null,
          sodium:        sodiumMg
        },
        is_organic:
          (p.labels || '').toLowerCase().includes('organic') ||
          (p.labels || '').toLowerCase().includes('bio')
      })
    };

  } catch(e) {
    console.error('off-proxy eroare:', e.message, e.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message, found: false })
    };
  }
};
