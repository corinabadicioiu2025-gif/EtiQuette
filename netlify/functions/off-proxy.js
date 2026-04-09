const fetch = require('node-fetch');

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

    // ── Funcție de căutare în OFF cu autentificare ──────────
    async function searchOFF(query) {
      const credentials = Buffer.from('carolina2025:5wPgVPzGK*!g8_F').toString('base64');
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,ingredients_text,nutriments,labels`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EtiQuette/1.0 (contact@etiquette.app)',
          'Authorization': `Basic ${credentials}`
        }
      });
      if (!response.ok) throw new Error('OFF status: ' + response.status);
      const data = await response.json();
      // Returnăm doar produsele cu ingrediente complete
      return (data.products || []).filter(p =>
        p.ingredients_text && p.ingredients_text.length > 10
      );
    }

    // ── Validare variantă produs ───────────────────────────
    // Dacă query-ul conține termeni de variantă (zero, light, diet etc.)
    // verificăm că produsul găsit conține același termen
    const variantTerms = ['zero', 'light', 'diet', 'sugar free', 'sans sucre', 
                          'max', 'plus', 'original', 'classic', 'cherry',
                          'vanilla', 'lemon', 'orange', 'strawberry'];
    
    const queryLower = search.toLowerCase();
    const queryVariants = variantTerms.filter(t => queryLower.includes(t));
    
    // Filtrăm produsele care conțin variantele căutate
    function hasVariantMatch(product, variants) {
      if (variants.length === 0) return true; // fără termeni specifici — orice merge
      const productText = ((product.product_name || '') + ' ' + (product.brands || '')).toLowerCase();
      return variants.some(v => productText.includes(v));
    }

    // ── Construim variantele de query ──────────────────────
    const words = search.trim().split(/\s+/);

    // Varianta 1 — query complet (ex: "Coca-Cola Zero Sugar")
    const query1 = search.trim();

    // Varianta 2 — fără ultimul cuvânt (ex: "Coca-Cola Zero")
    const query2 = words.length > 2
      ? words.slice(0, -1).join(' ')
      : null;

    // Varianta 3 — primele 2 cuvinte (ex: "Coca-Cola")
    const query3 = words.length > 2
      ? words.slice(0, 2).join(' ')
      : null;

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

    // Stratul 3 eliminat — risc prea mare de produs greșit
    // Dacă nu găsim în 2 straturi → flux manual cu date corecte

    // ── Niciun rezultat ────────────────────────────────────
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

    // Sodiu — OFF îl returnează în g/100g, noi vrem mg/100g
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
          energy_kj:      n['energy-kj_100g']      || null,
          fat:            n['fat_100g']             || null,
          saturated_fat:  n['saturated-fat_100g']   || null,
          carbohydrates:  n['carbohydrates_100g']   || null,
          sugars:         n['sugars_100g']          || null,
          fiber:          n['fiber_100g']           || null,
          protein:        n['proteins_100g']        || null,
          sodium:         sodiumMg
        },
        is_organic:
          (p.labels || '').toLowerCase().includes('organic') ||
          (p.labels || '').toLowerCase().includes('bio')
      })
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message, found: false })
    };
  }
};
