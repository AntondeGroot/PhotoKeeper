import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PrintsComponent } from './prints';
import { PrintsService } from './prints.service';
import { AlbumGroup, Photo } from '../photo';

const photo = (id: string, saveOnly = false): Photo => ({
  id,
  name: id,
  album: 'Trip',
  taken: '2026-01-01',
  status: 'kept',
  kind: 'photo',
  starred: false,
  saveOnly,
});
const group = (album: string, ...photos: Photo[]): AlbumGroup => ({ album, photos });

describe('PrintsComponent', () => {
  let ordered: string[];
  let placed: string[];

  /**
   * The component class against a recording service. Built rather than rendered: what is under test
   * is which action an album's one button takes, and rendering would drag in preview fetching.
   */
  function make(): PrintsComponent {
    ordered = [];
    placed = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PrintsService,
          useValue: {
            toPrint: signal([]),
            done: signal([]),
            refresh: () => Promise.resolve(),
            markOrdered: (album: string) => {
              ordered.push(album);
            },
            markPlaced: (album: string) => {
              placed.push(album);
            },
          },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new PrintsComponent());
  }

  it('orders an album with prints chosen, and completes one with none outright', () => {
    const component = make();

    component.settle(group('Trip', photo('a'), photo('b', true)));
    expect(ordered).toEqual(['Trip']);

    // Every photo set aside means there is nothing to order, so "I've ordered these" would be a
    // lie and Done the wrong lane. Ordering is the only thing that ever clears an album, so
    // without completing it here the album would sit in To print for good.
    component.settle(group('Home', photo('c', true)));
    expect(placed).toEqual(['Home']);
    expect(ordered).toEqual(['Trip']);
  });
});
