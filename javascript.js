const statusArea = document.getElementById('status-area');
const resultsDiv = document.getElementById('results');
const findBtn = document.getElementById('find-btn');
const locInput = document.getElementById('location-input');
const useLocationLink = document.getElementById('use-location');

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass.kumi.systems/api/interpreter';
const NORTHBOROUGH_ZIP = {
  lat: 42.2626,
  lng: -71.8023,
  radius: 10000
};

locInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    findShops();
  }
});

findBtn.addEventListener('click', findShops);
useLocationLink.addEventListener('click', useMyLocation);

function setStatus(message, spinning = false) {
  statusArea.innerHTML = message
    ? `<div class="status-msg">${spinning ? '<div class="spinner"></div>' : ''}<span>${message}</span></div>`
    : '';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not supported by your browser.');
    return;
  }

  setStatus('Getting your location...', true);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      locInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      setStatus('');
      findShops();
    },
    () => {
      setStatus('Could not get your location. Please type it manually.');
    }
  );
}

async function findShops() {
  const location = locInput.value.trim();

  if (!location) {
    locInput.focus();
    return;
  }

  if (window.location.protocol === 'file:') {
    resultsDiv.innerHTML =
      '<div class="msg-box"><span class="emoji">&#128546;</span>Open this app from a local web server, not from a file.<br>Try <code>python -m http.server 8000</code> and then open <code>http://localhost:8000</code>.</div>';
    return;
  }

  findBtn.disabled = true;
  resultsDiv.innerHTML = '';
  setStatus('Searching for one nearby ice cream shop...', true);

  try {
    const searchPoint = await resolveLocation(location);
    const shop = await fetchFirstShop(searchPoint);

    setStatus('');
    renderResults(shop, location);
  } catch (error) {
    console.error(error);
    setStatus('');
    resultsDiv.innerHTML = `<div class="msg-box"><span class="emoji">&#128546;</span>${escapeHtml(
      error.message || 'Search failed.'
    )}</div>`;
  } finally {
    findBtn.disabled = false;
  }
}

async function resolveLocation(location) {
  const isZipCode = /^\d{5}$/.test(location);

  if (location === '01532') {
    return NORTHBOROUGH_ZIP;
  }

  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(location)) {
    const [lat, lng] = location.split(',').map((part) => Number(part.trim()));
    return { lat, lng, radius: 20000 };
  }

  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('q', location);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Could not look up that location.');
  }

  const matches = await response.json();

  if (!matches.length) {
    throw new Error('That location was not found.');
  }

  return {
    lat: Number(matches[0].lat),
    lng: Number(matches[0].lon),
    radius: isZipCode ? 40000 : 20000
  };
}

async function fetchFirstShop(searchPoint) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="ice_cream"](around:${searchPoint.radius},${searchPoint.lat},${searchPoint.lng});
      node["shop"="ice_cream"](around:${searchPoint.radius},${searchPoint.lat},${searchPoint.lng});
    );
    out;
  `;

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: `data=${encodeURIComponent(query)}`
  });

  if (!response.ok) {
    throw new Error('Overpass did not respond.');
  }

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Overpass returned an invalid response.');
  }

  const firstMatch = Array.isArray(data.elements) ? data.elements[0] : null;

  if (!firstMatch) {
    throw new Error('No ice cream shops were found near that location.');
  }

  const tags = firstMatch.tags || {};

  return {
    name: tags.name || 'Ice cream shop',
    address: formatAddress(tags),
    website: sanitizeWebsite(tags.website || tags['contact:website'] || '')
  };
}

function formatAddress(tags) {
  const streetNumber = tags['addr:housenumber'] || '';
  const street = tags['addr:street'] || '';
  const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || '';
  const state = tags['addr:state'] || '';
  const postcode = tags['addr:postcode'] || '';

  const line1 = [streetNumber, street].filter(Boolean).join(' ');
  const line2 = [city, state, postcode].filter(Boolean).join(', ');
  const address = [line1, line2].filter(Boolean).join(', ');

  return address || 'Address not listed in OpenStreetMap';
}

function sanitizeWebsite(url) {
  if (!url) {
    return '';
  }

  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function renderResults(shop, location) {
  if (!shop) {
    resultsDiv.innerHTML = `<div class="msg-box"><span class="emoji">&#127847;</span>No shops found near <strong>${escapeHtml(location)}</strong>.</div>`;
    return;
  }

  resultsDiv.innerHTML = `
    <div class="shop-card">
      <div class="shop-header">
        <div>
          <div class="shop-name">${escapeHtml(shop.name)}</div>
          <div class="shop-address">&#128205; ${escapeHtml(shop.address)}</div>
          ${
            shop.website
              ? `<div class="shop-address" style="margin-top:4px"><a href="${escapeHtml(
                  shop.website
                )}" target="_blank" rel="noopener noreferrer" style="color:var(--mint);text-decoration:none;letter-spacing:.04em">Visit website</a></div>`
              : ''
          }
        </div>
        <div class="shop-meta">
          <span class="badge-count">1 shop found</span>
        </div>
      </div>
      <div class="no-options">Starting simple: this is the first nearby shop returned by Overpass.</div>
    </div>
  `;
}
