import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { KeeperAlbumsService } from './keeper-albums.service';
import { LightroomService } from './lightroom.service';

describe('KeeperAlbumsService', () => {
  let calls: number;
  let answer: () => Observable<{ id: string; name: string }[]>;

  beforeEach(() => {
    calls = 0;
    answer = () => of([]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LightroomService,
          useValue: {
            getAlbums: () => {
              calls++;
              return answer();
            },
          },
        },
      ],
    });
  });

  const catalog =
    (...albums: { id: string; name: string }[]) =>
    () =>
      of(albums);

  it('reports the KeeperEdit album id once the catalog has it', async () => {
    answer = catalog({ id: 'al-9', name: 'KeeperEdit' }, { id: 'al-1', name: 'Holiday' });
    const service = TestBed.inject(KeeperAlbumsService);

    await service.ensure();

    expect(service.editAlbumId()).toBe('al-9');
    expect(service.missing().map((a) => a.name)).toEqual(['KeeperDelete', 'KeeperPrint']);
  });

  it('has no edit album when the catalog has not got one', async () => {
    answer = catalog({ id: 'al-1', name: 'Holiday' });
    const service = TestBed.inject(KeeperAlbumsService);

    await service.ensure();

    expect(service.editAlbumId()).toBeNull();
  });

  it('asks the catalog once, however many callers there are', async () => {
    // Both the setup notice and the Edit step want this answer, and two calls could disagree.
    answer = catalog({ id: 'al-9', name: 'KeeperEdit' });
    const service = TestBed.inject(KeeperAlbumsService);

    await Promise.all([service.ensure(), service.ensure(), service.ensure()]);

    expect(calls).toBe(1);
  });

  it('concludes nothing while the catalog is unread', () => {
    const service = TestBed.inject(KeeperAlbumsService);

    expect(service.checked()).toBe(false);
    expect(service.missing()).toEqual([]); // not "all three are missing"
    expect(service.editAlbumId()).toBeNull();
  });

  it('stays unread after a failure, and genuinely retries next time', async () => {
    answer = () => throwError(() => new Error('offline'));
    const service = TestBed.inject(KeeperAlbumsService);
    await service.ensure();

    expect(service.checked()).toBe(false);
    expect(calls).toBe(1);

    answer = catalog({ id: 'al-9', name: 'KeeperEdit' });
    await service.ensure();

    expect(calls).toBe(2); // the failed attempt was not cached as an answer
    expect(service.editAlbumId()).toBe('al-9');
  });

  it('refresh() asks again — for after the albums have been created in Lightroom', async () => {
    answer = catalog();
    const service = TestBed.inject(KeeperAlbumsService);
    await service.ensure();
    expect(service.editAlbumId()).toBeNull();

    answer = catalog({ id: 'al-9', name: 'KeeperEdit' });
    await service.refresh();

    expect(service.editAlbumId()).toBe('al-9');
  });
});
