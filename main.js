/**
 * The entry point: work out where the data should come from, fetch it, hand
 * it to the dashboard, and then keep it moving.
 *
 * Two ways to open the page:
 *
 *   (nothing)            the saved copy in `data/snapshot`, no engine needed.
 *                        This is the default: it loads on every browser, and
 *                        the same dashboard runs from it.
 *   ?source=duckdb       query a Parquet file in the browser through DuckDB
 *                        WASM, driven by the grid's duckdbAdapter. This is the
 *                        engine showcase; when the WASM bundle cannot be
 *                        loaded, or the Parquet file cannot be read, the page
 *                        opens the saved copy instead and says so at the top,
 *                        rather than showing an error.
 *
 * This is the script-tag edition. The grid and its modules arrived as classic
 * `<script src>` tags from jsDelivr, ahead of this file, and left globals
 * behind: `LatticeGrid` (the core, which the charts module extends),
 * `LatticeGridDataRouter`, `LatticeGridKPI` and `LatticeGridTabs`. This file
 * picks the factories off those globals and hands them to the dashboard, which
 * never touches a global itself.
 */
(function (root) {
  'use strict';

  const TITLE = 'Yellow taxi trips across New York City, minute by minute';

  /**
   * The DuckDB WASM build the live path loads. The package's own browser
   * bundle imports `apache-arrow` by its bare module name, which a classic
   * script cannot resolve, so it is loaded from esm.sh as a single bundle with
   * that dependency inlined. The wasm and worker files still come from
   * jsDelivr, through the package's own `getJsDelivrBundles()`.
   */
  const DUCKDB_VERSION = '1.32.0';
  const DUCKDB_BROWSER_URL = `https://esm.sh/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/es2022/duckdb-wasm.bundle.mjs`;

  const host = document.querySelector('#app');
  const params = new URLSearchParams(location.search);
  const wanted = params.get('source');
  const mode = wanted === 'duckdb' ? 'duckdb' : 'snapshot';

  /** Draw the waiting state, and return a function that updates its message. */
  function showProgress(first) {
    host.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'loading';
    const title = document.createElement('h1');
    title.textContent = TITLE;
    const message = document.createElement('p');
    message.className = 'loading-message';
    message.textContent = first;
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    const fill = document.createElement('div');
    fill.className = 'loading-fill';
    bar.append(fill);
    panel.append(title, message, bar);
    host.append(panel);
    return (text, fraction) => {
      message.textContent = text;
      fill.style.width = `${Math.round((fraction || 0) * 100)}%`;
    };
  }

  /** Say what went wrong, in words a reader can act on. */
  function showError(error) {
    host.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'loading';
    const title = document.createElement('h1');
    title.textContent = 'The taxi trip data could not be loaded';
    const message = document.createElement('p');
    message.className = 'loading-message';
    message.textContent = String((error && error.message) || error);
    const hint = document.createElement('p');
    hint.className = 'loading-message';
    hint.textContent = 'You can open the same dashboard from the saved copy by adding ?source=snapshot to the address.';
    panel.append(title, message, hint);
    host.append(panel);
    console.error('[nyc tlc demo]', error);
  }

  /**
   * The grid's factories, read off the globals the script tags left behind.
   *
   * Checked by name rather than assumed, so a script tag that did not load,
   * or loaded in the wrong order, is reported as the sentence it is rather
   * than as "undefined is not a function" somewhere inside the dashboard.
   *
   * @returns {object} the factories and `setLicence`
   */
  function libraryFromGlobals() {
    const missing = [];
    const need = (object, name, what) => {
      const value = object && object[name];
      if (typeof value !== 'function') missing.push(what);
      return value;
    };
    const createGrid = need(root.LatticeGrid, 'createGrid', 'lattice-grid.min.js (LatticeGrid.createGrid)');
    const createHeadlessGrid = need(root.LatticeGrid, 'createHeadlessGrid', 'lattice-grid.min.js (LatticeGrid.createHeadlessGrid)');
    const setLicence = need(root.LatticeGrid, 'setLicence', 'lattice-grid.min.js (LatticeGrid.setLicence)');
    /* The charts module extends the core global rather than defining its own,
       so it has to be loaded after the core; this is where that shows. */
    const createChart = need(root.LatticeGrid, 'createChart', 'modules/charts.min.js (LatticeGrid.createChart)');
    const createDataRouter = need(root.LatticeGridDataRouter, 'createDataRouter', 'modules/data-router.min.js (LatticeGridDataRouter.createDataRouter)');
    const createKPI = need(root.LatticeGridKPI, 'createKPI', 'modules/kpi.min.js (LatticeGridKPI.createKPI)');
    const createTabs = need(root.LatticeGridTabs, 'createTabs', 'modules/tabs.min.js (LatticeGridTabs.createTabs)');
    /* The headline tiles, the pushdown source and the DuckDB adapter all live
       on the core global alongside createGrid. */
    const createStat = need(root.LatticeGrid, 'createStat', 'lattice-grid.min.js (LatticeGrid.createStat)');
    const createPushdownSource = need(root.LatticeGrid, 'createPushdownSource', 'lattice-grid.min.js (LatticeGrid.createPushdownSource)');
    const duckdbAdapter = need(root.LatticeGrid, 'duckdbAdapter', 'lattice-grid.min.js (LatticeGrid.duckdbAdapter)');
    if (missing.length) {
      throw new Error(
        `The grid did not load from the CDN. Missing: ${missing.join('; ')}. ` +
          'Check that the script tags in index.html are reachable and in order, with the core first.',
      );
    }
    return { createGrid, createHeadlessGrid, setLicence, createChart, createDataRouter, createKPI, createTabs, createStat, createPushdownSource, duckdbAdapter };
  }

  /**
   * Start DuckDB WASM in the browser and register the Parquet slice, returning
   * a grid source that queries it through the duckdbAdapter.
   *
   * The WASM bundle is imported from esm.sh as an ES module (a classic script
   * may `import()` an ESM file without the page itself being one), and the
   * Parquet bytes are fetched and registered into DuckDB's virtual file
   * system, so `read_parquet` reads them locally with no HTTP range server
   * needed.
   *
   * @returns {Promise<object>} the grid source config
   */
  async function buildDuckDBSource({ createPushdownSource, duckdbAdapter, update }) {
    update('Loading DuckDB WASM...', 0.1);
    const duckdb = await import(DUCKDB_BROWSER_URL);

    update('Starting the in-browser database...', 0.3);
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }),
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();

    update('Reading the Parquet slice...', 0.6);
    const response = await fetch(root.NycTlc.PARQUET_URL);
    if (!response.ok) throw new Error(`The Parquet slice answered ${response.status}.`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    await db.registerFileBuffer('trips.parquet', buffer);

    update('Building the dashboard...', 0.9);
    return {
      source: createPushdownSource({
        adapter: duckdbAdapter({
          connection: conn,
          from: "read_parquet('trips.parquet')",
        }),
        fullDataset: { enabled: true, maxRows: 500000 },
      }),
      duckdb,
      db,
      conn,
    };
  }

  async function start() {
    const started = performance.now();
    try {
      const { createGrid, createHeadlessGrid, setLicence, createChart, createDataRouter, createKPI, createTabs, createStat, createPushdownSource, duckdbAdapter } = libraryFromGlobals();
      const { buildDashboard, readSnapshot, PARQUET_URL } = root.NycTlc;

      /* Applied before anything is drawn, because a grid that already exists
         keeps whatever licence was in force when it was built. */
      setLicence(DEMO_LICENCE);

      let rows;
      let meta;
      let source = null;
      let duck = null;

      if (mode === 'snapshot') {
        const update = showProgress('Reading the saved copy...');
        const saved = await readSnapshot();
        meta = saved.meta;
        rows = saved.rows;
        update('Building the dashboard...', 1);
      } else {
        const update = showProgress('Starting DuckDB in the browser...');
        try {
          duck = await buildDuckDBSource({ createPushdownSource, duckdbAdapter, update });
          source = duck.source;
          meta = {
            live: true,
            engine: 'duckdb-wasm',
            fetchedAt: Date.now(),
          };
        } catch (liveError) {
          /* DuckDB is out of our hands - a CDN that will not load the WASM, or
             a Parquet slice that will not read - so a bad day for it should not
             be a blank page here. The saved copy shows the same dashboard, and
             the masthead says plainly that is what you are looking at. */
          console.warn('[nyc tlc demo] the live DuckDB path failed, falling back to the saved copy:', liveError);
          update('The live data could not be read. Opening the saved copy...', 1);
          const saved = await readSnapshot();
          rows = saved.rows;
          meta = { ...saved.meta, live: false, fellBack: true };
        }
      }

      const fetched = performance.now();

      const built = buildDashboard({
        root: host,
        createGrid,
        createHeadlessGrid,
        createChart,
        createStat,
        createTabs,
        createDataRouter,
        rows,
        source,
        meta,
      });

      /* The Parquet is read once into the browser; there is nothing to poll,
         and no poll is started after a fallback either. */
      built.poller = null;

      const finished = performance.now();
      const timings = {
        mode,
        fellBack: !!meta.fellBack,
        engine: meta.engine || 'memory',
        rows: built.detailGrid ? built.detailGrid.rows.totalCount() : 0,
        loaded: rows ? rows.length : null,
        fetchMs: Math.round(fetched - started),
        buildMs: Math.round(finished - fetched),
        totalMs: Math.round(finished - started),
      };

      root.__nycTlc = Object.assign(built, { meta, timings, duck, ready: true });
      console.log('[nyc tlc demo] ready', timings);
    } catch (error) {
      root.__nycTlc = { ready: false, error: String((error && error.message) || error) };
      showError(error);
    }
  }

  start();
})(window);
