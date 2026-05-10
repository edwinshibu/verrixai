import { minify as minifyHtml } from 'html-minifier-terser';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC  = __dirname;
const DIST = join(__dirname, 'dist');

// HTML minification options
const HTML_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  minifyCSS: true,
  minifyJS: {
    compress: { drop_console: false },
    mangle: true,
  },
  useShortDoctype: true,
};

// Files/dirs to copy as-is (no minification)
const COPY_AS_IS = [
  'favicon.svg', 'favicon.ico',
  'favicon-32.png', 'favicon-16.png', 'favicon-180.png',
  'logo_transparent.png',
  'sitemap.xml',
  'robots.txt',
];

// HTML files to minify
const HTML_FILES = [
  'index.html', 'pricing.html', 'account.html',
  'terms.html', 'privacy.html', '404.html',
];

async function build() {
  // Create dist dir
  mkdirSync(DIST, { recursive: true });

  // Copy static assets
  for (const f of COPY_AS_IS) {
    try {
      copyFileSync(join(SRC, f), join(DIST, f));
      console.log(`✓ copied  ${f}`);
    } catch(e) { /* file may not exist */ }
  }

  // Copy vercel.json (harmless — Vercel reads it from project root regardless)
  copyFileSync(join(SRC, 'vercel.json'), join(DIST, 'vercel.json'));

  // Minify HTML files
  for (const f of HTML_FILES) {
    try {
      const src = readFileSync(join(SRC, f), 'utf8');
      const min = await minifyHtml(src, HTML_OPTS);
      writeFileSync(join(DIST, f), min);
      const savings = (((src.length - min.length) / src.length) * 100).toFixed(0);
      console.log(`✓ minified ${f} — ${savings}% smaller`);
    } catch(e) { console.error(`✗ ${f}:`, e.message); }
  }

  // Note: API endpoints (api/*.js) are intentionally NOT processed here.
  // Vercel auto-detects serverless functions from the source /api/ directory
  // at the project root, regardless of buildCommand/outputDirectory. Anything
  // we wrote to dist/api/ would be ignored by the deploy. Shipping the source
  // unminified also keeps stack traces readable in Vercel logs.

  console.log('\n✅ Build complete → dist/');
}

build().catch(console.error);
