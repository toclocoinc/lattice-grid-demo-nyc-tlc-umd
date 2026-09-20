/**
 * The dashboard: one stream of taxi trips, and every view built on top of it.
 *
 * The detail grid is the hub. Nothing here fetches anything and nothing here
 * reaches for the grid's globals: every factory is handed in, so this file is
 * the same whether the library arrived by script tag, as it does here, or by
 * import, as it does in the ESM edition of this demo.
 *
 * How the pieces fit together:
 *
 *   the trips  ->  the router  ->  the detail grid  ->  the headline tiles
 *                                  ->  derived grids        the four charts
 *                                  ->  the statistics
 *
 * The detail grid holds the individual trips. The tiles and the charts read it,
 * and the four summary tabs (by pickup zone, by day of week, by hour, and a
 * statistical profile of the fare) are derived grids that read it too, so a
 * filter or a grouping moves every view together.
 *
 * A classic script: it reads the constants from `NycTlc`, put there by
 * `nyc-feed.js`, and adds `buildDashboard` alongside them.
 */
(function (root) {
  'use strict';

  const { PAYMENT_TYPES, RATE_CODES } = root.NycTlc;

  /** Make an element with a class and optional text, the long way round. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** One number, written the way a reader expects to see it. */
  function commas(value) {
    return Number(value || 0).toLocaleString('en-GB');
  }

  /** A share (0..1) as a percentage with one decimal. */
  function percent(value) {
    if (value == null || Number.isNaN(value)) return '';
    return (value * 100).toFixed(1) + '%';
  }

  /** A clock time, local to whoever is reading. */
  function clockText(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** The 95th percentile of a numeric array, for a data bar's ceiling. */
  function p95Of(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((sorted.length - 1) * 0.95);
    return sorted[index] || 0;
  }

  function medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* ------------------------------------------------------------------ */
  /* The detail grid                                                     */
  /* ------------------------------------------------------------------ */

  /** The colours each payment method is rendered with, pill and tint alike. */
  const PAYMENT_VARIANTS = {
    Card: 'success',
    Cash: 'neutral',
    'No charge': 'warning',
    Dispute: 'danger',
    Unknown: 'neutral',
    'Voided trip': 'neutral',
  };

  const PAYMENT_TINTS = {
    Card: '#e7f4ea',
    Cash: '#eef1f4',
    'No charge': '#fdf3e3',
    Dispute: '#fdeaea',
    Unknown: '#eef1f4',
    'Voided trip': '#eef1f4',
  };

  /** The colours each trip type (rate code) is rendered with. */
  const TRIP_VARIANTS = {
    Standard: 'neutral',
    'JFK airport': 'info',
    Newark: 'info',
    'Nassau/Westchester': 'warning',
    'Negotiated fare': 'accent',
    'Group ride': 'success',
    Other: 'neutral',
  };

  /**
   * The trip columns, grouped under four headings.
   *
   * The pickup is a two-line cell (time over day and date), the payment method
   * and trip type are pills with a variant each, the fare and tip carry
   * in-cell data bars and runtime formatting rules, and the rank/percentile/
   * share columns are shadow columns the grid computes rather than fields in
   * the data.
   *
   * @param {number} fareMax the fare data bar's ceiling
   * @param {number} tipMax the tip data bar's ceiling
   * @returns {object[]} the column definitions
   */
  function tripColumns(fareMax, tipMax) {
    return [
      {
        title: 'The trip',
        columns: [
          {
            id: 'when',
            field: 'pickupTime',
            title: 'Picked up',
            cell: { render: 'twoline', props: { secondary: (p) => (p && p.data ? `${p.data.dayName}, ${p.data.date}` : '') } },
            filter: { type: 'text' },
            layout: { width: 190 },
          },
          {
            id: 'date',
            field: 'date',
            title: 'Date',
            type: 'date',
            filter: { type: 'date' },
            layout: { width: 110 },
          },
          {
            id: 'passengers',
            field: 'passengers',
            title: 'Passengers',
            type: 'number',
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'number' },
            layout: { width: 100 },
          },
          {
            id: 'distance',
            field: 'distance',
            title: 'Distance (mi)',
            type: 'number',
            format: { decimals: 1 },
            filter: { type: 'number' },
            layout: { width: 110 },
          },
        ],
      },
      {
        title: 'Where',
        columns: [
          {
            id: 'pickupZone',
            field: 'pickupZone',
            title: 'Pickup zone',
            filter: { type: 'set' },
            layout: { width: 180 },
          },
          {
            id: 'dropoffZone',
            field: 'dropoffZone',
            title: 'Dropoff zone',
            filter: { type: 'set' },
            layout: { width: 180 },
          },
        ],
      },
      {
        title: 'The fare',
        columns: [
          {
            id: 'paymentLabel',
            field: 'paymentLabel',
            title: 'Payment',
            cell: { decoration: 'pill', variant: { map: PAYMENT_VARIANTS, default: 'neutral' } },
            filter: { type: 'set' },
            layout: { width: 120 },
          },
          {
            id: 'tripType',
            field: 'tripType',
            title: 'Trip type',
            cell: { decoration: 'pill', variant: { map: TRIP_VARIANTS, default: 'neutral' } },
            filter: { type: 'set' },
            layout: { width: 160 },
          },
          {
            id: 'fare',
            field: 'fare',
            title: 'Fare',
            type: 'number',
            format: 'currency:USD:2',
            cell: { decoration: { type: 'bar', min: 0, max: fareMax } },
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'number' },
            layout: { width: 120 },
          },
          {
            id: 'tip',
            field: 'tip',
            title: 'Tip',
            type: 'number',
            format: 'currency:USD:2',
            cell: { decoration: { type: 'bar', min: 0, max: tipMax } },
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'number' },
            layout: { width: 120 },
          },
          {
            id: 'total',
            field: 'total',
            title: 'Total',
            type: 'number',
            format: 'currency:USD:2',
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'number' },
            layout: { width: 120 },
          },
          {
            id: 'count',
            field: 'count',
            title: 'Trips',
            type: 'number',
            total: 'sum',
            groupTotal: 'sum',
            filter: { type: 'none' },
            layout: { width: 80, hidden: true },
          },
        ],
      },
      {
        title: 'Where it ranks',
        columns: [
          {
            id: 'rank',
            field: 'fare',
            shadow: { kind: 'rank' },
            title: 'Fare rank',
            type: 'number',
            layout: { width: 100 },
          },
          {
            id: 'percentile',
            field: 'fare',
            shadow: { kind: 'percentile' },
            title: 'Percentile',
            type: 'number',
            format: percent,
            layout: { width: 100 },
          },
          {
            id: 'share',
            field: 'fare',
            shadow: { kind: 'shareOfTotal' },
            title: 'Share of fares',
            type: 'number',
            format: percent,
            layout: { width: 110 },
          },
        ],
      },
    ];
  }

  /**
   * The conditional-formatting rules the grid holds as runtime state, so a
   * reader can open the Formatting panel and change them.
   *
   * Payment carries a soft tint per method; fare carries the money rules.
   *
   * @returns {object} rules keyed by column id
   */
  function formattingRules() {
    const paymentRules = Object.keys(PAYMENT_TINTS).map((label) => ({
      id: `payment-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      label,
      when: { op: 'eq', value: label },
      style: { background: PAYMENT_TINTS[label] },
    }));
    return {
      paymentLabel: paymentRules,
      fare: [
        {
          id: 'fare-cheap',
          label: 'Under $5',
          when: { op: 'lt', value: 5 },
          style: { background: '#eaf3fb', color: '#174a7c' },
        },
        {
          id: 'fare-long',
          label: 'A hundred dollars or more',
          when: { op: 'gte', value: 100 },
          style: { background: '#fdf3d8', color: '#7a4b00', fontWeight: '700' },
        },
      ],
    };
  }

  /** The shared settings the detail grid and the derived grids use. */
  function baseGridConfig(title) {
    return {
      rowKey: 'id',
      formatting: formattingRules(),
      theme: 'light',
      density: 'comfortable',
      stripedRows: true,
      columnMenu: true,
      groupPanel: true,
      statusBar: true,
      find: true,
      grandTotalRow: 'bottom',
      groupDefaultExpanded: 0,
      pivot: { groupTotals: 'after' },
      toolPanel: { side: 'right', panels: ['filters', 'columns', 'formatting'] },
      selection: 'multiple',
      title,
    };
  }

  /* ------------------------------------------------------------------ */
  /* The derived grids                                                   */
  /* ------------------------------------------------------------------ */

  /** A money column in dollars, shared by the grouped summaries. */
  function moneyColumn(id, title, width) {
    return { id, field: id, title, type: 'number', format: 'currency:USD:2', layout: { width: width || 120 } };
  }

  /** The select kernels the zone and day summaries share. */
  function richSelect() {
    return {
      trips: { fn: 'count' },
      totalFare: { of: 'fare', fn: 'sum' },
      avgFare: { of: 'fare', fn: 'avg' },
      avgTip: { of: 'tip', fn: 'avg' },
    };
  }

  /**
   * The four derived tabs, each a grid whose rows come from the detail grid.
   *
   * @param {object} detailGrid the trips grid
   * @returns {object[]} tab descriptors for `createTabs`
   */
  function derivedTabs(detailGrid) {
    return [
      {
        id: 'zones',
        label: 'By pickup zone',
        badge: true,
        config: {
          ...baseGridConfig('Trips grouped by pickup zone'),
          columns: [
            { id: 'pickupZone', field: 'pickupZone', title: 'Pickup zone', layout: { width: 220 } },
            { id: 'trips', field: 'trips', title: 'Trips', type: 'number', total: 'sum', layout: { width: 90 } },
            moneyColumn('totalFare', 'Total fares', 130),
            moneyColumn('avgFare', 'Average fare', 120),
            moneyColumn('avgTip', 'Average tip', 120),
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'pickupZone',
            select: richSelect(),
            sort: [{ col: 'totalFare', dir: 'desc' }],
            limit: 20,
            crossFilter: true,
          },
        },
      },
      {
        id: 'weekday',
        label: 'By day of week',
        badge: true,
        config: {
          ...baseGridConfig('Trips grouped by day of week'),
          columns: [
            { id: 'dayName', field: 'dayName', title: 'Day', layout: { width: 140 } },
            { id: 'trips', field: 'trips', title: 'Trips', type: 'number', total: 'sum', layout: { width: 90 } },
            moneyColumn('totalFare', 'Total fares', 130),
            moneyColumn('avgFare', 'Average fare', 120),
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'dayName',
            select: {
              trips: { fn: 'count' },
              totalFare: { of: 'fare', fn: 'sum' },
              avgFare: { of: 'fare', fn: 'avg' },
            },
            sort: [{ col: 'trips', dir: 'desc' }],
          },
        },
      },
      {
        id: 'hour',
        label: 'By hour',
        badge: true,
        config: {
          ...baseGridConfig('Trips grouped by hour of day'),
          columns: [
            { id: 'hour', field: 'hour', title: 'Hour', type: 'number', layout: { width: 80 } },
            { id: 'trips', field: 'trips', title: 'Trips', type: 'number', total: 'sum', layout: { width: 90 } },
            moneyColumn('totalFare', 'Total fares', 130),
            moneyColumn('avgFare', 'Average fare', 120),
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            groupBy: 'hour',
            select: {
              trips: { fn: 'count' },
              totalFare: { of: 'fare', fn: 'sum' },
              avgFare: { of: 'fare', fn: 'avg' },
            },
            sort: [{ col: 'hour', dir: 'asc' }],
          },
        },
      },
      {
        id: 'profile',
        label: 'Fare profile',
        badge: false,
        config: {
          ...baseGridConfig('The statistical profile of the fare column'),
          columns: [
            { id: 'column', field: 'column', title: 'Column', layout: { width: 120 } },
            { id: 'rows', field: 'rows', title: 'Rows', type: 'number', layout: { width: 100 } },
            { id: 'present', field: 'present', title: 'Present', type: 'number', layout: { width: 90 } },
            { id: 'missing', field: 'missing', title: 'Missing', type: 'number', layout: { width: 90 } },
            { id: 'distinct', field: 'distinct', title: 'Distinct', type: 'number', layout: { width: 90 } },
            moneyColumn('min', 'Min', 110),
            moneyColumn('q1', 'Q1', 110),
            moneyColumn('median', 'Median', 110),
            moneyColumn('mean', 'Mean', 110),
            moneyColumn('q3', 'Q3', 110),
            moneyColumn('max', 'Max', 110),
            moneyColumn('stddev', 'Std dev', 110),
            { id: 'iqr', field: 'iqr', title: 'IQR', type: 'number', format: 'currency:USD:2', layout: { width: 110 } },
            { id: 'outliers', field: 'outliers', title: 'Outliers', type: 'number', layout: { width: 90 } },
          ],
          source: {
            mode: 'derived',
            from: detailGrid,
            profile: ['fare'],
          },
        },
      },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* The dashboard                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Build the whole page into `host`.
   *
   * @param {object} options
   * @param {HTMLElement} options.root where the dashboard is drawn
   * @param {Function} options.createGrid the grid factory
   * @param {Function} options.createHeadlessGrid the headless grid factory, for tab badges
   * @param {Function} options.createChart the charts module's factory
   * @param {Function} options.createStat the core's headline-tile factory
   * @param {Function} options.createTabs the tabs module's factory
   * @param {Function} options.createDataRouter the data router module's factory
   * @param {object[]} [options.rows] the trips to start with (snapshot path)
   * @param {object} [options.source] a source config instead of rows (DuckDB path)
   * @param {object} options.meta where the data came from, and when
   * @returns {object} the pieces that were built, for a caller that wants them
   */
  function buildDashboard({
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
  }) {
    host.textContent = '';

    const built = {
      detailGrid: null,
      router: null,
      tiles: {},
      charts: [],
      tabs: null,
      status: { lastPoll: null, lastError: null, polls: 0, revisions: 0, arrivals: 0, dropped: 0 },
    };

    /* ---------------- the masthead ---------------- */

    const header = el('header', 'head');
    const heading = el('div', 'head-text');
    heading.append(el('h1', null, 'Yellow taxi trips across New York City, minute by minute'));
    heading.append(
      el(
        'p',
        'lede',
        'A slice of the Taxi & Limousine Commission trip records, with the fares drawn live. Group the trips, ' +
          'pivot them, or narrow them by zone and payment, and the headline figures, the charts and the summaries ' +
          'all follow.',
      ),
    );
    if (meta.fellBack) {
      heading.append(
        el(
          'p',
          'notice',
          'The live data could not be read, so this is the saved copy. Reloading the page will try again.',
        ),
      );
    }
    header.append(heading);

    const provenance = el('div', 'head-note');
    const modePill = el('span', 'pill', meta.live ? 'Live' : 'Saved copy');
    const liveDot = el('span', 'dot');
    if (meta.live) modePill.prepend(liveDot);
    const freshness = el('span', 'freshness', 'Waiting for the first update...');
    provenance.append(modePill, freshness);
    header.append(provenance);
    host.append(header);

    /* ---------------- the headline tiles ---------------- */

    const kpiHost = el('section', 'kpi-strip');
    kpiHost.setAttribute('aria-label', 'Headline figures');
    const tileBoxes = {};
    for (const id of ['trips', 'totalFare', 'avgFare', 'medianFare', 'avgTip']) {
      const box = el('div', 'kpi-tile');
      box.setAttribute('data-tile', id);
      kpiHost.append(box);
      tileBoxes[id] = box;
    }
    host.append(kpiHost);

    /* ---------------- the charts ---------------- */

    const chartHost = el('section', 'chart-wrap');
    chartHost.setAttribute('aria-label', 'Charts');
    const chartBoxes = [];
    for (let i = 0; i < 4; i += 1) {
      const box = el('div', 'chart-box');
      chartHost.append(box);
      chartBoxes.push(box);
    }
    host.append(chartHost);

    /* ---------------- the controls ---------------- */

    const actions = el('div', 'actions');
    host.append(actions);

    /* ---------------- the detail grid ---------------- */

    const primary = el('section', 'primary-host');
    host.append(primary);

    const fareMax = rows && rows.length ? Math.max(5, p95Of(rows.map((r) => r.fare))) : 50;
    const tipMax = rows && rows.length ? Math.max(5, p95Of(rows.map((r) => r.tip))) : 20;

    const detailConfig = {
      ...baseGridConfig('Taxi trips published by the NYC Taxi & Limousine Commission'),
      columns: tripColumns(fareMax, tipMax),
      /* The same grid can be drawn as a pivot: group the rows down the left
         gutter and pivot the payment across the top, and it becomes a matrix of
         summed fares and counts. It stays an ordinary table until a pivot
         dimension is set. */
      pivotView: true,
    };
    if (source) detailConfig.source = source;
    else detailConfig.rows = rows;

    const detailGrid = createGrid(primary, detailConfig);
    built.detailGrid = detailGrid;

    /* ---------------- the summary tabs ---------------- */

    const tabsHost = el('section', 'tabs-host');
    host.append(tabsHost);
    const tabs = createTabs(tabsHost, {
      createGrid,
      createHeadlessGrid,
      ariaLabel: 'Trip summaries',
      tabs: derivedTabs(detailGrid),
    });
    built.tabs = tabs;

    /* ---------------- the router ---------------- */

    /*
     * One stream in, one grid out. A revised trip that has already arrived
     * lands on the row it belongs to rather than adding a second one, because
     * the router keys on the trip id.
     */
    const router = createDataRouter({
      key: () => 'trips',
      rowKey: 'id',
      overlap: false,
    });
    built.router = router;

    router.attach(detailGrid, () => true);

    router.subscribe(() => true, (change) => {
      built.status.arrivals += (change.add || []).length;
      built.status.revisions += (change.update || []).length;
    });

    const ingest = (incoming) => {
      if (!incoming || !incoming.length) return 0;
      router.apply(incoming.map((row) => ({ op: 'upsert', row })));
      built.status.dropped = router.dropped || 0;
      return incoming.length;
    };

    if (rows) router.load(rows);

    /* ---------------- the headline tiles, bound to the detail grid ---------------- */

    const overallFare = rows && rows.length ? rows.reduce((sum, r) => sum + r.fare, 0) : null;

    const addTile = (id, spec) => {
      try {
        built.tiles[id] = createStat({ grid: detailGrid, container: tileBoxes[id], ...spec });
      } catch (error) {
        tileBoxes[id].append(el('div', 'kpi-error', `This figure could not be drawn: ${error.message}`));
        console.error('[nyc tlc demo] tile', id, error);
      }
    };

    addTile('trips', { title: 'Trips', value: { fn: 'count' } });
    addTile('totalFare', {
      title: 'Total fares',
      value: { of: 'fare', fn: 'sum' },
      bands: overallFare ? { good: overallFare, warn: overallFare * 0.5, direction: 'up' } : undefined,
    });
    addTile('avgFare', {
      title: 'Average fare',
      value: { of: 'fare', fn: 'avg' },
      interval: (v, g) => g.statistics.interval('fare'),
    });
    addTile('medianFare', { title: 'Median fare', value: { of: 'fare', fn: 'median' } });
    addTile('avgTip', { title: 'Average tip', value: { of: 'tip', fn: 'avg' } });

    /* On the DuckDB path the source materialises its whole dataset
       asynchronously, after the tiles have already reduced over the first
       window of rows. Refresh them once the full set has arrived, so they read
       the whole table rather than the window. The derived grids and charts
       follow the grid's rows on their own. */
    if (source) {
      const refreshTiles = () => {
        for (const id of Object.keys(built.tiles)) built.tiles[id].refresh();
      };
      const reloadDerived = () => {
        for (const id of ['zones', 'weekday', 'hour', 'profile']) {
          const grid = tabs.tab(id);
          if (grid && grid.rows && grid.rows.load) grid.rows.load();
        }
      };
      const settle = () => {
        refreshTiles();
        reloadDerived();
      };
      detailGrid.on('rows:changed', settle);
      detailGrid.on('model:changed', settle);
      detailGrid.on('ready', settle);
      tabs.on('tab:changed', () => {
        const grid = tabs.tab(tabs.activeId);
        if (grid && grid.rows && grid.rows.load) grid.rows.load();
      });
    }

    /* ---------------- the charts, bound to the detail grid ---------------- */

    const chartSpecs = [
      {
        type: 'bar',
        x: 'hour',
        y: 'count',
        title: 'Trips by hour of day',
        axis: { x: { labels: true }, y: 'Trips' },
        legend: false,
      },
      {
        type: 'histogram',
        y: 'fare',
        buckets: 28,
        title: 'What fares were charged',
        axis: { x: 'Fare', y: 'Trips' },
        legend: false,
      },
      {
        type: 'bar',
        x: 'paymentLabel',
        y: { col: 'fare', fn: 'avg' },
        title: 'Average fare by payment type',
        axis: { x: { labels: true }, y: 'Average fare' },
        legend: false,
      },
      {
        type: 'bar',
        x: 'dayName',
        y: 'count',
        title: 'Trips by day of week',
        axis: { x: { labels: true, rotate: 'auto' }, y: 'Trips' },
        legend: false,
      },
    ];

    chartSpecs.forEach((spec, index) => {
      try {
        built.charts.push(createChart({ grid: detailGrid, container: chartBoxes[index], ...spec }));
      } catch (error) {
        chartBoxes[index].append(el('p', 'chart-error', `This chart could not be drawn: ${error.message}`));
        console.error('[nyc tlc demo] chart', spec.type, error);
      }
    });

    /* ---------------- the controls ---------------- */

    const button = (label, onClick, className) => {
      const node = el('button', className || 'action', label);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    };

    const group = (ids) => () => {
      if (detailGrid) detailGrid.columns.group(ids);
    };

    actions.append(el('span', 'actions-label', 'Group by'));
    actions.append(button('Pickup zone', group(['pickupZone'])));
    actions.append(button('Day', group(['dayName'])));
    actions.append(button('Hour', group(['hour'])));
    actions.append(button('No grouping', group([])));

    actions.append(el('span', 'actions-gap'));
    actions.append(el('span', 'actions-label', 'Pivot'));
    actions.append(
      button('Payment across the hour', () => {
        detailGrid.columns.group(['hour']);
        detailGrid.columns.pivot(['paymentLabel']);
      }),
    );
    actions.append(
      button('Trip type across the zone', () => {
        detailGrid.columns.group(['pickupZone']);
        detailGrid.columns.pivot(['tripType']);
      }),
    );
    actions.append(
      button('No pivot', () => {
        detailGrid.columns.pivot([]);
        detailGrid.columns.group([]);
      }),
    );

    actions.append(el('span', 'actions-gap'));
    actions.append(el('span', 'actions-label', 'Sort by'));
    actions.append(button('Fare, highest', () => detailGrid && detailGrid.sort.set([{ col: 'fare', dir: 'desc' }])));
    actions.append(button('Most recent', () => detailGrid && detailGrid.sort.set([{ col: 'id', dir: 'desc' }])));

    const cardButton = button('Card only', () => {
      const on = cardButton.getAttribute('aria-pressed') === 'true';
      detailGrid.filters.where('card', on ? null : (row) => row.paymentLabel === 'Card');
      cardButton.setAttribute('aria-pressed', String(!on));
      cardButton.classList.toggle('on', !on);
    }, 'action toggle');
    cardButton.setAttribute('aria-pressed', 'false');

    const airportButton = button('Airport trips only', () => {
      const on = airportButton.getAttribute('aria-pressed') === 'true';
      detailGrid.filters.where('airport', on ? null : (row) => /airport|Newark/i.test(row.tripType));
      airportButton.setAttribute('aria-pressed', String(!on));
      airportButton.classList.toggle('on', !on);
    }, 'action toggle');
    airportButton.setAttribute('aria-pressed', 'false');

    actions.append(el('span', 'actions-gap'));
    actions.append(cardButton);
    actions.append(airportButton);
    built.cardButton = cardButton;
    built.airportButton = airportButton;

    /* ---------------- the live readout ---------------- */

    const setFreshness = (state) => {
      if (!meta.live) {
        const saved = new Date(meta.fetchedAt).toLocaleString('en-GB');
        freshness.textContent = `A saved copy of the trip data, taken on ${saved}.`;
        freshness.className = 'freshness';
        return;
      }
      if (built.status.lastError) {
        freshness.textContent = built.status.lastPoll
          ? `Could not reach the data. Still showing what arrived at ${clockText(built.status.lastPoll)}.`
          : 'Could not reach the data.';
        freshness.className = 'freshness failed';
        return;
      }
      if (!built.status.lastPoll) {
        freshness.textContent = 'Waiting for the first update...';
        freshness.className = 'freshness';
        return;
      }
      freshness.textContent =
        `Updated ${clockText(built.status.lastPoll)}. ` +
        `${commas(built.status.arrivals)} new, ${commas(built.status.revisions)} revised since the page opened.`;
      freshness.className = 'freshness';
    };
    built.setFreshness = setFreshness;

    built.onPoll = (result) => {
      built.status.lastPoll = result.fetchedAt || Date.now();
      built.status.lastError = null;
      built.status.polls += 1;
      liveDot.classList.add('beat');
      setTimeout(() => liveDot.classList.remove('beat'), 900);
      ingest(result.rows);
      setFreshness();
    };

    built.onPollError = (error) => {
      built.status.lastError = String((error && error.message) || error);
      setFreshness();
      console.warn('[nyc tlc demo] a poll failed:', built.status.lastError);
    };

    /* A hook for the verification script and for anyone poking at the page:
       push rows through exactly the path a poll uses. */
    built.ingest = ingest;

    setFreshness();

    /* ---------------- the footer ---------------- */

    const footer = el('footer', 'foot');
    const line = el('p', null, 'Trip data from the ');
    const link = el('a', null, 'NYC Taxi & Limousine Commission');
    link.href = 'https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page';
    link.rel = 'noopener';
    line.append(link);
    line.append(
      document.createTextNode(
        '. Yellow taxi trip records, one month of which is about three million rows; this page holds a ' +
          'deterministic sample of one week, sliced from the public Parquet with DuckDB. Payment types are Card, ' +
          'Cash, No charge, Dispute, Unknown and Voided trip; the trip type is the TLC rate code (Standard, the two ' +
          'airports, Nassau/Westchester, Negotiated and Group ride). A few very long airport trips push the mean ' +
          'fare well above the median, which is why the page reports both.',
      ),
    );
    footer.append(line);
    host.append(footer);

    built.destroy = () => {
      for (const chart of built.charts) chart.destroy();
      for (const id of Object.keys(built.tiles)) built.tiles[id].destroy();
      router.destroy();
      tabs.destroy();
      detailGrid.destroy();
    };

    return built;
  }

  root.NycTlc.buildDashboard = buildDashboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
