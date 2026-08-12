import { TestBed } from '@angular/core/testing';
import { SessionDoneComponent } from './session-done';
import { CelebrationService } from '../../celebrations/celebration.service';
import { CelebrationContext, PickedCelebration } from '../../celebrations/celebration.types';
import { ReviewTotalsService } from '../review-totals.service';

const picked: PickedCelebration = {
  id: 'valentine',
  src: 'celebrations/special-dates/valentine.webp',
};

const totalsStub = { counters: () => Promise.resolve({ photosDeleted: 100, photosEdited: 12 }) };

async function render(service: Partial<CelebrationService>): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [SessionDoneComponent],
    providers: [
      { provide: CelebrationService, useValue: service },
      { provide: ReviewTotalsService, useValue: totalsStub },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SessionDoneComponent);
  fixture.componentRef.setInput('streakDays', 7);
  fixture.detectChanges(); // runs ngOnInit, which kicks off the async pick
  // The pick awaits the totals and then the picker, so draining a single microtask turn is not
  // enough — yield to the macrotask queue to let the whole chain settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('SessionDoneComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the picked celebration, and still renders when there is none', async () => {
    let seen: CelebrationContext | null = null;
    const root = await render({
      pickAndRecord: (context: CelebrationContext) => {
        seen = context;
        return Promise.resolve(picked);
      },
    });

    expect(root.querySelector('img.celebration')?.getAttribute('src')).toBe(picked.src);
    // Finishing the session is itself the trigger; lifetime totals and the streak ride along so
    // milestone entries have something to match on.
    expect(seen!.event).toBe('sessionFinished');
    expect(seen!.counters).toEqual({ photosDeleted: 100, photosEdited: 12, streakDays: 7 });

    // Storage can refuse (private browsing), and the screen has to survive that with no picture.
    TestBed.resetTestingModule();
    const bare = await render({ pickAndRecord: () => Promise.reject(new Error('no storage')) });
    expect(bare.querySelector('img.celebration')).toBeNull();
    expect(bare.querySelector('h2')?.textContent).toContain('All caught up');
  });
});
