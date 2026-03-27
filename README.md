# Ice Cream Finder

Ice Cream Finder is a small full-stack demo that shows how to split a browser app into:

- a frontend that handles the page and geolocation
- a backend that handles API calls to OpenStreetMap services

This architecture is much more reliable than a frontend-only app when you deploy to platforms like Vercel, Render, or Railway.

## Why This Project Uses Frontend + Backend

The original version lived entirely in the browser. That creates a few common problems:

- Browser-only APIs such as `navigator.geolocation` only work in the browser, not on the server.
- Third-party APIs can reject browser requests because of CORS.
- API keys should never live in frontend JavaScript because users can inspect the code.
- Deployment becomes confusing when frontend code tries to do everything itself.

This refactor fixes that by splitting responsibilities clearly:

- Frontend:
  - renders the UI
  - asks the browser for geolocation
  - sends JSON to the backend with `fetch("/api/search")`
- Backend:
  - receives the browser request
  - geocodes typed locations when needed
  - calls Overpass
  - returns clean JSON to the browser

## Project Structure

```text
project-root/
|
|- frontend/
|  |- index.html
|  |- script.js
|  |- style.css
|
|- backend/
|  |- server.js
|  |- package.json
|
|- README.md
```

## How The Request Flow Works

1. The user opens the app in the browser.
2. The browser loads `frontend/index.html`.
3. `frontend/script.js` runs in the browser.
4. If the user clicks "Use My Location", the browser calls `navigator.geolocation`.
5. The browser sends a `POST /api/search` request to the Express backend.
6. The backend decides which coordinates to use:
   - browser geolocation coordinates, or
   - server-side geocoding of a typed city / ZIP code
7. The backend calls Overpass.
8. The backend returns JSON results.
9. The frontend renders those results on the page.

## Run Locally

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Start the server

```bash
npm start
```

The app will run at:

```text
http://localhost:3000
```

Because Express serves the `frontend/` folder, you only need one local server.

## Environment Variables

This demo currently uses Overpass and Nominatim, so it does not require a private API key.

If you later switch to a paid API or LLM provider, store the key in the backend only:

```bash
API_KEY=your_secret_key_here
```

Then read it in `backend/server.js` with:

```js
process.env.API_KEY
```

Do not place secret keys in `frontend/script.js`.

## Important Learning Notes

### Why geolocation must stay in the frontend

`navigator.geolocation` is a browser API. The Node.js server does not have a `navigator` object.

So this is correct:

- ask for location in browser JavaScript
- send coordinates to backend

This is incorrect:

- trying to call `navigator.geolocation` in Express

### Why API calls move to the backend

Calling third-party APIs from the browser often causes:

- CORS errors
- exposed secrets
- harder debugging
- inconsistent deployment behavior

Routing those requests through your backend gives you:

- one controlled place for external requests
- easier logging and error handling
- better security

## Deployment

### Easiest beginner deployment: one Express app on Render or Railway

Because this project serves the frontend from Express, the simplest deployment is:

- deploy the backend folder as a Node app
- let Express serve the frontend files

That gives you one app, one origin, and fewer moving parts.

### Vercel note

Vercel is great for static frontends and serverless functions, but a plain Express server may need adaptation into serverless function files.

If you want to keep this exact beginner-friendly structure, deploy it on:

- Render
- Railway
- Fly.io

If you specifically want Vercel later, the backend route can be converted into a serverless function.

### HTTPS and geolocation

Browsers usually require a secure context for geolocation:

- `https://...` works
- `http://localhost` works for local development
- plain non-secure remote HTTP often does not work

That is another reason deployment matters.

## Common Mistakes

- Using `navigator` in backend code
- Putting API keys in frontend code
- Calling third-party APIs directly from the browser and hitting CORS
- Assuming deployment problems are "random" instead of checking which environment the code runs in

## Next Steps

Once this base architecture is working, you can extend it with:

- better search filters
- result ranking
- map display
- saved favorites
- a paid AI API for menu analysis

But it is worth getting this simple browser + backend flow stable first.
