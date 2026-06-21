import { TestBed } from '@angular/core/testing';
import { TagState } from './tag-state.service';
import { TagStore } from '../storage/tags/tag-store';
import { AssetTagStore } from '../storage/tags/asset-tag-store';
import { Tag } from '../storage/photokeeper-db';

describe('TagState', () => {
  let service: TagState;
  let catalog: Tag[];
  let stored: Record<string, string[]>;

  beforeEach(() => {
    catalog = [
      { id: 'animals', name: 'Animals' },
      { id: 'family', name: 'Family' },
    ];
    stored = {};
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TagStore,
          useValue: {
            getAll: () => Promise.resolve(catalog),
            add: () => Promise.resolve(),
            rename: () => Promise.resolve(),
            remove: () => Promise.resolve(),
          },
        },
        {
          provide: AssetTagStore,
          useValue: {
            getAll: () => Promise.resolve(stored),
            set: (id: string, ids: string[]) => {
              stored[id] = ids;
              return Promise.resolve();
            },
          },
        },
      ],
    });
    service = TestBed.inject(TagState);
  });

  it('refresh() loads the catalog and assignments', async () => {
    stored = { IMG_1: ['animals'] };
    await service.refresh();
    expect(service.tags().map((t) => t.name)).toEqual(['Animals', 'Family']);
    expect(service.tagsFor('IMG_1')).toEqual(['animals']);
  });

  it('tagsFor() is empty for an untagged photo', () => {
    expect(service.tagsFor('nope')).toEqual([]);
  });

  it('apply() adds a tag once (idempotent) and persists', () => {
    service.apply('IMG_1', 'animals');
    service.apply('IMG_1', 'animals'); // already applied
    expect(service.tagsFor('IMG_1')).toEqual(['animals']);
    expect(stored['IMG_1']).toEqual(['animals']);
  });

  it('toggle() flips a tag on and off, persisting each change', () => {
    service.toggle('IMG_1', 'family');
    expect(service.tagsFor('IMG_1')).toEqual(['family']);
    service.toggle('IMG_1', 'family');
    expect(service.tagsFor('IMG_1')).toEqual([]);
    expect(stored['IMG_1']).toEqual([]);
  });
});
