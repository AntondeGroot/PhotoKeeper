import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagManagerComponent } from './tag-manager';
import { Tag } from '../tags';

const tags: Tag[] = [
  { id: 'animals', name: 'Animals' },
  { id: 'family', name: 'Family' },
];

describe('TagManagerComponent', () => {
  let fixture: ComponentFixture<TagManagerComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TagManagerComponent] }).compileComponents();
    fixture = TestBed.createComponent(TagManagerComponent);
    fixture.componentRef.setInput('tags', tags);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('renders a row per tag', () => {
    const names = Array.from(root.querySelectorAll<HTMLInputElement>('.tag-name')).map(
      (i) => i.value,
    );
    expect(names).toEqual(['Animals', 'Family']);
  });

  it('emits added with the trimmed draft and clears the field', () => {
    let added: string | undefined;
    fixture.componentInstance.added.subscribe((n) => (added = n));
    const input = root.querySelector<HTMLInputElement>('.tag-add-input')!;
    input.value = '  Architecture  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('.tag-add-btn')!.click();
    fixture.detectChanges(); // flush the cleared draft signal into the bound input

    expect(added).toBe('Architecture');
    expect(input.value).toBe(''); // cleared
  });

  it('disables Add when the draft is blank', () => {
    const btn = root.querySelector<HTMLButtonElement>('.tag-add-btn')!;
    expect(btn.disabled).toBe(true);
  });

  it('emits removed with the tag id when ✕ is clicked', () => {
    let removed: string | undefined;
    fixture.componentInstance.removed.subscribe((id) => (removed = id));

    root.querySelectorAll<HTMLButtonElement>('.tag-delete')[1].click();

    expect(removed).toBe('family');
  });

  describe('swipe directions', () => {
    it('offers a binding row for each of the seven assignable directions', () => {
      const labels = Array.from(root.querySelectorAll('.dir-row .dir-label')).map((l) =>
        l.textContent?.trim(),
      );

      expect(labels).toEqual([
        '← Left',
        '→ Right',
        '↑ Up',
        '↓ Down',
        '↖ Up-left',
        '↗ Up-right',
        '↙ Down-left',
        '↘ Down-right', // the reserved corner, stated but not chosen
      ]);
      expect(root.querySelectorAll('.dir-select')).toHaveLength(7);
    });

    it('states the reserved corner as fixed rather than offering it as a choice', () => {
      expect(root.querySelector('.dir-fixed')?.textContent?.trim()).toBe('No tag · always');
    });

    it('offers only the tags still going spare, plus None', () => {
      // A tag lives on one direction, so listing one that is already spoken for offers a choice that
      // would quietly unbind it somewhere else.
      fixture.componentRef.setInput('directions', { left: 'animals' });
      fixture.detectChanges();
      const selects = root.querySelectorAll<HTMLSelectElement>('.dir-select');
      const optionsOf = (s: HTMLSelectElement) =>
        Array.from(s.options).map((o) => o.textContent?.trim());

      expect(optionsOf(selects[1])).toEqual(['None', 'Family']); // right: Animals is taken
      expect(optionsOf(selects[0])).toEqual(['None', 'Animals', 'Family']); // left: its own stays
      expect(selects[0].value).toBe('animals');
    });

    it('marks a bound direction as set', () => {
      fixture.componentRef.setInput('directions', { left: 'animals' });
      fixture.detectChanges();
      const controls = root.querySelectorAll('.dir-control');

      expect(controls[0].classList.contains('bound')).toBe(true);
      expect(controls[1].classList.contains('bound')).toBe(false);
    });

    it('emits the binding when a direction is pointed at a tag', () => {
      let changed: { dir: string; tagId: string | null } | undefined;
      fixture.componentInstance.directionChanged.subscribe((c) => (changed = c));
      const corner = root.querySelectorAll<HTMLSelectElement>('.dir-select')[4]; // up-left
      corner.value = 'family';
      corner.dispatchEvent(new Event('change'));

      expect(changed).toEqual({ dir: 'up-left', tagId: 'family' });
    });
  });

  it('emits renamed on change of a name field', () => {
    let renamed: { id: string; name: string } | undefined;
    fixture.componentInstance.renamed.subscribe((c) => (renamed = c));
    const nameInput = root.querySelectorAll<HTMLInputElement>('.tag-name')[0];
    nameInput.value = 'Pets';
    nameInput.dispatchEvent(new Event('change'));

    expect(renamed).toEqual({ id: 'animals', name: 'Pets' });
  });
});
