/*
  frontend/script.js
  ------------------
  This file runs in the browser.

  What this file is responsible for:
  - Reading what the user typed into the page
  - Asking the browser for geolocation permission
  - Sending JSON to our backend with fetch("/api/search")
  - Rendering the JSON response on the page

  What this file is NOT responsible for:
  - Calling external APIs directly
  - Storing API keys
  - Doing server-only work

  Why:
  - Browser code is public. Users can inspect it.
  - Browser-only APIs such as navigator.geolocation do not exist on the server.
  - Keeping third-party API calls in the backend avoids CORS problems and keeps secrets private.
*/

const queryInput = document.getElementById('query-input');
const locationInput = document.getElementById('location-input');
const useLocationBtn = document.getElementById('use-location-btn');
const searchBtn = document.getElementById('search-btn');
const statusArea = document.getElementById('status-area');
const resultsArea = document.getElementById('results');

/*
  We keep the user's coordinates in memory after geolocation succeeds.
  This is browser state, not server state.
*/
let currentCoordinates = null;

useLocationBtn.addEventListener('click', handleUseLocation);
searchBtn.addEventListener('click', handleSearch);

queryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSearch();
  }
});

locationInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSearch();
  }
});

locationInput.addEventListener('input', () => {
  /*
    If the user edits the location field manually, we stop trusting the last geolocation coordinates.
    This avoids a confusing bug where the text says one place but the search still uses old coordinates.
  */
  currentCoordinates = null;
});

function setStatus(message, isError = false) {
  statusArea.innerHTML = message
    ? `<div class="status-card ${isError ? 'error' : ''}">${message}</div>`
    : '';
}

function clearResults() {
  resultsArea.innerHTML = '';
}

async function handleUseLocation() {
  /*
    Common beginner mistake:
    Trying to use navigator.geolocation on the server.

    That will fail because "navigator" only exists in the browser.
    Geolocation belongs here in client-side code.
  */
  if (!navigator.geolocation) {
    setStatus('Your browser does not support geolocation.', true);
    return;
  }

  setStatus('Requesting your location from the browser...');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      /*
        This text is just a label for the user.
        The real data we care about is the latitude and longitude.
      */
      locationInput.value = `${currentCoordinates.latitude.toFixed(4)}, ${currentCoordinates.longitude.toFixed(4)}`;
      setStatus('Location captured. You can search now.');
    },
    (error) => {
      console.error('Geolocation error:', error);
      setStatus('Could not read your location. You can still type a ZIP code or city manually.', true);
    }
  );
}

async function handleSearch() {
  const query = queryInput.value.trim() || 'ice cream';
  const locationLabel = locationInput.value.trim();

  /*
    We support two ways to search:
    1. The browser already has coordinates from geolocation
    2. The user types a city or ZIP code and the server geocodes it
  */
  if (!currentCoordinates && !locationLabel) {
    setStatus('Use your location or type a city / ZIP code first.', true);
    return;
  }

  searchBtn.disabled = true;
  clearResults();
  setStatus('Sending your search to the backend...');

  try {
    /*
      This fetch goes to OUR server, not directly to Overpass or Nominatim.

      Why this architecture helps:
      - No CORS problem between the browser and third-party APIs
      - No secret keys exposed to the browser
      - One consistent backend place to debug requests
    */
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        locationLabel,
        coordinates: currentCoordinates
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Search failed.');
    }

    setStatus(`Found ${payload.results.length} result(s).`);
    renderResults(payload.results);
  } catch (error) {
    console.error('Search error:', error);
    setStatus(error.message || 'Something went wrong while searching.', true);
  } finally {
    searchBtn.disabled = false;
  }
}

function renderResults(results) {
  if (!results.length) {
    resultsArea.innerHTML = `
      <article class="result-card">
        <h2>No Results</h2>
        <p>No matching ice cream shops were returned by the server.</p>
      </article>
    `;
    return;
  }

  resultsArea.innerHTML = results
    .map((result) => {
      const websiteHtml = result.website
        ? `<p><a href="${escapeHtml(result.website)}" target="_blank" rel="noopener noreferrer">Visit website</a></p>`
        : '<p>No website listed.</p>';

      return `
        <article class="result-card">
          <h2>${escapeHtml(result.name)}</h2>
          <p>${escapeHtml(result.address)}</p>
          <p class="meta">Source tags: ${escapeHtml(result.sourceTag)}</p>
          ${websiteHtml}
        </article>
      `;
    })
    .join('');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
