import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceSourceComponent } from './device-source';
import { DeviceFolder } from '../photo';

const folders = (): DeviceFolder[] => [
  { name: 'Camera', count: 1284, enabled: true },
  { name: 'Screenshots', count: 912, enabled: false },
];

describe('DeviceSourceComponent', () => {
  let fixture: ComponentFixture<DeviceSourceComponent>;
  let component: DeviceSourceComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    localStorage.clear(); // reset the "folders intro seen" flag between cases
    await TestBed.configureTestingModule({ imports: [DeviceSourceComponent] }).compileComponents();
    fixture = TestBed.createComponent(DeviceSourceComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
  });

  function render(enabled: boolean): void {
    fixture.componentRef.setInput('enabled', enabled);
    fixture.componentRef.setInput('folders', folders());
    fixture.detectChanges();
  }

  function expand(): void {
    root.querySelector<HTMLButtonElement>('.folders-toggle')?.click();
    fixture.detectChanges();
  }

  it('hides the folder section entirely until the device source is on', () => {
    render(false);
    expect(root.querySelector('.device-folders')).toBeNull();

    render(true);
    expect(root.querySelector('.device-folders')).not.toBeNull();
  });

  it('auto-expands the folder list the first time the device is turned on', () => {
    render(true); // fresh: intro not seen → opens expanded so the user can pick folders
    expect(root.querySelectorAll('.folder-row')).toHaveLength(2);
  });

  it('opens collapsed (behind a summary) on later visits once the intro has been seen', () => {
    localStorage.setItem('deviceFoldersIntroSeen', 'true');
    render(true);
    expect(root.querySelectorAll('.folder-row')).toHaveLength(0);
    expect(root.querySelector('.folders-summary')?.textContent?.trim()).toBe('1 of 2');

    expand();
    expect(root.querySelectorAll('.folder-row')).toHaveLength(2);
  });

  it('renders each folder with a count and a tick only for enabled ones', () => {
    render(true); // first-time render auto-expands
    const rows = root.querySelectorAll<HTMLElement>('.folder-row');
    expect(rows[0].querySelector('.folder-name')?.textContent?.trim()).toBe('Camera');
    expect(rows[0].querySelector('.folder-count')?.textContent?.trim()).toBe('1,284 photos');
    expect(rows[0].querySelector('.folder-check')?.classList.contains('on')).toBe(true);
    expect(rows[1].querySelector('.folder-check')?.classList.contains('on')).toBe(false);
  });

  it('emits the flipped master toggle', () => {
    render(false);
    let emitted: boolean | undefined;
    component.toggled.subscribe((v) => (emitted = v));

    root.querySelector<HTMLButtonElement>('.toggle')?.click();

    expect(emitted).toBe(true);
  });

  it('emits the folder name when a folder row is clicked', () => {
    render(true); // first-time render auto-expands the list
    let emitted: string | undefined;
    component.folderToggled.subscribe((name) => (emitted = name));

    root.querySelectorAll<HTMLButtonElement>('.folder-row')[1].click();

    expect(emitted).toBe('Screenshots');
  });
});
