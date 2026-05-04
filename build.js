import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
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

// JS minification options
const JS_OPTS = {
  compress: { drop_console: false },
  mangle: true,
};

// Files/dirs to copy as-is (no minification)
const COPY_AS_IS = [
  'favicon.svg', 'favicon.ico',
  'favicon-32.png', 'favicon-16.png', 'favicon-180.png',
  'logo_transparent.png',
];

// HTML files to minify
const HTML_FILES = [
  'index.html', 'pricing.html', 'account.html',
  'terms.html', 'privacy.html', '404.html',
];

// API JS files to minify
const API_FILES = [
  'api/analyse.js', 'api/knowmore.js',
  'api/delete-account.js',
];

// Root JS files to minify
const JS_FILES = [
  'create-checkout.js', 'stripe-webhook.js', 'cancel-subscription.js',
];

async function build() {
  // Create dist dirs
  mkdirSync(DIST, { recursive: true });
  mkdirSync(join(DIST, 'api'), { recursive: true });

  // Copy static assets
  for (const f of COPY_AS_IS) {
    try {
      copyFileSync(join(SRC, f), join(DIST, f));
      console.log(`✓ copied  ${f}`);
    } catch(e) { /* file may not exist */ }
  }

  // Copy vercel.json (update output dir)
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

  // Minify API JS files
  for (const f of API_FILES) {
    try {
      const src = readFileSync(join(SRC, f), 'utf8');
      const result = await minifyJs(src, JS_OPTS);
      writeFileSync(join(DIST, f), result.code);
      const savings = (((src.length - result.code.length) / src.length) * 100).toFixed(0);
      console.log(`✓ minified ${f} — ${savings}% smaller`);
    } catch(e) { console.error(`✗ ${f}:`, e.message); }
  }

  // Minify root JS files
  for (const f of JS_FILES) {
    try {
      const src = readFileSync(join(SRC, f), 'utf8');
      const result = await minifyJs(src, JS_OPTS);
      writeFileSync(join(DIST, f), result.code);
      const savings = (((src.length - result.code.length) / src.length) * 100).toFixed(0);
      console.log(`✓ minified ${f} — ${savings}% smaller`);
    } catch(e) { console.error(`✗ ${f}:`, e.message); }
  }

  console.log('\n✅ Build complete → dist/');
}

build().catch(console.error);
