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

    // Căutare în Open Food Facts
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(search)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,ingredients_text,nutriments,labels`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'EtiQuette/1.0 (contact@etiquette.app)'
      }
    });

    if (!response.ok) {
      throw new Error('OFF răspuns: ' + response.status);
    }

    const data = await response.json();

    // Returnăm primul produs găsit cu ingrediente
    const products = (data.products || []).filter(p => p.ingredients_text && p.ingredients_text.length > 10);

    if (products.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: false })
      };
    }

    const p = products[0];
    const n = p.nutriments || {};

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        product_name: p.product_name || '',
        brand: p.brands || '',
        ingredients: p.ingredients_text || '',
        nutrition: {
          energy_kj: n['energy-kj_100g'] || null,
          fat: n['fat_100g'] || null,
          saturated_fat: n['saturated-fat_100g'] || null,
          carbohydrates: n['carbohydrates_100g'] || null,
          sugars: n['sugars_100g'] || null,
          fiber: n['fiber_100g'] || null,
          protein: n['proteins_100g'] || null,
          sodium: n['sodium_100g'] ? n['sodium_100g'] * 1000 : null
        },
        is_organic: (p.labels || '').toLowerCase().includes('organic') ||
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
