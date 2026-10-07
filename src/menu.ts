import type { Attribution, Route, SourceInfo, VehicleMode } from '../shared/types';

/** How the camera follows a vehicle that has been clicked. */
export type TrackingMode = 'free' | 'top-back' | 'top-front' | 'helicopter';

export const TRACKING_MODES: { id: TrackingMode; name: string }[] = [
  // Keeps the vehicle centred and leaves the angle alone.
  { id: 'free', name: 'Free' },
  // Above and behind the vehicle, facing the way it is going.
  { id: 'top-back', name: 'Top-back' },
  // Above and ahead of the vehicle, looking back at it.
  { id: 'top-front', name: 'Top-front' },
  // Circling in the air around the vehicle.
  { id: 'helicopter', name: 'Helicopter' },
];

export interface MenuOptions {
  sources: SourceInfo[];
  lightMode: boolean;
  onLightMode(on: boolean): void;
  /** Called when the user pauses or resumes live updates and animation. */
  onPaused(paused: boolean): void;
  trackingMode: TrackingMode;
  onTrackingMode(mode: TrackingMode): void;
  // Each group of sources (an agency, such as "TTC") has a section in the
  // Data tab with these three switches. Everything starts switched on.
  onGroupVisible(group: string, visible: boolean): void;
  onGroupRouteLines(group: string, shown: boolean): void;
  onGroupStops(group: string, shown: boolean): void;
  onRoutesVisible(sourceId: string, routeIds: string[], visible: boolean): void;
  /**
   * Called as lines are picked out, by typing in the search box or pointing
   * at a row: the ids of a source's lines to pick out on the map, or
   * undefined once nothing is being picked out.
   */
  onLinesHighlighted(sourceId: string, routeIds: Set<string> | undefined): void;
}

export interface Menu {
  /** The part of the screen the menu covers, for popups to keep clear of. */
  occupied(): DOMRect;
  /** How many pixels of the screen's left side the menu covers right now, including mid-slide. */
  coveredWidth(): number;
  setStatus(sourceId: string, text: string, warning: boolean): void;
  /** Lists a source's routes under its group once they have loaded. */
  setRoutes(sourceId: string, routes: Route[]): void;
}

// Data sources that are planned but not built, so the Data tab shows what is
// missing as well as what is there.
const PLANNED_SECTIONS = [{ name: 'Bike Share Toronto', kind: 'bikes', note: 'Not connected yet.' }];

// Where the About tab sends people who want to get in touch.
const CONTACT_EMAIL = 'kian.benner@gmail.com';

// The width of the coloured bars on the menu's outer edge (`--spine` in style.css).
const SPINE_PX = 16;

// The order lines are listed in, and the heading over each kind.
const LINE_GROUPS: { mode: VehicleMode; heading: string }[] = [
  { mode: 'subway', heading: 'Subway' },
  { mode: 'lrt', heading: 'Light rail' },
  { mode: 'train', heading: 'Train' },
  { mode: 'streetcar', heading: 'Streetcar' },
  { mode: 'bus', heading: 'Bus' },
  { mode: 'other', heading: 'Other' },
];

// Rapid transit lines have their own colours; other routes take their mode's
// colour, which main.ts publishes as a CSS variable for the current theme.
const hasOwnColor = (mode: VehicleMode) => mode === 'subway' || mode === 'lrt' || mode === 'train';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
}

function checkbox(label: string | Node, checked: boolean, onChange: (checked: boolean) => void) {
  const input = element('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const row = element('label', 'check');
  row.append(input, label);
  return { row, input };
}

function link({ text, url }: Attribution): HTMLElement {
  if (!url) return element('span', undefined, text);
  const anchor = element('a', undefined, text);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  return anchor;
}

interface LineRow {
  sourceId: string;
  route: Route;
  row: HTMLElement;
  toggle: HTMLButtonElement;
  /** Whether the line is drawn on the map. */
  shown: boolean;
}

/**
 * Whether a line matches what was typed. Each typed word must be the line's
 * whole number or the start of a word in its name, so "5" finds line 5 alone
 * and not 501 or 95, and "king" finds King and Kingston Rd but not Parking.
 */
export function matchesLine(route: Pick<Route, 'shortName' | 'longName'>, typed: string): boolean {
  const number = route.shortName.toLowerCase();
  const nameWords = route.longName.toLowerCase().split(/[^a-z0-9]+/);
  return typed
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => word === number || nameWords.some((nameWord) => nameWord.startsWith(word)));
}

