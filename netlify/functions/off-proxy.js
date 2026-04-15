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

    // ── Funcție de căutare în OFF ────────────────────────────
    // FIX: înlocuit Buffer.from().toString('base64') cu btoa()
    // Buffer nu e disponibil în toate mediile Netlify și cauza eroarea 500
    async function searchOFF(query) {
      // FIX: compatibil cu toate versiunile Node.js
      const credStr = 'carolina2025:5wPgVPzGK*!g8_F';
      const credentials = (typeof Buffer !== 'undefined')
        ? Buffer.from(credStr).toString('base64')
        : btoa(credStr);
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,ingredients_text,nutriments,labels`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EtiQuette/1.0 (contact@etiquette.app)',
          'Authorization': `Basic ${credentials}`
        },
        // FIX: timeout explicit — fără timeout OFF poate bloca funcția indefinit
        timeout: 8000
      });

      if (!response.ok) {
        // FIX: log status pentru debugging, returnăm array gol în loc de throw
        console.log('OFF status:', response.status, 'pentru query:', query);
        return [];
      }

      let data;
      try {
        data = await response.json();
      } catch(jsonErr) {
        // FIX: OFF returnează uneori HTML în loc de JSON (când e down)
        console.log('OFF JSON parse error pentru query:', query);
        return [];
      }

      // Returnăm doar produsele cu ingrediente complete
      return (data.products || []).filter(p =>
        p.ingredients_text && p.ingredients_text.length > 10
      );
    }

    // ── Validare variantă produs ───────────────────────────
    const variantTerms = ['zero', 'light', 'diet', 'sugar free', 'sans sucre',
                          'max', 'plus', 'original', 'classic', 'cherry',
                          'vanilla', 'lemon', 'orange', 'strawberry'];

    const queryLower = search.toLowerCase();
    const queryVariants = variantTerms.filter(t => queryLower.includes(t));

    function hasVariantMatch(product, variants) {
      if (variants.length === 0) return true;
      const productText = ((product.product_name || '') + ' ' + (product.brands || '')).toLowerCase();
      return variants.some(v => productText.includes(v));
    }

    // ── Construim variantele de query ──────────────────────
    const words = search.trim().split(/\s+/);

    const query1 = search.trim();
    const query2 = words.length > 2 ? words.slice(0, -1).join(' ') : null;

    // ── Căutare în 2 straturi ──────────────────────────────
    let products = [];

    // Stratul 1 — query complet
    products = await searchOFF(query1);
    products = products.filter(p => hasVariantMatch(p, queryVariants));

    // Stratul 2 — fără ultimul cuvânt
    if (products.length === 0 && query2 && query2 !== query1) {
      products = await searchOFF(query2);
      products = products.filter(p => hasVariantMatch(p, queryVariants));
    }

    if (products.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: false })
      };
    }

    // ── Procesăm primul rezultat bun ───────────────────────
    const p = products[0];
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
    // FIX: log eroarea completă pentru debugging în Netlify Functions log
    console.error('off-proxy eroare:', e.message, e.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message, found: false })
    };
  }
};
