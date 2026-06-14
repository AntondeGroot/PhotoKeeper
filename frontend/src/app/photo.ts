export interface AiHint {
  verdict: 'kept' | 'rejected' | 'toEdit';
  reason: string;
}

export type ReviewItem = Photo | Burst;

export interface Burst {
  id: string;
  name: string; // without extension
  album: string | null;
  taken: string; // ISO 8601, e.g. '2026-05-24'
  status: 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';
  kind: 'burst';
  photos: BurstPhoto[];
}

export interface BurstPhoto {
  id: string;
  name: string;
  blur?: boolean;
  ai?: AiHint;
}

export interface Photo {
  id: string;
  name: string; // without extension
  album: string | null;
  taken: string; // ISO 8601, e.g. '2026-05-24'
  status: 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';
  kind: 'photo';
  starred: boolean;
  keepsake: boolean;
  ai?: AiHint;
}

export interface AlbumGroup {
  album: string;
  photos: Photo[];
}

export const MOCK_PHOTOS: Photo[] = [
  {
    id: 'IMG_4021',
    name: 'IMG_4021',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
    ai: {
      verdict: 'kept',
      reason: 'Tack sharp, strong golden light',
    },
  },
  {
    id: 'IMG_4022',
    name: 'IMG_4022',
    album: null,
    taken: '2026-03-15',
    status: 'backlog',
    kind: 'photo',
    starred: true,
    keepsake: false,
  },
  {
    id: 'IMG_4038',
    name: 'IMG_4038',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
    ai: {
      verdict: 'rejected',
      reason: 'Motion blur on subject, flat light',
    },
  },
  {
    id: 'IMG_4090',
    name: 'IMG_4090',
    album: 'Lisbon, May',
    taken: '2026-05-10',
    status: 'kept',
    kind: 'photo',
    starred: false,
    keepsake: true,
  },
];

export const MOCK_BURST: Burst = {
  id: 'burst1',
  name: 'Burst · 3 frames',
  album: 'Field work',
  taken: '2026-05-24',
  status: 'backlog',
  kind: 'burst',
  photos: [
    {
      id: 'b1',
      name: 'IMG_4044',
      ai: { verdict: 'kept', reason: 'Best of burst — level horizon' },
    },
    { id: 'b2', name: 'IMG_4045' },
    { id: 'b3', name: 'IMG_4046', blur: true },
  ],
};
