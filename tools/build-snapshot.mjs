/**
 * Save a real slice of the NYC Taxi & Limousine Commission trip records to
 * `data/snapshot/`, and write a Parquet slice beside it, so the dashboard can
 * be opened either from the saved copy (`?source=snapshot`) or by querying the
 * Parquet in the browser through DuckDB WASM (`?source=duckdb`).
 *
 * Run it with `node tools/build-snapshot.mjs`. It is a development tool:
 * nothing the page loads imports it.
 *
 * The source is a public Parquet file on S3/CloudFront, no key needed. One
 * month is about three million rows and fifty megabytes, far too big to ship,
 * so this tool uses DuckDB - running under Node through its WASM build - to
 * read the month, slice one week, and take a deterministic, evenly-spread
 * sample of it. The sample is written twice: as compact JSON for the saved
 * copy, and as a Parquet file for the browser-side engine.
 *
 * The feed code the page uses is a classic script, not a module, so it cannot
 * be imported. It is run here instead, in this process, exactly as the browser
 * runs it: the file leaves its functions on `globalThis.NycTlc` and they are
 * read from there. One copy of the feed code, used by both.
 *
 * The DuckDB WASM runtime is fetched into the operating system's temp
 * directory on first use (and cached there), so no build dependency beyond
 * Node itself is needed to keep the saved copy fresh.
 */

import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInThisContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data', 'snapshot');
const dataDir = join(here, '..', 'data');

const feedFile = join(here, '..', 'src', 'nyc-feed.js');
runInThisContext(await readFile(feedFile, 'utf8'), { filename: feedFile });
const { encodeRow, SNAPSHOT_COLUMNS, MONTHLY_PARQUET_URL, ZONES_CSV_URL, TARGET_ROWS } = globalThis.NycTlc;

/** The week the saved copy is drawn from (end is exclusive). */
const SLICE_START = '2024-01-08';
const SLICE_END = '2024-01-15';

const DUCKDB_VERSION = '1.32.0';

/**
 * The DuckDB WASM runtime, installed into the temp directory on first use and
 * cached there, so a rebuild is offline. The blocking Node build runs in
 * process with no worker, and reads and writes Parquet directly.
 */
async function loadDuckDB() {
  const cache = join(tmpdir(), `duckdb-wasm-${DUCKDB_VERSION}-node-runtime`);
  const marker = join(cache, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist', 'duckdb-node-blocking.cjs');
  if (!existsSync(marker)) {
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'package.json'), JSON.stringify({ name: 'duckdb-wasm-runtime', private: true }));
    console.log('  installing the DuckDB WASM runtime (once)...');
    const result = spawnSync(
      'npm',
      ['install', '--prefix', cache, `@duckdb/duckdb-wasm@${DUCKDB_VERSION}`, '--no-save', '--no-audit', '--no-fund', '--loglevel=error'],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('the DuckDB WASM runtime could not be installed');
  }
  const require = createRequire(pathToFileURL(join(cache, 'package.json')).href);
  const duckdb = require('@duckdb/duckdb-wasm/blocking');
  const wasmPath = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm');
  return { duckdb, wasmPath };
}

