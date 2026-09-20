# Yellow taxi trips across New York City, minute by minute

A dashboard of NYC Taxi & Limousine Commission trip records, sliced from the
public Parquet with DuckDB, built on Lattice Grid loaded by `<script>` tag: no
npm install, no bundler, no build step, no `type="module"`.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-nyc-tlc-umd/)**

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |

It is one stream of trips with several views on it: a table for the individual
journeys, a strip of headline figures, four distribution charts, and four
summary tabs that are each their own grid. They all read the same stream, so
narrowing the table moves everything else with it.

The point of the demo is scale. A single month of yellow taxi trips is about
three million rows and fifty megabytes of Parquet, which no repository should
carry, so the page works on two paths: a saved copy (plain JSON, a
deterministic sample of one week), and a live engine (DuckDB WASM running in
the browser, driving SQL pushdown over the same Parquet through the grid's
`duckdbAdapter`). The two present the same dashboard from the same data.

## How the grid gets onto the page

Six tags in `index.html`, and that is the whole of the library setup:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.css">

<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/charts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/data-router.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/kpi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/tabs.min.js"></script>
```

Each file is the package's UMD build (`*.min.js`, beside the `*.esm.min.js`
the ESM edition imports) and leaves a global behind:

| File | Global | Used here for |
| --- | --- | --- |
| `lattice-grid.min.js` | `LatticeGrid` | `createGrid`, `setLicence`, `createStat`, `createPushdownSource`, `duckdbAdapter` |
| `modules/charts.min.js` | extends `LatticeGrid` | `LatticeGrid.createChart` |
| `modules/data-router.min.js` | `LatticeGridDataRouter` | `createDataRouter` |
| `modules/kpi.min.js` | `LatticeGridKPI` | `createKPI` |
| `modules/tabs.min.js` | `LatticeGridTabs` | `createTabs` |

The charts module folds its exports into the core global rather than defining
one of its own, so its tag must come after the core's. The other three are
self-contained and can go in any order. `main.js` checks that every factory it
needs is actually there before it draws anything, so a tag that did not load
is reported as a sentence rather than as an error from inside the grid.

Every address names the exact release, `1.66.0`, and every tag carries the
`integrity` hash of the file it expects. The page cannot quietly pick up a
different build than the one it was checked against, and the browser refuses
a file that does not match. The hashes are the SHA-384 of the published files.

The demo's own code is four classic scripts, loaded in order after the
library: `src/licence.js`, `src/nyc-feed.js`, `src/dashboard.js`, `main.js`.
Each file wraps itself in a function and puts what it offers on one plain
object, `NycTlc`, for the next file to read. `src/dashboard.js` is handed the
grid's factories as arguments and never touches a global itself.

## Running it

You need nothing but a browser and a way to serve the folder, because the
page fetches its data with `fetch()` and browsers will not do that from
`file://`. Any static server will do; one is included:

```
node tools/serve.mjs
```

That prints an address. Open it.

| Address | What you get |
| --- | --- |
| `/` | the saved copy in `data/snapshot`, no engine needed |
| `/?source=duckdb` | DuckDB WASM querying the Parquet slice in the browser |
| `/?source=snapshot` | the same saved copy, asked for by name |

Running a copy on your own machine needs no licence key. Publishing it on a
web address does.

## What it shows

**One stream, several views.** The data router is the hub: every view, from
the detail table to the summary tabs, reads the same trips through it. A
revised trip lands on the row it belongs to rather than adding a second one,
because the router keys on the trip id.

**A table that reads like a trip record.** The pickup is a two-line cell (time
over day and date), the payment method and trip type are pills with a colour
each, the fare and tip carry in-cell data bars, and the fare column carries
conditional-formatting rules the grid holds as runtime state, so a reader can
open the Formatting panel and change them. The rank, percentile and share
columns are shadow columns the grid computes rather than fields in the data.

**Figures that follow the table.** The strip of tiles is bound to the detail
grid, so it reads whatever the table currently matches: trips, total fares,
average fare, median fare and average tip. The average fare also carries a
confidence interval from `grid.statistics.interval`.

**Distributions, not just a table.** Four charts draw straight from the table's
own rows: trips by hour of day, a histogram of the fares, the average fare by
payment type, and trips by day of week. Filter the table and every chart
follows.

**Summaries that are grids in their own right.** The four tabs are derived
grids whose rows come from the detail grid: trips grouped by pickup zone
(the top twenty), by day of week, and by hour, plus a statistical profile of
the fare column (min, quartiles, median, mean, standard deviation, outliers).

