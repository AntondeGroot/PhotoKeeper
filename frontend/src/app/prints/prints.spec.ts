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
  let done: string[];

  /**
   * The component class against a recording service. Built rather than rendered: what is under test
   * is which step each button records, and rendering would drag in preview fetching.
   */
  function make(): PrintsComponent {
    ordered = [];
    done = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PrintsService,
          useValue: {
            toPrint: signal([]),
            ordered: signal([]),
            done: signal([]),
            binState: signal([]),
            nextBin: signal(null),
            binsKnown: signal(true),
            binsInUse: signal([]),
            sending: signal(false),
            binHolding: () => null,
            refresh: () => Promise.resolve(),
            markOrdered: (album: string) => {
              ordered.push(album);
            },
            markDone: (album: string) => {
              done.push(album);
            },
          },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new PrintsComponent());
  }

  /**
   * The three steps are separate records, and only the first of them touches Lightroom. Ordering in
   * particular moves nothing: the photos stay in the print album until it is emptied by hand.
   */
  it('records ordering and receiving as two different steps', () => {
    const component = make();

    component.markOrdered('Trip');
    expect([ordered, done]).toEqual([['Trip'], []]);

    component.markReceived('Trip');
    expect([ordered, done]).toEqual([['Trip'], ['Trip']]);
  });

  /**
   * An album of nothing but keepsakes is finished without a print ever being ordered, which is why
   * the end state is 'done' rather than 'received'. Without a way out here it would sit in the first
   * lane for good, since ordering is the only other thing that moves one on.
   */
  it('completes an all-keepsakes album, without claiming it was ordered', () => {
    const component = make();

    component.completeUnprinted('Home');

    expect([ordered, done]).toEqual([[], ['Home']]);
  });

  /** The photos of a group, minus the ones set aside — what every lane's stack shows. */
  it('counts only the chosen photos as the album\u2019s prints', () => {
    const component = make();

    const chosen = component.chosen(group('Trip', photo('a'), photo('b', true)));

    expect(chosen.map((p) => p.id)).toEqual(['a']);
  });
});
