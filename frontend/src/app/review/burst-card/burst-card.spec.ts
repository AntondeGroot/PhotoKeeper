import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { BurstCardComponent } from './burst-card';
import { Burst } from '../../photo';

function burst(photos: { id: string; name: string; blur?: boolean }[]): Burst {
  return {
    id: 'burst1',
    name: 'Burst',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'burst',
    photos,
  };
}

function burstFixture(): Burst {
  return burst([
    { id: 'b1', name: 'IMG_1' },
    { id: 'b2', name: 'IMG_2', blur: true },
    { id: 'b3', name: 'IMG_3' },
  ]);
}

describe('BurstCardComponent', () => {
  let component: BurstCardComponent;

  beforeEach(() => {
    component = new BurstCardComponent();
    component.burst = burstFixture();
  });

  it('survivors are the non-blurred frames; excluded are the blurred ones', () => {
    expect(component.survivors().map((p) => p.id)).toEqual(['b1', 'b3']);
    expect(component.excluded().map((p) => p.id)).toEqual(['b2']);
  });

  it('duels the survivors a pair at a time and emits the final winner', () => {
    component.burst = burst([
      { id: 's1', name: 'A' },
      { id: 's2', name: 'B' },
      { id: 's3', name: 'C' },
    ]);
    let winner: string[] | undefined;
    component.resolved.subscribe((ids) => (winner = ids));

    expect(component.duel()).toEqual({
      a: { id: 's1', name: 'A' },
      b: { id: 's2', name: 'B' },
    });

    component.chooseWinner('s2'); // s2 beats s1 → champion, next challenger s3
    expect(winner).toBeUndefined();
    expect(component.duel()).toEqual({ a: { id: 's2', name: 'B' }, b: { id: 's3', name: 'C' } });

    component.chooseWinner('s3'); // s3 beats s2 → no challengers left → resolved
    expect(winner).toEqual(['s3']);
  });

  it('has no duel for a single survivor and keepChampion emits it', () => {
    component.burst = burst([{ id: 's1', name: 'only' }]);
    let winner: string[] | undefined;
    component.resolved.subscribe((ids) => (winner = ids));

    expect(component.duel()).toBeNull();

    component.keepChampion();
    expect(winner).toEqual(['s1']);
  });

  it('renders an image for a duel frame that has a preview URL', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    const sanitizer = TestBed.inject(DomSanitizer);
    fixture.componentInstance.burst = burstFixture(); // duel is b1 (A) vs b3 (B)
    fixture.componentInstance.imageUrls = new Map([
      ['b1', sanitizer.bypassSecurityTrustUrl('data:image/png;base64,AAAA')],
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('img.burst-frame-img').length).toBe(1); // only b1 has a URL
  });

  const threeFrame = () =>
    burst([
      { id: 's1', name: 'A' },
      { id: 's2', name: 'B' },
      { id: 's3', name: 'C' },
    ]);

  it('Keep A keeps the champion and advances to the next challenger', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    const c = fixture.componentInstance;
    c.burst = threeFrame();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(c.duel()).toEqual({ a: { id: 's1', name: 'A' }, b: { id: 's2', name: 'B' } });
    el.querySelectorAll<HTMLButtonElement>('.pick-btn')[0]?.click(); // Keep A
    fixture.detectChanges();
    expect(c.duel()).toEqual({ a: { id: 's1', name: 'A' }, b: { id: 's3', name: 'C' } });
    expect(c.challengerIdx()).toBe(2);
  });

  it('Keep B promotes the challenger and advances', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    const c = fixture.componentInstance;
    c.burst = threeFrame();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelectorAll<HTMLButtonElement>('.pick-btn')[1]?.click(); // Keep B
    fixture.detectChanges();
    expect(c.duel()).toEqual({ a: { id: 's2', name: 'B' }, b: { id: 's3', name: 'C' } });
  });

  it('tapping a frame enlarges (compare) the duel pair, starting on the tapped one', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    const c = fixture.componentInstance;
    c.burst = threeFrame();
    let compared: { ids: string[]; start: number } | undefined;
    let winner: string[] | undefined;
    c.compare.subscribe((e) => (compared = e));
    c.resolved.subscribe((ids) => (winner = ids));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const frames = el.querySelectorAll<HTMLButtonElement>('.burst-frame');

    frames[0]?.click(); // tap A → compare starting at 0
    expect(compared).toEqual({ ids: ['s1', 's2'], start: 0 });
    frames[1]?.click(); // tap B → compare starting at 1 (B shown first)
    expect(compared).toEqual({ ids: ['s1', 's2'], start: 1 });
    expect(winner).toBeUndefined(); // tapping a frame never picks
  });

  describe('a pair where nobody loses', () => {
    /** The five-frame burst the fault was found in: worse frames thrown out, then two keepers. */
    const fiveFrame = () =>
      burst([
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B' },
        { id: 's3', name: 'C' },
        { id: 's4', name: 'D' },
        { id: 's5', name: 'E' },
      ]);

    it('keeps both and carries on, without touching what was already decided', () => {
      // The reported fault: after throwing out the weaker frames, a pair you both want used to leave
      // "not a burst" as the only answer — and that handed the whole set back undecided.
      const component = new BurstCardComponent();
      component.burst = fiveFrame();
      let kept: string[] | undefined;
      component.resolved.subscribe((ids) => (kept = ids));

      component.chooseWinner('s1'); // s1 beats s2 — s2 is out
      component.chooseWinner('s1'); // s1 beats s3 — s3 is out
      expect(component.duel()).toEqual({ a: { id: 's1', name: 'A' }, b: { id: 's4', name: 'D' } });

      component.keepBoth(); // s1 and s4 are both keepers
      expect(kept).toBeUndefined(); // s5 has not been looked at yet
      expect(component.champion()?.id).toBe('s5'); // it is offered on its own

      component.keepChampion();
      expect(kept).toEqual(['s1', 's4', 's5']); // and the frames thrown out earlier stayed out
    });

    it('resolves on the spot when the kept pair was the last of the burst', () => {
      const component = new BurstCardComponent();
      component.burst = burst([
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B' },
      ]);
      let kept: string[] | undefined;
      component.resolved.subscribe((ids) => (kept = ids));

      component.keepBoth();

      expect(kept).toEqual(['s1', 's2']);
    });

    it('rejects both and carries on with the rest of the burst', () => {
      const component = new BurstCardComponent();
      component.burst = fiveFrame();
      let kept: string[] | undefined;
      component.resolved.subscribe((ids) => (kept = ids));

      component.rejectBoth(); // s1 and s2 are both out
      expect(component.duel()).toEqual({ a: { id: 's3', name: 'C' }, b: { id: 's4', name: 'D' } });

      component.keepBoth(); // s3 and s4 are keepers
      component.keepChampion(); // s5 alone
      expect(kept).toEqual(['s3', 's4', 's5']);
    });

    it('settles on nothing when every frame was rejected', () => {
      const component = new BurstCardComponent();
      component.burst = burst([
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B' },
      ]);
      let kept: string[] | undefined;
      component.resolved.subscribe((ids) => (kept = ids));

      component.rejectBoth();

      expect(kept).toEqual([]);
    });

    it('offers "keep both" and "reject both" on the duel itself', () => {
      const fixture = TestBed.createComponent(BurstCardComponent);
      fixture.componentInstance.burst = fiveFrame();
      fixture.detectChanges();
      const labels = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.burst-pick-both .pick-btn'),
      ).map((b) => b.textContent?.trim());

      expect(labels).toEqual(['Keep both photos', 'Reject both photos']);
    });
  });
});
