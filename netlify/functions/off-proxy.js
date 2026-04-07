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

    // ── Funcție de căutare în OFF ──────────────────────────
    async function searchOFF(query) {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,ingredients_text,nutriments,labels`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'EtiQuette/1.0 (contact@etiquette.app)' }
      });
      if (!response.ok) throw new Error('OFF status: ' + response.status);
      const data = await response.json();
      // Returnăm doar produsele cu ingrediente complete
      return (data.products || []).filter(p =>
        p.ingredients_text && p.ingredients_text.length > 10
      );
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

    // ── Căutare în 3 straturi ──────────────────────────────
    let products = [];

    // Stratul 1
    products = await searchOFF(query1);

    // Stratul 2 — dacă stratul 1 a eșuat
    if (products.length === 0 && query2 && query2 !== query1) {
      products = await searchOFF(query2);
    }

    // Stratul 3 — dacă stratul 2 a eșuat
    if (products.length === 0 && query3 && query3 !== query2) {
      products = await searchOFF(query3);
    }

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