/** Fetch a URL, retrying a moment later when the service has a wobble. */
async function fetchBytes(url, { maxAttempts = 4 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${url} answered ${response.status}.`);
  }
}

const started = Date.now();

console.log('Starting DuckDB under Node...');
const { duckdb, wasmPath } = await loadDuckDB();
const db = await duckdb.createDuckDB(
  { mvp: { mainModule: wasmPath, mainWorker: null } },
  new duckdb.VoidLogger(),
  duckdb.NODE_RUNTIME,
);
await db.instantiate();
const conn = db.connect();

console.log('Reading the month of trip data...');
const monthBytes = await fetchBytes(MONTHLY_PARQUET_URL);
db.registerFileBuffer('month.parquet', monthBytes);

console.log('Reading the taxi-zone lookup...');
const zonesText = await fetchBytes(ZONES_CSV_URL);
db.registerFileText('zones.csv', new TextDecoder().decode(zonesText));

const monthCount = conn.query(
  `SELECT count(*) n FROM read_parquet('month.parquet') WHERE tpep_pickup_datetime >= '${SLICE_START}' AND tpep_pickup_datetime < '${SLICE_END}'`,
);
const weekRows = Number(monthCount.toArray()[0].n);
const sampleEvery = Math.max(1, Math.ceil(weekRows / TARGET_ROWS));
console.log(`  ${weekRows.toLocaleString('en-GB')} trips in the week; keeping every ${sampleEvery}th (about ${Math.round(weekRows / sampleEvery).toLocaleString('en-GB')} rows).`);

console.log('Slicing the week...');
conn.query(`
CREATE TABLE slice AS
WITH w AS (
  SELECT *, row_number() OVER (ORDER BY tpep_pickup_datetime, PULocationID, DOLocationID, fare_amount) AS rn
  FROM read_parquet('month.parquet')
  WHERE tpep_pickup_datetime >= '${SLICE_START}' AND tpep_pickup_datetime < '${SLICE_END}'
)
SELECT
  CAST(t.rn AS INTEGER) AS id,
  strftime(t.tpep_pickup_datetime, '%H:%M') AS pickupTime,
  strftime(t.tpep_pickup_datetime, '%Y-%m-%d') AS date,
  dayname(t.tpep_pickup_datetime) AS dayName,
  CAST(isodow(t.tpep_pickup_datetime) AS INTEGER) AS dayOfWeek,
  CAST(hour(t.tpep_pickup_datetime) AS INTEGER) AS hour,
  COALESCE(pu.Zone, 'Zone ' || CAST(t.PULocationID AS VARCHAR)) AS pickupZone,
  COALESCE(dz.Zone, 'Zone ' || CAST(t.DOLocationID AS VARCHAR)) AS dropoffZone,
  CASE t.payment_type WHEN 1 THEN 'Card' WHEN 2 THEN 'Cash' ELSE 'Other' END AS paymentLabel,
  CASE t.RatecodeID WHEN 1 THEN 'Standard' WHEN 2 THEN 'JFK airport' WHEN 3 THEN 'Newark'
    WHEN 4 THEN 'Nassau/Westchester' WHEN 5 THEN 'Negotiated fare' WHEN 6 THEN 'Group ride' ELSE 'Other' END AS tripType,
  CAST(t.passenger_count AS INTEGER) AS passengers,
  t.trip_distance AS distance,
  t.fare_amount AS fare,
  t.tip_amount AS tip,
  t.total_amount AS total,
  1 AS count
FROM w t
LEFT JOIN read_csv_auto('zones.csv', header=true) pu ON CAST(pu.LocationID AS INTEGER) = t.PULocationID
LEFT JOIN read_csv_auto('zones.csv', header=true) dz ON CAST(dz.LocationID AS INTEGER) = t.DOLocationID
WHERE t.rn % ${sampleEvery} = 0
`);

const rowObjects = conn.query('SELECT * FROM slice ORDER BY id').toArray().map((r) => r.toJSON());
const values = rowObjects.map(encodeRow);

/* ---------------- the Parquet slice ---------------- */

/* DuckDB's Node runtime writes COPY output to the real filesystem, so the
   file is written under the operating system's temp directory rather than the
   project root, then read back out. */
const scratch = await mkdtemp(join(tmpdir(), 'nyc-tlc-slice-'));
const scratchParquet = join(scratch, 'trips.parquet');
conn.query(`COPY slice TO '${scratchParquet}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
const parquetBuffer = db.copyFileToBuffer(scratchParquet);
await mkdir(dataDir, { recursive: true });
await writeFile(join(dataDir, 'trips.parquet'), Buffer.from(parquetBuffer));

/* ---------------- the saved copy ---------------- */

const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

const meta = {
  fetchedAt: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  seconds,
  rows: values.length,
  sampleEvery,
  monthRows: weekRows,
  sliceStart: SLICE_START,
  sliceEnd: SLICE_END,
  source: 'NYC Taxi & Limousine Commission yellow taxi trip records (one week, deterministically sampled)',
  sourceUrl: 'https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page',
  apiUrl: MONTHLY_PARQUET_URL,
  licence: 'TLC trip record data, published for public use',
  columns: SNAPSHOT_COLUMNS,
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'trips.json'), JSON.stringify(values));
await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
/* An inline copy, loaded by a classic <script> in index.html, so the saved
   copy also works when the page is opened straight from disk with no server. */
await writeFile(join(outDir, 'snapshot.js'), `window.NYC_TLC_SNAPSHOT = ${JSON.stringify({ rows: values, meta })};`);

const tripsBytes = (await stat(join(outDir, 'trips.json'))).size;
const parquetBytes = (await stat(join(dataDir, 'trips.parquet'))).size;
console.log(`\nSaved ${values.length.toLocaleString('en-GB')} trips in ${seconds}s.`);
console.log(`trips.parquet is ${(parquetBytes / 1024 / 1024).toFixed(1)} MB.`);
console.log(`trips.json is ${(tripsBytes / 1024 / 1024).toFixed(1)} MB.`);
