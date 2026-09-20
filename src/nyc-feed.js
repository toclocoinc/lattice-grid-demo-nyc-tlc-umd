/**
 * NYC Taxi & Limousine Commission trip records: the column shape the dashboard
 * reads, the payment and rate-code labels, and the compact array form the saved
 * copy stores.
 *
 * Nothing here knows about the grid. It produces plain objects and hands them
 * to whoever asked, so the same code feeds the live page and the saved copy.
 *
 * The source is a public Parquet file on S3/CloudFront, no key needed. A single
 * month of yellow taxi trips is about three million rows and fifty megabytes,
 * which is far too big to ship in a repository, so the snapshot tool uses
 * DuckDB under Node to slice a bounded, deterministic sample of one week and
 * stores that here. In the browser the live path reads the same slice through
 * DuckDB WASM and the grid's duckdbAdapter, driving SQL pushdown; the saved
 * copy is plain JSON so the dashboard also runs with no engine at all.
 *
 * This is a classic script, not a module: there is no `import` or `export`
 * anywhere on this page. What this file offers is put on `NycTlc`, a plain
 * object on the global, and the next script reads it from there. The snapshot
 * tool runs this same file under Node, which is why it looks for `globalThis`
 * rather than `window`.
 */
(function (root) {
  'use strict';

  /** The month the saved copy is drawn from. One Parquet, ~3M rows, no key. */
  const MONTHLY_PARQUET_URL =
    'https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet';

  /** The taxi-zone lookup used to turn numeric LocationIDs into zone names. */
  const ZONES_CSV_URL = 'https://d37ci6vzurychx.cloudfront.net/misc/taxi+_zone_lookup.csv';

  /** The slice of the month the browser-side DuckDB query reads. */
  const PARQUET_URL = './data/trips.parquet';

  /** How many rows the snapshot tool aims to save. The month is millions of
      rows; this many, spread evenly across a week, keep every view meaningful
      while the saved copy stays a few megabytes. */
  const TARGET_ROWS = 28000;

  /** The payment-type codes the TLC uses and their short labels. */
  const PAYMENT_TYPES = {
    1: 'Card',
    2: 'Cash',
    3: 'No charge',
    4: 'Dispute',
    5: 'Unknown',
    6: 'Voided trip',
  };

  /** The rate-code (trip type) values and their long names. */
  const RATE_CODES = {
    1: 'Standard',
    2: 'JFK airport',
    3: 'Newark',
    4: 'Nassau/Westchester',
    5: 'Negotiated fare',
    6: 'Group ride',
    99: 'Other',
  };

  /**
   * The order the snapshot stores its fields in, so a compact array can be
   * decoded back into a row. Shared by the browser and the snapshot tool.
   *
   * `count` is deliberately absent: it is always 1, and `decodeRow` restores
   * it, so it is not stored. The Parquet slice does carry it, because the
   * DuckDB path reads columns directly and cannot rebuild a field.
   */
  const SNAPSHOT_COLUMNS = [
    'id',
    'pickupTime',
    'date',
    'dayName',
    'dayOfWeek',
    'hour',
    'pickupZone',
    'dropoffZone',
    'paymentLabel',
    'tripType',
    'passengers',
    'distance',
    'fare',
    'tip',
    'total',
  ];

  /**
   * Pack a row into the compact array form the snapshot stores.
   *
   * @param {object} row a flat trip row
   * @returns {Array} one value per {@link SNAPSHOT_COLUMNS}
   */
  function encodeRow(row) {
    return SNAPSHOT_COLUMNS.map((col) => row[col]);
  }

  /**
   * Unpack a compact snapshot array back into a row, restoring the field that
   * is not stored.
   *
   * @param {Array} values one value per {@link SNAPSHOT_COLUMNS}
   * @returns {object} a flat trip row
   */
  function decodeRow(values) {
    const row = {};
    SNAPSHOT_COLUMNS.forEach((col, index) => {
      row[col] = values[index];
    });
    /* Always 1. It is what the charts and the group subtotals add up. */
    row.count = 1;
    return row;
  }

  /** Read the saved copy that ships with the demo.
   *
   * The copy is loaded twice over: once as a classic `<script>` in `index.html`
   * (`data/snapshot/snapshot.js`, which leaves `NYC_TLC_SNAPSHOT` on the
   * global), so the dashboard also runs when the page is opened straight from
   * disk with no server; and again here, as a `fetch`, for any host that
   * prefers it. The inline copy wins when present.
   */
  async function readSnapshot() {
    const inline = root.NYC_TLC_SNAPSHOT;
    if (inline && Array.isArray(inline.rows)) {
      return { rows: inline.rows.map(decodeRow), meta: { ...inline.meta, live: false } };
    }
    const [values, meta] = await Promise.all(
      ['trips', 'meta'].map(async (name) => {
        const response = await fetch(`./data/snapshot/${name}.json`);
        if (!response.ok) throw new Error(`The saved copy is missing ${name}.json.`);
        return response.json();
      }),
    );
    return { rows: values.map(decodeRow), meta: { ...meta, live: false } };
  }

  root.NycTlc = Object.assign(root.NycTlc || {}, {
    MONTHLY_PARQUET_URL,
    ZONES_CSV_URL,
    PARQUET_URL,
    TARGET_ROWS,
    PAYMENT_TYPES,
    RATE_CODES,
    SNAPSHOT_COLUMNS,
    encodeRow,
    decodeRow,
    readSnapshot,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
