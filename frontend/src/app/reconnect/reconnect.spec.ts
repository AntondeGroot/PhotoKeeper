import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReconnectComponent } from './reconnect';

describe('ReconnectComponent', () => {
  let fixture: ComponentFixture<ReconnectComponent>;
  let component: ReconnectComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ReconnectComponent] }).compileComponents();
    fixture = TestBed.createComponent(ReconnectComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('loginHref', 'https://example.test/login');
  });

  it('offers the way back in — the connect link the lost session needs', () => {
    fixture.detectChanges();

    const link = root.querySelector<HTMLAnchorElement>('.btn-connect');
    expect(link?.getAttribute('href')).toBe('https://example.test/login');
    expect(link?.textContent?.trim()).toBe('Connect to Lightroom');
  });

  it('offers this device’s photos as the alternative when there are any', () => {
    fixture.componentRef.setInput('hasDeviceSource', true);
    fixture.detectChanges();

    expect(root.querySelector('.btn-later')?.textContent?.trim()).toBe(
      "Continue with this device's photos",
    );
  });

  it('says plainly there is nothing else to review when Lightroom was the only source', () => {
    fixture.componentRef.setInput('hasDeviceSource', false);
    fixture.detectChanges();

    expect(root.querySelector('.btn-later')?.textContent?.trim()).toBe(
      'Continue without Lightroom',
    );
  });

  it('emits when the user chooses to carry on without reconnecting', () => {
    fixture.detectChanges();
    let dismissed = false;
    component.dismissed.subscribe(() => (dismissed = true));

    root.querySelector<HTMLButtonElement>('.btn-later')?.click();

    expect(dismissed).toBe(true);
  });
});
