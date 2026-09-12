import { TestBed } from '@angular/core/testing';
import { EditVerdictRepairService } from './edit-verdict-repair.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMeta, StoredVerdict } from '../storage/photokeeper-db';

const meta = (name: string): AssetMeta => ({
  albumId: 'alb',
  name,
  ext: 'NEF',
  taken: '2026-05-01',
});
const decided = (status: StoredVerdict['status']): StoredVerdict => ({
  status,
  starred: false,
  saveOnly: false,
});

describe('EditVerdictRepairService', () => {
  let service: EditVerdictRepairService;
  let assets: Map<string, AssetMeta>;
  let verdicts: Map<string, StoredVerdict>;
  let written: string[];

  beforeEach(() => {
    assets = new Map([
      ['edit-1', meta('DSC_1891-Enhanced-NR')],
      ['orig-1', meta('DSC_1891')],
    ]);
    verdicts = new Map();
    written = [];

    TestBed.configureTestingModule({
      providers: [
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(assets) } },
        {
          provide: ReviewStore,
          useValue: {
            getVerdicts: () => Promise.resolve(verdicts),
            setVerdict: (id: string, v: StoredVerdict) => {
              written.push(id);
              verdicts.set(id, v);
              return Promise.resolve();
            },
          },
        },
      ],
    });
    service = TestBed.inject(EditVerdictRepairService);
  });

  it('gives the original the verdict its edit already carries', async () => {
    verdicts.set('edit-1', decided('rejected'));

    expect(await service.repair()).toBe(1);
    expect(verdicts.get('orig-1')).toEqual(decided('rejected'));
  });

  /**
   * The starred/print flags travel with it: the card the user judged stood for both files, so the
   * whole of what was recorded about it applies to both.
   */
  it('copies the whole verdict, not only its status', async () => {
    verdicts.set('edit-1', { status: 'kept', starred: true, saveOnly: true });

    await service.repair();

    expect(verdicts.get('orig-1')).toEqual({ status: 'kept', starred: true, saveOnly: true });
  });

  /** An original ruled on directly keeps its own answer — the edit's may not overwrite it. */
  it('never changes a verdict the original already has', async () => {
    verdicts.set('edit-1', decided('rejected'));
    verdicts.set('orig-1', decided('kept'));

    expect(await service.repair()).toBe(0);
    expect(verdicts.get('orig-1')).toEqual(decided('kept'));
  });

  it('leaves the original alone while the edit is undecided', async () => {
    expect(await service.repair()).toBe(0);
    expect(verdicts.has('orig-1')).toBe(false);
  });

  /** Nothing to inherit from: a denoise with no original is a photograph in its own right. */
  it('does nothing for an edit whose original is not on the device', async () => {
    assets.delete('orig-1');
    verdicts.set('edit-1', decided('kept'));

    expect(await service.repair()).toBe(0);
    expect(written).toEqual([]);
  });

  /** Run on every load, so it has to be quiet once there is nothing left to mend. */
  it('writes nothing on a second run', async () => {
    verdicts.set('edit-1', decided('toEdit'));
    await service.repair();
    written.length = 0;

    expect(await service.repair()).toBe(0);
    expect(written).toEqual([]);
  });
});