/**
 * A round switch in a line's colour: solid while the line is shown on the
 * map and faint while it is hidden.
 */
function colorSwitch(color: string, onClick: () => void): HTMLButtonElement {
  const button = element('button', 'dot');
  button.setAttribute('role', 'switch');
  button.style.setProperty('--dot', color);
  button.addEventListener('click', onClick);
  return button;
}

/** The list of lines in one data section, as a dropdown per kind, with its search box. */
function createLineList({
  onRoutesVisible,
  onLinesHighlighted,
}: Pick<MenuOptions, 'onRoutesVisible' | 'onLinesHighlighted'>) {
  const rows: LineRow[] = [];
  const headings = new Map<
    VehicleMode,
    { row: HTMLElement; toggle: HTMLButtonElement; expander: HTMLButtonElement; count: HTMLElement; group: HTMLElement }
  >();
  // The kinds whose dropdown the user has opened. All start closed: there are
  // over two hundred bus lines.
  const expanded = new Set<VehicleMode>();
  // The row the pointer is on, whose lines are picked out on the map.
  let pointedAt: LineRow[] | undefined;

  const container = element('div', 'lines');
  const search = element('input', 'line-filter');
  search.type = 'search';
  search.placeholder = 'Find a line by number or name';
  search.setAttribute('aria-label', 'Find a line');
  const showAll = element('button', 'text-button', 'Show all');
  const hideAll = element('button', 'text-button', 'Hide all');
  const actions = element('div', 'line-actions');
  actions.append(showAll, hideAll);
  const list = element('div', 'line-list');
  const empty = element('div', 'note', 'Loading lines…');
  container.append(search, actions, list, empty);

  const listed = (mode?: VehicleMode) => rows.filter((row) => !row.row.hidden && (!mode || row.route.mode === mode));

  /** Brings every switch in line with which lines are shown. */
  const updateSwitches = () => {
    for (const { route, toggle, shown } of rows) {
      toggle.setAttribute('aria-checked', String(shown));
      toggle.setAttribute('aria-label', `Show ${route.shortName} ${route.longName} on the map`);
    }
    for (const [mode, heading] of headings) {
      const group = rows.filter((row) => row.route.mode === mode);
      const shown = group.filter((row) => row.shown).length;
      // A kind with only some of its lines shown is drawn in between.
      heading.toggle.setAttribute('aria-checked', shown === 0 ? 'false' : shown === group.length ? 'true' : 'mixed');
    }
  };

  /** Shows or hides lines, and tells the map which ones changed. */
  const setShown = (lines: LineRow[], shown: boolean) => {
    const changed = new Map<string, string[]>();
    for (const line of lines) {
      if (line.shown === shown) continue;
      line.shown = shown;
      changed.set(line.sourceId, [...(changed.get(line.sourceId) ?? []), line.route.id]);
    }
    for (const [sourceId, routeIds] of changed) onRoutesVisible(sourceId, routeIds, shown);
    updateSwitches();
  };
  showAll.addEventListener('click', () => setShown(listed(), true));
  hideAll.addEventListener('click', () => setShown(listed(), false));

  /**
   * Tells the map which lines to pick out: the row being pointed at, or
   * failing that whatever the search matches, or nothing in particular.
   */
  const updateHighlight = () => {
    const chosen = pointedAt ?? (search.value.trim() === '' ? undefined : listed());
    const bySource = new Map<string, Set<string>>(rows.map((row) => [row.sourceId, new Set()]));
    for (const row of chosen ?? []) bySource.get(row.sourceId)!.add(row.route.id);
    for (const [sourceId, routeIds] of bySource) onLinesHighlighted(sourceId, chosen ? routeIds : undefined);
  };

  /** Picks out a row's lines on the map while the pointer or keyboard focus is on it. */
  const highlightWhilePointedAt = (row: HTMLElement, lines: () => LineRow[]) => {
    const enter = () => {
      pointedAt = lines();
      updateHighlight();
    };
    const leave = () => {
      pointedAt = undefined;
      updateHighlight();
    };
    row.addEventListener('mouseenter', enter);
    row.addEventListener('mouseleave', leave);
    row.addEventListener('focusin', enter);
    row.addEventListener('focusout', leave);
  };

  /** Lists only the lines that match the search, and opens the dropdowns they are in. */
  const applySearch = () => {
    const searching = search.value.trim() !== '';
    for (const { route, row } of rows) row.hidden = !matchesLine(route, search.value);
    for (const [mode, heading] of headings) {
      const count = listed(mode).length;
      // A kind is only worth listing if it has a line to show, and a search
      // would be pointless if its matches stayed folded away.
      heading.row.hidden = count === 0;
      const open = count > 0 && (searching || expanded.has(mode));
      heading.group.hidden = !open;
      heading.expander.setAttribute('aria-expanded', String(open));
      heading.count.textContent = String(count);
    }
    empty.textContent = rows.length === 0 ? 'Loading lines…' : 'No lines match.';
    empty.hidden = listed().length > 0;
    updateHighlight();
  };
  search.addEventListener('input', applySearch);

  const render = () => {
    list.replaceChildren();
    headings.clear();
    for (const { mode, heading } of LINE_GROUPS) {
      const group = rows
        .filter(({ route }) => route.mode === mode)
        .sort((a, b) => a.route.shortName.localeCompare(b.route.shortName, undefined, { numeric: true }));
      if (group.length === 0) continue;

      // The heading's switch turns the listed lines of its kind on or off together.
      const row = element('div', 'line line-heading');
      const toggle = colorSwitch(`var(--mode-${mode})`, () => {
        const lines = listed(mode);
        setShown(lines, !lines.every((line) => line.shown));
      });
      toggle.setAttribute('aria-label', `Show all ${heading.toLowerCase()} lines on the map`);
      // The rest of the heading opens and closes the dropdown of its lines.
      const expander = element('button', 'expander');
      const count = element('span', 'count');
      expander.append(element('span', 'line-name', heading), count, element('span', 'chevron', '›'));
      expander.addEventListener('click', () => {
        if (expanded.has(mode)) expanded.delete(mode);
        else expanded.add(mode);
        applySearch();
      });
      row.append(toggle, expander);
      highlightWhilePointedAt(row, () => listed(mode));
      const lines = element('div', 'line-group');
      lines.append(...group.map((line) => line.row));
      headings.set(mode, { row, toggle, expander, count, group: lines });
      list.append(row, lines);
    }
    applySearch();
    updateSwitches();
  };

  return {
    container,
    add(sourceId: string, routes: Route[]) {
      for (const route of routes) {
        const row = element('div', 'line');
        const color = hasOwnColor(route.mode) ? route.color : `var(--mode-${route.mode})`;
        // New lines start out shown, which is also what the map assumes.
        const toggle = colorSwitch(color, () => setShown([line], !line.shown));
        const line: LineRow = { sourceId, route, row, toggle, shown: true };
        row.append(line.toggle, element('span', 'line-name', `${route.shortName} ${route.longName}`));
        highlightWhilePointedAt(row, () => [line]);
        rows.push(line);
      }
      render();
    },
  };
}

