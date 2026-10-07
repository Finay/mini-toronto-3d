// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route, SourceInfo } from '../shared/types';
import { createMenu, matchesLine, type MenuOptions } from './menu';

const source = (id: string, name: string): SourceInfo => ({
  id,
  name,
  group: 'TTC',
  kind: 'vehicles',
  attributions: [{ text: 'Vehicle positions: TTC', url: 'https://www.ttc.ca/' }],
  pollIntervalMs: 15_000,
  simulated: false,
  hasRoutes: true,
});

const route = (id: string, longName: string, mode: Route['mode']): Route => ({
  id,
  shortName: id,
  longName,
  mode,
  color: '#D5C82B',
  shapeIds: [],
  displayShapeIds: [],
});

function setup() {
  const options: MenuOptions = {
    sources: [source('ttc', 'Buses and streetcars'), source('ttc-rapid-transit', 'Subway and light rail')],
    lightMode: false,
    onLightMode: vi.fn(),
    onPaused: vi.fn(),
    trackingMode: 'free',
    onTrackingMode: vi.fn(),
    onGroupVisible: vi.fn(),
    onGroupRouteLines: vi.fn(),
    onGroupStops: vi.fn(),
    onRoutesVisible: vi.fn(),
    onLinesHighlighted: vi.fn(),
  };
  const menu = createMenu(options);
  menu.setRoutes('ttc', [route('501', 'Queen', 'streetcar'), route('29', 'Dufferin', 'bus'), route('7', 'Bathurst', 'bus')]);
  menu.setRoutes('ttc-rapid-transit', [route('1', 'Yonge-University Line', 'subway')]);
  return { menu, options };
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const $$ = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
// Line rows, without the headings above each kind.
const lineRows = () => $$('.line:not(.line-heading)');
const lineNames = () => lineRows().filter((row) => !row.hidden).map((row) => row.textContent);
const row = (name: string) =>
  $$('.line-name')
    .find((label) => label.textContent === name)!
    .closest<HTMLElement>('.line')!;
const expander = (name: string) => row(name).querySelector<HTMLButtonElement>('.expander')!;
const group = (name: string) => row(name).nextElementSibling as HTMLElement;
const dot = (name: string) => row(name).querySelector<HTMLButtonElement>('.dot')!;
const type = (text: string) => {
  const search = $<HTMLInputElement>('.line-filter');
  search.value = text;
  search.dispatchEvent(new Event('input'));
};

describe('menu', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('opens and closes from its pull tab', () => {
    setup();
    const flyout = $('.flyout');

    const pullTab = $('.pull-tab');
    const content = $('.flyout-content');

    expect(flyout.classList.contains('open')).toBe(false);
    expect(content.inert).toBe(true);
    pullTab.click();
    expect(flyout.classList.contains('open')).toBe(true);
    expect(content.inert).toBe(false);
    expect(pullTab.getAttribute('aria-expanded')).toBe('true');
    expect(pullTab.getAttribute('aria-label')).toBe('Close menu');
    pullTab.click();
    expect(flyout.classList.contains('open')).toBe(false);
    expect(pullTab.getAttribute('aria-label')).toBe('Open menu');
  });

  it('has Appearance, Data and About tabs, opens on Data and shows one at a time', () => {
    setup();
    const tabs = $$('.tab');
    const panels = $$('.tab-panel');

    expect(tabs.map((tab) => tab.textContent)).toEqual(['Appearance', 'Data', 'About']);
    // Data is the tab shown first.
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false, true]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    tabs[0]!.click();
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('puts the light mode toggle in Appearance', () => {
    const { options } = setup();
    const toggle = $$('.tab-panel')[0]!.querySelector<HTMLInputElement>('input')!;

    expect(toggle.parentElement?.textContent).toBe('Light mode');
    toggle.click();
    expect(options.onLightMode).toHaveBeenCalledWith(true);
  });

  it('reports no covered width while closed', () => {
    const { menu } = setup();

    expect(menu.coveredWidth()).toBe(0);
  });

  it('has no heading above the tabs', () => {
    setup();

    expect($('.flyout-content').firstElementChild?.classList.contains('tabs')).toBe(true);
  });

  it('opens the About tab with the name as a logo heading', () => {
    setup();
    const about = $$('.tab-panel')[2]!;

    expect(about.firstElementChild?.tagName).toBe('H1');
    expect(about.querySelector('.logo')?.textContent).toBe('Mini Toronto 3D');
  });

  it('has the light mode toggle and a pause button in Appearance', () => {
    setup();
    const appearance = $$('.tab-panel')[0]!;

    expect(appearance.querySelector('.check')?.textContent).toBe('Light mode');
    expect(appearance.querySelector('.pause-button')?.textContent).toBe('Pause');
  });

  it('offers four ways to track a vehicle in Appearance, with the current one chosen', () => {
    const { options } = setup();
    const choices = $$<HTMLInputElement>('.tab-panel:first-child input[type="radio"]');

    expect($$('.option-name').map((name) => name.textContent)).toEqual(['Free', 'Top-back', 'Top-front', 'Helicopter']);
    expect(choices.map((choice) => choice.checked)).toEqual([true, false, false, false]);

    choices[3]!.click();
    expect(options.onTrackingMode).toHaveBeenLastCalledWith('helicopter');
    expect(choices.map((choice) => choice.checked)).toEqual([false, false, false, true]);
  });

  it('pauses and resumes from one button, which says what it will do next', () => {
    const { options } = setup();
    const button = $<HTMLButtonElement>('.pause-button');

    button.click();
    expect(options.onPaused).toHaveBeenLastCalledWith(true);
    expect(button.textContent).toBe('Resume');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    expect(options.onPaused).toHaveBeenLastCalledWith(false);
    expect(button.textContent).toBe('Pause');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('groups sources into a TTC section alongside the planned ones', () => {
    setup();

    expect($$('.section-name span:first-child').map((name) => name.textContent)).toEqual([
      'TTC',
      'GO Transit and UP Express',
      'Bike Share Toronto',
    ]);
  });

  it('opens the first section and folds the others, each from its name', () => {
    setup();
    const [ttc, go] = $$('.section');
    const body = (section: HTMLElement) => section.querySelector<HTMLElement>('.section-body')!;

    expect(body(ttc!).hidden).toBe(false);
    expect(body(go!).hidden).toBe(true);
    go!.querySelector<HTMLElement>('.section-name')!.click();
    expect(body(go!).hidden).toBe(false);
    ttc!.querySelector<HTMLElement>('.section-name')!.click();
    expect(body(ttc!).hidden).toBe(true);
  });

  it('gives each connected source a switch for whether it is on the map at all', () => {
    const { options } = setup();
    const [ttc, go] = $$('.section-header');
    const toggle = ttc!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    expect(toggle.checked).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Show TTC on the map');
    toggle.click();
    expect(options.onGroupVisible).toHaveBeenCalledWith('TTC', false);
    // Switching it does not fold the section.
    expect($<HTMLElement>('.section-body').hidden).toBe(false);
    // Planned sources have nothing to show, so no switch.
    expect(go!.querySelector('input')).toBeNull();
  });

  it('keeps the route line and stop toggles in the TTC section', () => {
    const { options } = setup();
    const toggles = $$<HTMLInputElement>('.section-body .check input');

    expect(toggles.map((toggle) => toggle.parentElement?.textContent)).toEqual(['Show route lines', 'Show stops']);
    toggles[0]!.click();
    expect(options.onGroupRouteLines).toHaveBeenCalledWith('TTC', false);
    toggles[1]!.click();
    expect(options.onGroupStops).toHaveBeenCalledWith('TTC', false);
  });

  it('lists lines from every source in the section, rapid transit first and in numeric order', () => {
    setup();

    expect(lineNames()).toEqual(['1 Yonge-University Line', '501 Queen', '7 Bathurst', '29 Dufferin']);
    expect($$('.line-heading .line-name').map((heading) => heading.textContent)).toEqual(['Subway', 'Streetcar', 'Bus']);
  });

  it('folds each kind of line into a dropdown that starts closed', () => {
    setup();

    expect(group('Bus').hidden).toBe(true);
    expect(expander('Bus').getAttribute('aria-expanded')).toBe('false');
    expect(row('Bus').querySelector('.count')!.textContent).toBe('2');
    expect([...group('Bus').children].map((line) => line.textContent)).toEqual(['7 Bathurst', '29 Dufferin']);

    expander('Bus').click();
    expect(group('Bus').hidden).toBe(false);
    expect(expander('Bus').getAttribute('aria-expanded')).toBe('true');
    // The other dropdowns stay as they were.
    expect(group('Subway').hidden).toBe(true);

    expander('Bus').click();
    expect(group('Bus').hidden).toBe(true);
  });

  it('opens the dropdowns that hold search matches, and closes them again afterwards', () => {
    setup();

    type('queen');
    expect(group('Streetcar').hidden).toBe(false);
    expect(row('Streetcar').querySelector('.count')!.textContent).toBe('1');

    type('');
    expect(group('Streetcar').hidden).toBe(true);
  });

  it('does not switch lines off when a dropdown is opened', () => {
    const { options } = setup();

    expander('Bus').click();

    expect(options.onRoutesVisible).not.toHaveBeenCalled();
    expect(dot('Bus').getAttribute('aria-checked')).toBe('true');
  });

  it('shows each source\'s status', () => {
    const { menu } = setup();

    expect($$('.source-name').map((name) => name.textContent)).toEqual(['Buses and streetcars', 'Subway and light rail']);

    menu.setStatus('ttc', 'feed unavailable', true);
    const status = $$('.status')[0]!;
    expect(status.textContent).toBe('feed unavailable');
    expect(status.classList.contains('warning')).toBe(true);
  });

  it('lists only lines that match the search, and hides empty headings', () => {
    setup();

    type('duff');
    expect(lineNames()).toEqual(['29 Dufferin']);
    expect(
      $$('.line-heading')
        .filter((heading) => !heading.hidden)
        .map((heading) => heading.querySelector('.line-name')!.textContent),
    ).toEqual(['Bus']);

    type('zzz');
    expect(lineNames()).toEqual([]);
    expect($('.lines .note').hidden).toBe(false);
  });

  it('switches a line off and on from its colour circle, and shows the state on it', () => {
    const { options } = setup();
    const queen = dot('501 Queen');

    expect(queen.getAttribute('aria-checked')).toBe('true');
    queen.click();
    expect(options.onRoutesVisible).toHaveBeenLastCalledWith('ttc', ['501'], false);
    expect(queen.getAttribute('aria-checked')).toBe('false');
    queen.click();
    expect(options.onRoutesVisible).toHaveBeenLastCalledWith('ttc', ['501'], true);
    expect(queen.getAttribute('aria-checked')).toBe('true');
  });

  it('does not switch a line when the rest of its row is clicked', () => {
    const { options } = setup();

    row('501 Queen').click();
    row('501 Queen').querySelector<HTMLElement>('.line-name')!.click();

    expect(options.onRoutesVisible).not.toHaveBeenCalled();
    expect(dot('501 Queen').getAttribute('aria-checked')).toBe('true');
  });

  it('switches a whole kind of line from its heading', () => {
    const { options } = setup();

    dot('Bus').click();
    expect(options.onRoutesVisible).toHaveBeenLastCalledWith('ttc', ['29', '7'], false);
    expect(dot('Bus').getAttribute('aria-checked')).toBe('false');
    expect(dot('7 Bathurst').getAttribute('aria-checked')).toBe('false');
    // Lines of other kinds from the same source are untouched.
    expect(dot('501 Queen').getAttribute('aria-checked')).toBe('true');

    dot('Bus').click();
    expect(options.onRoutesVisible).toHaveBeenLastCalledWith('ttc', ['29', '7'], true);
  });

  it('marks a kind as partly shown, and its switch then shows the rest', () => {
    const { options } = setup();

    dot('7 Bathurst').click();
    expect(dot('Bus').getAttribute('aria-checked')).toBe('mixed');

    dot('Bus').click();
    expect(options.onRoutesVisible).toHaveBeenLastCalledWith('ttc', ['7'], true);
    expect(dot('Bus').getAttribute('aria-checked')).toBe('true');
  });

  it('hides and shows only the lines the search lists', () => {
    const { options } = setup();
    const [showAll, hideAll] = $$('.line-actions .text-button');
    type('b');

    hideAll!.click();
    expect(options.onRoutesVisible).toHaveBeenCalledTimes(1);
    expect(options.onRoutesVisible).toHaveBeenCalledWith('ttc', ['7'], false);

    type('');
    showAll!.click();
    expect(options.onRoutesVisible).toHaveBeenLastCalledWith('ttc', ['7'], true);
  });

  it('picks out the lines a search matches, per source, until the box is emptied', () => {
    const { options } = setup();
    vi.mocked(options.onLinesHighlighted).mockClear();

    type('501');
    expect(options.onLinesHighlighted).toHaveBeenCalledWith('ttc', new Set(['501']));
    expect(options.onLinesHighlighted).toHaveBeenCalledWith('ttc-rapid-transit', new Set());

    vi.mocked(options.onLinesHighlighted).mockClear();
    type('');
    expect(options.onLinesHighlighted).toHaveBeenCalledWith('ttc', undefined);
    expect(options.onLinesHighlighted).toHaveBeenCalledWith('ttc-rapid-transit', undefined);
  });

  it('picks out a line while its row is pointed at', () => {
    const { options } = setup();
    const highlighted = vi.mocked(options.onLinesHighlighted);
    highlighted.mockClear();

    row('29 Dufferin').dispatchEvent(new Event('mouseenter'));
    expect(highlighted).toHaveBeenCalledWith('ttc', new Set(['29']));
    expect(highlighted).toHaveBeenCalledWith('ttc-rapid-transit', new Set());

    highlighted.mockClear();
    row('29 Dufferin').dispatchEvent(new Event('mouseleave'));
    expect(highlighted).toHaveBeenCalledWith('ttc', undefined);
    expect(highlighted).toHaveBeenCalledWith('ttc-rapid-transit', undefined);
  });

  it('picks out a whole kind while its heading is pointed at', () => {
    const { options } = setup();
    vi.mocked(options.onLinesHighlighted).mockClear();

    row('Bus').dispatchEvent(new Event('mouseenter'));

    expect(options.onLinesHighlighted).toHaveBeenCalledWith('ttc', new Set(['29', '7']));
  });

  it('goes back to the search matches when the pointer leaves a row', () => {
    const { options } = setup();
    const highlighted = vi.mocked(options.onLinesHighlighted);
    type('b');

    row('7 Bathurst').dispatchEvent(new Event('mouseenter'));
    highlighted.mockClear();
    row('7 Bathurst').dispatchEvent(new Event('mouseleave'));

    expect(highlighted).toHaveBeenCalledWith('ttc', new Set(['7']));
  });
});

describe('matchesLine', () => {
  const line = (shortName: string, longName: string) => ({ shortName, longName });

  it('matches a number only when it is the whole line number', () => {
    expect(matchesLine(line('5', 'Eglinton Line'), '5')).toBe(true);
    expect(matchesLine(line('501', 'Queen'), '5')).toBe(false);
    expect(matchesLine(line('95', 'York Mills'), '5')).toBe(false);
    expect(matchesLine(line('501', 'Queen'), '501')).toBe(true);
  });

  it('matches the start of a word in the name, not the middle', () => {
    expect(matchesLine(line('504', 'King'), 'king')).toBe(true);
    expect(matchesLine(line('12', 'Kingston Rd'), 'king')).toBe(true);
    expect(matchesLine(line('1', 'Yonge-University Line'), 'uni')).toBe(true);
    expect(matchesLine(line('99', 'Parking Lot'), 'king')).toBe(false);
  });

  it('requires every typed word to match', () => {
    expect(matchesLine(line('501', 'Queen'), '501 que')).toBe(true);
    expect(matchesLine(line('501', 'Queen'), '501 king')).toBe(false);
  });

  it('matches everything when nothing is typed', () => {
    expect(matchesLine(line('501', 'Queen'), '  ')).toBe(true);
  });
});
