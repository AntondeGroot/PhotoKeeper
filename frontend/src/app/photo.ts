export interface Photo {
  id: string;
  name: string; // without extension
  album: string | null;
  taken: string; // ISO 8601, e.g. '2026-05-24'
  status: 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';
  starred: boolean;
  keepsake: boolean;
}

export const MOCK_PHOTOS: Photo[] = [
  {
    id: 'IMG_4021',
    name: 'IMG_4021',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    starred: false,
    keepsake: false,
  },
  {
    id: 'IMG_4022',
    name: 'IMG_4022',
    album: null,
    taken: '2026-03-15',
    status: 'backlog',
    starred: true,
    keepsake: false,
  },
  {
    id: 'IMG_4038',
    name: 'IMG_4038',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    starred: false,
    keepsake: false,
  },
  {
    id: 'IMG_4090',
    name: 'IMG_4090',
    album: 'Lisbon, May',
    taken: '2026-05-10',
    status: 'kept',
    starred: false,
    keepsake: true,
  },
];