export function createMenu(options: MenuOptions): Menu {
  // The flyout slides in from the left edge. Its pull tab is attached to its
  // outer edge, so the tab is all that shows while the menu is closed and it
  // rides along as the menu opens.
  const flyout = element('aside', 'flyout');
  flyout.setAttribute('aria-label', 'Menu');
  const content = element('div', 'flyout-content');
  content.inert = true;
  const pullTab = element('button', 'pull-tab');
  pullTab.append(element('span', 'pull-tab-label', 'Menu'), element('span', 'pull-tab-arrow', '›'));

  const setOpen = (open: boolean) => {
    flyout.classList.toggle('open', open);
    // Keeps the closed menu out of the tab order and away from screen readers.
    content.inert = !open;
    pullTab.setAttribute('aria-expanded', String(open));
    pullTab.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  setOpen(false);
  pullTab.addEventListener('click', () => setOpen(!flyout.classList.contains('open')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && flyout.classList.contains('open')) {
      setOpen(false);
      pullTab.focus();
    }
  });

  // Tabs
  const tabList = element('div', 'tabs');
  tabList.setAttribute('role', 'tablist');
  const body = element('div', 'flyout-body');
  const tabs: { button: HTMLButtonElement; panel: HTMLElement }[] = [];
  const select = (index: number) => {
    tabs.forEach(({ button, panel }, at) => {
      button.setAttribute('aria-selected', String(at === index));
      panel.hidden = at !== index;
    });
  };
  const addTab = (name: string): HTMLElement => {
    const index = tabs.length;
    const button = element('button', 'tab', name);
    button.setAttribute('role', 'tab');
    const panel = element('div', 'tab-panel');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', name);
    button.addEventListener('click', () => select(index));
    tabs.push({ button, panel });
    tabList.append(button);
    body.append(panel);
    return panel;
  };

  // Appearance
  const appearance = addTab('Appearance');
  // Unticking Live pauses the map: nothing is fetched and vehicles stay
  // put, for a slow machine or a metered connection.
  const live = checkbox('Live', true, (checked) => options.onPaused(!checked));
  live.row.title = 'Live updates and vehicle movement. Untick to pause them and lighten the load.';
  appearance.append(checkbox('Light mode', options.lightMode, options.onLightMode).row, live.row);

  // Tracking options: how the camera follows a clicked vehicle.
  const tracking = element('div', 'option-group');
  tracking.setAttribute('role', 'radiogroup');
  tracking.setAttribute('aria-label', 'Tracking');
  for (const mode of TRACKING_MODES) {
    const input = element('input');
    input.type = 'radio';
    input.name = 'tracking-mode';
    input.value = mode.id;
    input.checked = mode.id === options.trackingMode;
    input.addEventListener('change', () => {
      if (input.checked) options.onTrackingMode(mode.id);
    });
    const row = element('label', 'check option');
    row.append(input, element('span', 'option-name', mode.name));
    tracking.append(row);
  }
  appearance.append(
    element('h2', undefined, 'Tracking'),
    element('p', 'note plain', 'How the camera follows a vehicle after you click it.'),
    tracking,
  );

  // Data: one section per group of sources, then the planned ones
  const data = addTab('Data');
  const statuses = new Map<string, HTMLElement>();
  const lineLists = new Map<string, ReturnType<typeof createLineList>>();

  /** A collapsible section. Extra controls go beside its name, outside the button that folds it. */
  const addSection = (name: string, open: boolean, ...beside: HTMLElement[]) => {
    const section = element('div', 'section');
    const expander = element('button', 'expander section-name');
    expander.append(element('span', undefined, name), element('span', 'chevron', '›'));
    const header = element('div', 'section-header');
    header.append(expander, ...beside);
    const content = element('div', 'section-body');
    const setOpen = (state: boolean) => {
      content.hidden = !state;
      expander.setAttribute('aria-expanded', String(state));
    };
    expander.addEventListener('click', () => setOpen(content.hidden !== false));
    setOpen(open);
    section.append(header, content);
    data.append(section);
    return content;
  };

  const groups = [...new Set(options.sources.map((source) => source.group))];
  groups.forEach((group, index) => {
    // Shows or hides everything from this group at once.
    const visible = checkbox('', true, (checked) => options.onGroupVisible(group, checked));
    visible.input.setAttribute('aria-label', `Show ${group} on the map`);
    visible.row.title = `Show ${group} on the map`;
    const section = addSection(group, index === 0, visible.row);
    // A section for one kind of thing can be styled to match that thing's markers.
    const kinds = new Set(options.sources.filter((source) => source.group === group).map((source) => source.kind));
    if (kinds.size === 1) section.parentElement!.dataset.kind = [...kinds][0];

    for (const source of options.sources.filter((candidate) => candidate.group === group)) {
      const status = element('span', 'status', 'Loading…');
      statuses.set(source.id, status);
      const block = element('div', 'source');
      block.append(element('span', 'source-name', source.name), status);
      section.append(block);
    }

    const lines = createLineList(options);
    for (const source of options.sources) {
      if (source.group === group && source.hasRoutes) lineLists.set(source.id, lines);
    }
    if ([...lineLists.values()].includes(lines)) {
      section.append(
        checkbox('Show route lines', true, (checked) => options.onGroupRouteLines(group, checked)).row,
        checkbox('Show stops', true, (checked) => options.onGroupStops(group, checked)).row,
        element('h2', undefined, 'Lines'),
        lines.container,
      );
    }
  });
  for (const planned of PLANNED_SECTIONS) {
    const section = addSection(planned.name, false, element('span', 'badge', 'Planned'));
    section.append(element('p', 'note', planned.note));
    section.parentElement!.dataset.kind = planned.kind;
  }

  // About
  const about = addTab('About');
  const inspiration = element('p');
  inspiration.append(
    'A live map of Toronto transit, inspired by ',
    link({ text: 'Mini Tokyo 3D', url: 'https://github.com/nagix/mini-tokyo-3d' }),
    '.',
  );
  // The name as a logo: three blocks, read in order as "Mini Toronto 3D".
  const logo = element('h1', 'logo');
  logo.append(
    element('span', 'logo-mini', 'Mini'),
    ' ',
    element('span', 'logo-toronto', 'Toronto'),
    ' ',
    element('span', 'logo-3d', '3D'),
  );
  about.append(
    logo,
    inspiration,
    element(
      'p',
      undefined,
      'TTC buses and streetcars are positions reported by the vehicles, refreshed about every 30 seconds. ' +
        'Subway, light rail, GO and UP Express trains are estimates worked out from the timetable, not live positions.',
    ),
    element(
      'p',
      undefined,
      'Traffic camera images are stills from the City of Toronto, replaced every few minutes.',
    ),
    element('h2', undefined, 'Data'),
  );
  const credits = element('ul', 'credits');
  const attributions = new Map(
    options.sources.flatMap((source) => source.attributions).map((attribution) => [attribution.text, attribution]),
  );
  for (const attribution of attributions.values()) {
    const item = element('li');
    item.append(link(attribution));
    credits.append(item);
  }
  const basemap = element('li');
  basemap.append('Map: OpenFreeMap, OpenMapTiles and OpenStreetMap contributors');
  credits.append(basemap);
  const contact = element('p');
  const email = element('a', undefined, CONTACT_EMAIL);
  email.href = `mailto:${CONTACT_EMAIL}`;
  contact.append('Questions, corrections or ideas: ', email);
  about.append(
    credits,
    element(
      'p',
      'note',
      'An independent project, not affiliated with or endorsed by the TTC, the City of Toronto or Metrolinx.',
    ),
    element('h2', undefined, 'Contact'),
    contact,
  );

  content.append(tabList, body);
  flyout.append(content, pullTab);
  document.body.append(flyout);
  // Opens on Data, the tab with the controls people come to the menu for.
  select(tabs.findIndex(({ button }) => button.textContent === 'Data'));

  return {
    occupied: () => (flyout.classList.contains('open') ? flyout : pullTab).getBoundingClientRect(),
    coveredWidth: () => {
      // The closed menu sits wholly off screen, where its right edge is at zero.
      const edge = flyout.getBoundingClientRect().right;
      return edge > 0 ? edge + SPINE_PX : 0;
    },
    setStatus(sourceId, text, warning) {
      const status = statuses.get(sourceId);
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('warning', warning);
    },
    setRoutes(sourceId, routes) {
      lineLists.get(sourceId)?.add(sourceId, routes);
    },
  };
}
