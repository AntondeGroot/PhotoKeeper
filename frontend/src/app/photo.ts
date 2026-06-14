export interface AiHint {
  verdict: 'kept' | 'rejected' | 'toEdit';
  reason: string;
}

export type ReviewItem = Photo | Burst | Pano | Stereo;

export interface Burst {
  id: string;
  name: string; // without extension
  album: string | null;
  taken: string; // ISO 8601, e.g. '2026-05-24'
  status: 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';
  kind: 'burst';
  photos: BurstPhoto[];
}

export interface PanoFrame {
  id: string;
  name: string;
  blur?: boolean;
}

export interface Pano {
  id: string;
  name: string;
  album: string | null;
  taken: string;
  status: 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';
  kind: 'pano';
  frames: PanoFrame[];
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

export const MOCK_PANO: Pano = {
  id: 'pano1',
  name: 'Panorama · 4 frames',
  album: 'Peaks',
  taken: '2026-05-24',
  status: 'backlog',
  kind: 'pano',
  frames: [
    { id: 'pn1', name: 'DSC_5001' },
    { id: 'pn2', name: 'DSC_5002' },
    { id: 'pn3', name: 'DSC_5003', blur: true },
    { id: 'pn4', name: 'DSC_5004' },
  ],
};

export interface StereoFrame {
  id: string;
  name: string;
  blur?: boolean;
}

export interface StereoBaseline {
  key: string;
  label: string;
  hint: string;
  frames: StereoFrame[];
  recommended?: boolean;
}

export interface Stereo {
  id: string;
  name: string;
  album: string | null;
  taken: string;
  status: 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';
  kind: 'stereo';
  left: StereoFrame[];
  baselines: StereoBaseline[];
}

export const MOCK_STEREO: Stereo = {
  id: 'stereo1',
  name: 'Stereo set · 7 frames',
  album: 'Field work',
  taken: '2026-05-24',
  status: 'backlog',
  kind: 'stereo',
  left: [
    { id: 's1', name: 'DSC_6001' },
    { id: 's2', name: 'DSC_6002' },
    { id: 's3', name: 'DSC_6003' },
  ],
  baselines: [
    {
      key: '3m',
      label: '3 m',
      hint: 'avg of 1 · 1 soft excluded',
      frames: [
        { id: 's4', name: 'DSC_6004' },
        { id: 's5', name: 'DSC_6005', blur: true },
      ],
    },
    {
      key: '10m',
      label: '10 m',
      hint: 'avg of 2',
      frames: [
        { id: 's6', name: 'DSC_6006' },
        { id: 's7', name: 'DSC_6007' },
      ],
      recommended: true,
    },
  ],
};

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
