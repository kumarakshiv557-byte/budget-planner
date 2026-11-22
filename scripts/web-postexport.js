// Adds the web app manifest, home-screen icon and SPA fallback to an `expo export --platform web` build.
// Usage: node scripts/web-postexport.js [baseUrl]   e.g. /budget-planner for GitHub Pages
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || '').replace(/\/$/, '');
const dist = path.join(__dirname, '..', 'dist');
const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const tags = [
  `<link rel="manifest" href="${base}/manifest.webmanifest">`,
  `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">`,
  `<meta name="theme-color" content="#111110">`,
  `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-title" content="Budget">`,
].join('');
if (!html.includes('rel="manifest"')) html = html.replace('</head>', `${tags}</head>`);
fs.writeFileSync(indexPath, html);
fs.copyFileSync(indexPath, path.join(dist, '404.html'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('web-postexport: manifest linked, 404.html written');
