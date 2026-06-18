import { TestBed } from '@angular/core/testing';
import { DEFAULT_BURST_OPTIONS, DetectionSettingsService } from './detection-settings.service';

const STORAGE_KEY = 'detection-burst-options';

describe('DetectionSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  function service(): DetectionSettingsService {
    return TestBed.inject(DetectionSettingsService);
  }

  it('starts from the defaults when nothing is stored', () => {
    expect(service().burstOptions()).toEqual(DEFAULT_BURST_OPTIONS);
  });

  it('updates and persists individual thresholds', () => {
    const s = service();
    s.setBurstOptions({ windowMs: 60_000 });

    expect(s.burstOptions()).toEqual({ ...DEFAULT_BURST_OPTIONS, windowMs: 60_000 });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { windowMs: number };
    expect(stored.windowMs).toBe(60_000);
  });

  it('floors minSize at 2', () => {
    const s = service();
    s.setBurstOptions({ minSize: 1 });
    expect(s.burstOptions().minSize).toBe(2);
  });

  it('loads persisted options on construction', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ windowMs: 10_000, maxHamming: 6, minSize: 3 }),
    );
    expect(service().burstOptions()).toEqual({ windowMs: 10_000, maxHamming: 6, minSize: 3 });
  });

  it('keeps defaults when the stored value is malformed', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(service().burstOptions()).toEqual(DEFAULT_BURST_OPTIONS);
  });
});
