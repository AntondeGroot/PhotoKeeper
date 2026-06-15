import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanoCardComponent } from './pano-card';
import { Pano } from '../photo';

function panoFixture(): Pano {
  return {
    id: 'pano1',
    name: 'Panorama',
    album: 'Peaks',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'pano',
    frames: [
      { id: 'pn1', name: 'DSC_1' },
      { id: 'pn2', name: 'DSC_2', blur: true },
    ],
  };
}

// PanoCardComponent has no class logic — its only behaviour is the action buttons emitting `swiped`,
// so this renders the template and clicks the real buttons.
describe('PanoCardComponent', () => {
  let fixture: ComponentFixture<PanoCardComponent>;
  let component: PanoCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PanoCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(PanoCardComponent);
    component = fixture.componentInstance;
    component.pano = panoFixture();
    fixture.detectChanges();
  });

  function clickButton(symbol: string): void {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll<HTMLButtonElement>('.action-buttons button');
    const button = Array.from(buttons).find((b) => b.textContent?.trim() === symbol);
    if (!button) {
      throw new Error(`No action button with label "${symbol}"`);
    }
    button.click();
  }

  const cases: [string, string][] = [
    ['✕', 'rejected'],
    ['↑', 'toEdit'],
    ['✓', 'kept'],
    ['↓', 'maybe'],
  ];

  for (const [symbol, expected] of cases) {
    it(`emits "${expected}" when the ${symbol} button is clicked`, () => {
      let emitted: string | undefined;
      component.swiped.subscribe((value) => (emitted = value));

      clickButton(symbol);

      expect(emitted).toBe(expected);
    });
  }
});
