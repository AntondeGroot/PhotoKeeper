import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagManagerComponent } from './tag-manager';
import { Tag } from '../../storage/photokeeper-db';

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

  it('emits renamed on change of a name field', () => {
    let renamed: { id: string; name: string } | undefined;
    fixture.componentInstance.renamed.subscribe((c) => (renamed = c));
    const nameInput = root.querySelectorAll<HTMLInputElement>('.tag-name')[0];
    nameInput.value = 'Pets';
    nameInput.dispatchEvent(new Event('change'));

    expect(renamed).toEqual({ id: 'animals', name: 'Pets' });
  });
});
