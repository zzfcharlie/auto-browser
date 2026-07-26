// auto-browser Site Adapters
// Inspired by bb-browser's bb-sites pattern.
// Each adapter runs inside your browser's JS context and fetches data
// with your real cookies/auth — no API keys needed.

export { loadBuiltInAdapters, listAdapters, runAdapter, evalInPage, fetchAsPage } from './loader.mjs';