**An engine behind the table.** Open `?source=duckdb` and the same grid is fed
by DuckDB WASM reading the Parquet slice, with the filtering and grouping
pushed down into SQL through `createPushdownSource` and `duckdbAdapter`.

**A feed that can fail.** If the WASM bundle will not load, or the Parquet
slice will not read, the page shows the saved copy instead and says so under
the title.

## The data

Everything comes from the NYC Taxi & Limousine Commission trip record data:

- <https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page>

The page reads the public Parquet on S3/CloudFront, which needs no key:

- `https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet`

Numeric location IDs are turned into zone names with the TLC's own lookup:

- `https://d37ci6vzurychx.cloudfront.net/misc/taxi+_zone_lookup.csv`

The trip records are published by the TLC for public use. A few things worth
knowing about the data:

- One month is about three million rows and fifty megabytes. The saved copy is
  a deterministic sample: the week of 8-14 January 2024, taking every
  twenty-fifth trip in pickup order, so every day, hour and zone keeps its
  real proportions while the file stays a few megabytes.
- Payment type is a code: 1 is card, 2 is cash, and the rest (no charge,
  dispute, unknown, voided trip) are named individually on the page. The
  reversals are where the negative fares are: a disputed, voided or refunded
  trip is recorded by the TLC as a negative amount, and those rows are kept
  rather than filtered out.
- The trip type is the TLC rate code: Standard, JFK airport, Newark,
  Nassau/Westchester, Negotiated fare and Group ride.
- A few trips carry a negative fare. These are adjustments and voided trips the
  TLC publishes as-is; the page does not clean them up, which is why the fare
  histogram starts below zero.
- A small number of very long airport trips push the mean fare well above the
  median, which is why the page reports both.

## Files

```
index.html                page shell, and the six library tags
main.js                   works out where the data comes from, then starts
src/licence.js            the key for this demo's own published address
src/nyc-feed.js           the trip shape: labels, the snapshot codec, the saved copy
src/dashboard.js          the views: router, table, tiles, charts, tabs
styles.css                the page around the grid
tools/serve.mjs           a small static file server
tools/build-snapshot.mjs  slice the Parquet under Node, write data/ and the Parquet
tools/verify.mjs          open it in a real browser and check it
data/snapshot/            the saved copy, so the demo works without the engine
data/trips.parquet        the Parquet slice the DuckDB path reads
```

There is no `package.json` and no `node_modules`. The tools need Node 22 or
newer and nothing else.

The saved copy is a compact array of arrays, one value per column in the order
`meta.json` documents, so the sample stays a manageable download. The browser
unpacks it with the same code that produced it, so the saved copy and the
Parquet present identical rows.

## Building the saved copy

```
node tools/build-snapshot.mjs
```

It fetches the DuckDB WASM runtime into the operating system's temp directory
once, then uses DuckDB under Node to read the month of trip data, slice one
week, and take a deterministic sample. The sample is written twice: to
`data/snapshot/` as compact JSON, and to `data/trips.parquet` for the
browser-side engine. Re-run it to refresh the copy.

## Checking it

```
node tools/verify.mjs          # open the page in a real browser and assert
node tools/verify.mjs --all    # also open the live DuckDB path
```

`tools/verify.mjs` is not a smoke test. It first insists on how the library
arrived: no `type="module"` script anywhere on the page, the library tags
pointing at the pinned release on the CDN, each with an integrity hash, and
each leaving the global it documents. It then recomputes the headline figures
from the saved data and compares them with what the page is showing, narrows
to card payments and insists the tiles and charts moved with it, groups by
pickup zone and pivots the payment across the hour, checks the derived
summaries against the saved data, pushes a trip through and insists the row
count moved, and finally blocks DuckDB in the browser and insists the saved
copy appears with a notice saying why. The GitHub Pages workflow runs it before
every publish.

## Licence

The demo code is MIT. See `LICENSE`.

The trip records are from the NYC Taxi & Limousine Commission, published for
public use.

Lattice Grid itself is a separate commercial product with its own terms. It is
free to use on localhost, with no key and no watermark, so a copy of this
repository runs unrestricted on your own machine. This demo carries a key for
its own published address only, which is why you will find one in the source.
Keys for your own sites come from [latticegrid.dev](https://www.latticegrid.dev).

---
Built with [Lattice Grid](https://www.latticegrid.dev), a JavaScript data grid with a Data Router: one live feed keeps grids, charts, boards, Gantt and KPI tiles in step. [Documentation](https://www.latticegrid.dev/docs/) · [Demos](https://www.latticegrid.dev/demos/) · [Licence](https://www.latticegrid.dev/licence/)
