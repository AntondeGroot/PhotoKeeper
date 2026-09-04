import { TestBed } from '@angular/core/testing';
import { StereoAlbumsService } from './stereo-albums.service';
import { PreferencesService } from '../preferences.service';
import { CatalogScanService } from '../detection/scan/catalog-scan.service';
import { ReviewDecisionsService } from './review-decisions.service';

const ALBUM = 'Houten';

describe('StereoAlbumsService', () => {
  let stereo: StereoAlbumsService;
  let prefs: PreferencesService;
  let withdrawn: string[];

  beforeEach(() => {
    localStorage.clear(); // PreferencesService hydrates the roles on construction
    withdrawn = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CatalogScanService,
          useValue: { invalidateAlbumByName: () => Promise.resolve() },
        },
        {
          provide: ReviewDecisionsService,
          useValue: { withdrawAlbum: (name: string) => withdrawn.push(name) },
        },
      ],
    });
    stereo = TestBed.inject(StereoAlbumsService);
    prefs = TestBed.inject(PreferencesService);
  });

  it('cycles an album through both eyes, left, right, and back off', () => {
    const seen: (string | null)[] = [];
    for (let tap = 0; tap < 5; tap++) {
      stereo.cycle(ALBUM);
      seen.push(stereo.role(ALBUM));
    }

    // "Both eyes" comes first because it is the common rig; the split-album roles follow. The fifth
    // tap coming back round to 'both' is what makes this a cycle rather than a dead end — an album
    // marked by mistake has to be reachable back to unmarked, and past it.
    expect(seen).toEqual(['both', 'left', 'right', null, 'both']);
    expect(prefs.stereoAlbumRoles()).toEqual({ [ALBUM]: 'both' });

    // Every step withdraws, unmarking included: each one changes how the album's frames are
    // grouped, so whatever the deck already holds for it was drawn under a grouping that is gone.
    expect(withdrawn).toEqual([ALBUM, ALBUM, ALBUM, ALBUM, ALBUM]);
  });

  it('gives a right album to only one left album at a time', () => {
    stereo.setRole('Trip · left', 'left');
    stereo.setRole('Trip · right', 'right');
    stereo.setPartner('Trip · left', 'Trip · right');

    // A second left album claiming the same right one takes it: two claims would pair every right
    // frame twice, and nothing on screen could say which pairing was the real one.
    stereo.setRole('Walk · left', 'left');
    stereo.setPartner('Walk · left', 'Trip · right');

    expect(stereo.partner('Walk · left')).toBe('Trip · right');
    expect(stereo.partner('Trip · left')).toBeNull();
    expect(stereo.claimant('Trip · right')).toBe('Walk · left');
  });
});
