const AWC = 'https://aviationweather.gov/api/data';
const ALLOWED_ORIGINS = new Set([
  'https://scannie128.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:5500'
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'GET requests only.' }, 405, cors);

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, service: 'UAS Weather Proxy', routes: ['/metar?ids=KBIL', '/nearest?lat=45&lon=-111', '/geocode?q=Wolf Creek, MT'] }, 200, cors);
      }
      if (url.pathname === '/metar') return await metar(url, cors);
      if (url.pathname === '/nearest') return await nearest(url, cors);
      if (url.pathname === '/geocode') return await geocode(url, cors, ctx);
      return json({ error: 'Route not found.' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: error.message || 'Proxy request failed.' }, 500, cors);
    }
  }
};

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://scannie128.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Cache-Control': 'no-store'
  };
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}
async function awcJson(path, params) {
  const target = new URL(`${AWC}/${path}`);
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && target.searchParams.set(k, String(v)));
  const response = await fetch(target, { headers: { Accept: 'application/json', 'User-Agent': 'IE-UAS-Weather/2.0 (https://scannie128.github.io)' } });
  if (response.status === 204) return [];
  if (!response.ok) throw new Error(`Aviation Weather returned HTTP ${response.status}.`);
  return response.json();
}
async function metar(url, cors) {
  const ids = (url.searchParams.get('ids') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(ids)) return json({ error: 'A valid 3 or 4 character station identifier is required.' }, 400, cors);
  const observations = await awcJson('metar', { ids, format: 'json', hours: 3 });
  if (!observations.length) return json({ error: `No recent METAR was found for ${ids}.` }, 404, cors);
  const airportRows = await awcJson('airport', { ids, format: 'json' }).catch(() => []);
  return json({ metar: observations[0], airport: airportRows[0] || null }, 200, cors);
}
async function nearest(url, cors) {
  const lat = finite(url.searchParams.get('lat'));
  const lon = finite(url.searchParams.get('lon'));
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'Valid latitude and longitude are required.' }, 400, cors);
  const radius = Math.min(Math.max(finite(url.searchParams.get('radius')) || 120, 25), 250);
  const dLat = radius / 69;
  const dLon = radius / Math.max(10, 69 * Math.cos(lat * Math.PI / 180));
  const bbox = `${lat-dLat},${lon-dLon},${lat+dLat},${lon+dLon}`;
  const observations = await awcJson('metar', { bbox, format: 'json', hours: 3 });
  const ranked = observations.map(o => ({ ...o, distanceMiles: haversine(lat, lon, Number(o.lat), Number(o.lon)) }))
    .filter(o => Number.isFinite(o.distanceMiles)).sort((a,b) => a.distanceMiles-b.distanceMiles).slice(0,5);
  if (!ranked.length) return json({ error: `No METAR observations were found within the search area.` }, 404, cors);
  const ids = ranked.map(o => o.icaoId).join(',');
  const airports = await awcJson('airport', { ids, format: 'json' }).catch(() => []);
  const airportMap = new Map(airports.map(a => [a.icaoId, a]));
  return json({ location: { lat, lon }, stations: ranked.map(o => ({ metar: o, airport: airportMap.get(o.icaoId) || null, distanceMiles: o.distanceMiles })) }, 200, cors);
}
async function geocode(url, cors, ctx) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 3 || q.length > 120) return json({ error: 'Enter a city and state or another concise US place name.' }, 400, cors);
  const target = new URL('https://nominatim.openstreetmap.org/search');
  target.searchParams.set('q', q);
  target.searchParams.set('format', 'jsonv2');
  target.searchParams.set('limit', '5');
  target.searchParams.set('countrycodes', 'us');
  target.searchParams.set('addressdetails', '1');
  const cacheKey = new Request(target.toString(), { headers: { Accept: 'application/json' } });
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  if (!response) {
    const upstream = await fetch(target, { headers: { Accept: 'application/json', 'User-Agent': 'IE-UAS-Weather/2.0 (https://scannie128.github.io/IE_Survey_Tools_BETA/)' } });
    if (!upstream.ok) throw new Error(`Location search returned HTTP ${upstream.status}.`);
    response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'public, max-age=86400');
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  const results = await response.json();
  return json({ results: results.map(r => ({ name: r.display_name, lat: Number(r.lat), lon: Number(r.lon), type: r.type })) }, 200, cors);
}
function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function haversine(a,b,c,d) { const R=3958.7613, rad=x=>x*Math.PI/180; const p=rad(c-a), q=rad(d-b); const h=Math.sin(p/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(q/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
