/**
 * One-off catalog rebuild with the hardened buildCatalog (page retries +
 * shrink guard). Writes server/cache/moviebox_cache.json, then exits.
 */
const { fetchMovieBoxCatalog } = require('./moviebox');

(async () => {
  const catalog = await fetchMovieBoxCatalog(true);
  const count = catalog && Array.isArray(catalog.movies) ? catalog.movies.length : 0;
  console.log(`REBUILT_CATALOG_COUNT=${count}`);
  process.exit(count > 0 ? 0 : 1);
})().catch((e) => {
  console.error('REBUILD_FAILED:', e.message);
  process.exit(1);
});
