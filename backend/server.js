/*
  backend/server.js
  -----------------
  This file runs on Node.js, not in the browser.

  What this file does:
  - Starts an Express web server
  - Serves the frontend files
  - Exposes a POST /api/search endpoint
  - Talks to external services such as Nominatim and Overpass

  Why we need a backend:
  - The browser should not directly hold secret API keys
  - Third-party APIs often have CORS restrictions
  - Server code gives us one place to validate input, log errors, and shape responses

  Common beginner mistake:
  - Trying to use navigator.geolocation here.
    That will fail because there is no browser "navigator" object in Node.js.
    Geolocation must happen in frontend code.
*/

const path = require('path');
const express = require('express');

/*
  Node 18+ includes fetch globally.
  If you use an older Node version, you would install node-fetch.
*/

const app = express();
const PORT = process.env.PORT || 3000;

/*
  If you later switch to a paid API, the key belongs here on the server.
  The browser should never directly read secret keys.
*/
const API_KEY = process.env.API_KEY || '';

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const DEMO_ZIP_COORDINATES = {
  '01532': {
    latitude: 42.2626,
    longitude: -71.8023,
    label: '01532, Northborough, Massachusetts, United States'
  }
};

app.use(express.json());
app.use(express.static(FRONTEND_DIR));

/*
  Routes in Express:
  - A route is a URL pattern plus a handler function.
  - When a request matches the route, Express runs the handler.

  This route is the main bridge between browser and backend.
  The browser sends:
    {
      query: "ice cream",
      locationLabel: "01532",
      coordinates: { latitude: 42.26, longitude: -71.80 } | null
    }

  The backend then:
  1. Decides what coordinates to use
  2. Calls Overpass
  3. Returns simple JSON to the browser
*/
app.post('/api/search', async (req, res) => {
  try {
    const { query, locationLabel, coordinates } = req.body || {};

    /*
      We accept coordinates from the browser when geolocation is available.
      If we do not have coordinates, we geocode the user-provided label on the server.
    */
    const searchPoint = await resolveSearchPoint(locationLabel, coordinates);
    const results = await searchIceCreamShops({
      query,
      latitude: searchPoint.latitude,
      longitude: searchPoint.longitude
    });

    res.json({
      ok: true,
      usedLocation: searchPoint,
      results
    });
  } catch (error) {
    console.error('POST /api/search failed:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Search failed on the server.'
    });
  }
});

/*
  This route serves the HTML file when someone visits the site root.
  The browser loads index.html, then index.html loads script.js and style.css.
*/
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

async function resolveSearchPoint(locationLabel, coordinates) {
  if (coordinates && isFiniteNumber(coordinates.latitude) && isFiniteNumber(coordinates.longitude)) {
    return {
      source: 'browser-geolocation',
      latitude: Number(coordinates.latitude),
      longitude: Number(coordinates.longitude),
      label: locationLabel || 'Current browser location'
    };
  }

  if (!locationLabel) {
    throw new Error('No location was provided.');
  }

  /*
    For teaching and debugging, we keep one known-good ZIP fallback.
    This avoids confusing geocoder mismatches during the demo for 01532.
  */
  if (DEMO_ZIP_COORDINATES[locationLabel.trim()]) {
    return {
      source: 'demo-zip-lookup',
      ...DEMO_ZIP_COORDINATES[locationLabel.trim()]
    };
  }

  /*
    This is server-side geocoding.
    We turn a human-friendly location like a ZIP code into latitude and longitude.
  */
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('q', buildGeocodingQuery(locationLabel));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  /*
    A plain 5-digit ZIP code can be ambiguous globally.
    By restricting the search to the United States, we avoid matching unrelated postcodes in other countries.
  */
  if (/^\d{5}$/.test(locationLabel.trim())) {
    url.searchParams.set('countrycodes', 'us');
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      /*
        Some public APIs want identifying information in server requests.
        This is one more reason backend requests are easier to control than browser requests.
      */
      'User-Agent': 'ice-cream-finder-demo/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed with status ${response.status}.`);
  }

  const matches = await response.json();

  if (!matches.length) {
    throw new Error('That location could not be geocoded.');
  }

  return {
    source: 'server-geocoding',
    latitude: Number(matches[0].lat),
    longitude: Number(matches[0].lon),
    label: matches[0].display_name || locationLabel
  };
}

async function searchIceCreamShops({ query, latitude, longitude }) {
  /*
    We keep the Overpass query intentionally simple and testable.
    This is a good beginner pattern:
    - start simple
    - verify that data comes back
    - expand later only if needed
  */
  const searchRadius = 10000;
  const overpassQuery = `
    [out:json][timeout:25];
    (
      node["amenity"="ice_cream"](around:${searchRadius},${latitude},${longitude});
      node["shop"="ice_cream"](around:${searchRadius},${latitude},${longitude});
    );
    out;
  `;

  const payload = await fetchOverpassJson(overpassQuery);
  const elements = Array.isArray(payload.elements) ? payload.elements : [];

  /*
    We return structured data for the frontend to render.
    This is easier to work with than returning raw Overpass payloads.
  */
  return elements.slice(0, 10).map((element) => {
    const tags = element.tags || {};

    return {
      name: tags.name || query || 'Ice cream shop',
      address: formatAddress(tags),
      website: normalizeWebsite(tags.website || tags['contact:website'] || ''),
      sourceTag: tags.amenity || tags.shop || 'unknown'
    };
  });
}

function formatAddress(tags) {
  const line1 = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const line2 = [tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(', ') || 'Address not listed in OpenStreetMap';
}

function normalizeWebsite(value) {
  if (!value) {
    return '';
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function buildGeocodingQuery(locationLabel) {
  const trimmed = locationLabel.trim();

  if (/^\d{5}$/.test(trimmed)) {
    return `${trimmed}, USA`;
  }

  return trimmed;
}

async function fetchOverpassJson(overpassQuery) {
  let lastError = null;

  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: `data=${encodeURIComponent(overpassQuery)}`
      });

      if (!response.ok) {
        throw new Error(`Overpass search failed with status ${response.status}.`);
      }

      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch {
        throw new Error('Overpass returned non-JSON data.');
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Overpass search failed.');
}

/*
  app.listen starts the HTTP server in local development.

  For some serverless platforms, you may export the app instead of listening directly.
  This project keeps the setup simple for local learning and platforms like Render / Railway.
*/
app.listen(PORT, () => {
  console.log(`Ice Cream Finder server running at http://localhost:${PORT}`);
  if (API_KEY) {
    console.log('API_KEY is set.');
  } else {
    console.log('API_KEY is not set. That is okay for the current Overpass-based demo.');
  }
});
