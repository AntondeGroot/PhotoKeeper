export interface AiHint {
  verdict: 'kept' | 'rejected' | 'toEdit';
  reason: string;
}

export type ReviewStatus = 'backlog' | 'kept' | 'rejected' | 'toEdit' | 'toPrint' | 'maybe';

export type ReviewItem = Photo | Burst | Pano | Stereo;

/** A single photo pulled from a local device folder (no Lightroom rendition to fetch). */
export function isDevicePhoto(item: ReviewItem): boolean {
  return item.kind === 'photo' && item.source === 'device';
}

/** Every real asset id a review unit references — its own, or all the frames of a group. */
export function unitAssetIds(item: ReviewItem): string[] {
  switch (item.kind) {
    case 'photo':
      // An edit and its original are one unit: both are warmed, both are excluded from later draws,
      // and a verdict on the unit covers the pair — you sort the shot, not each file Lightroom wrote.
      return item.edit ? [item.id, item.edit.originalId] : [item.id];
    case 'burst':
      return item.photos.map((p) => p.id);
    case 'pano':
      return item.frames.map((f) => f.id);
    case 'stereo':
      return [...item.left, ...item.baselines.flatMap((b) => b.frames)].map((f) => f.id);
  }
}

/**
 * Splits an original filename into its display name and extension (without the dot). A name with no
 * usable extension (no dot, a leading dot, or a trailing dot) yields no `ext`. Used so the cards can
 * show the real source extension (e.g. `IMG_4044.CR2`) instead of a cosmetic placeholder.
 */
export function splitFileName(fileName: string): { name: string; ext?: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return { name: fileName };
  return { name: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export interface Burst {
  id: string;
  name: string; // without extension
  album: string | null;
  taken: string; // ISO 8601, e.g. '2026-05-24'
  status: ReviewStatus;
  kind: 'burst';
  photos: BurstPhoto[];
}

export interface PanoFrame {
  id: string;
  name: string; // without extension
  ext?: string; // original file extension without the dot, e.g. 'CR2'
  blur?: boolean;
}

export interface Pano {
  id: string;
  name: string;
  album: string | null;
  taken: string;
  status: ReviewStatus;
  kind: 'pano';
  orientation: 'horizontal' | 'vertical';
  frames: PanoFrame[];
}

export interface BurstPhoto {
  id: string;
  name: string; // without extension
  ext?: string; // original file extension without the dot, e.g. 'CR2'
  blur?: boolean;
  ai?: AiHint;
}

/**
 * A generated stand-in "photograph" — a stylised landscape drawn as SVG — for mock photos that have no
 * real rendition (e.g. device photos in the web PoC). Mirrors the prototype's Scene: a sky wash, a sun,
 * and one of five horizon variants, tinted by the colours below. Purely decorative.
 */
export interface PhotoScene {
  variant: 'peaks' | 'coast' | 'dunes' | 'forest' | 'city';
  sky: string;
  far: string;
  near: string;
  sun: string;
  sunX: number;
  sunY: number;
  blur?: boolean;
  birds?: boolean;
}

export interface Photo {
  id: string;
  name: string; // without extension
  ext?: string; // original file extension without the dot, e.g. 'CR2'
  album: string | null;
  taken: string; // ISO 8601, e.g. '2026-05-24'
  status: ReviewStatus;
  kind: 'photo';
  starred: boolean;
  // "Keep it, but don't print it." Not asked during sorting — whether a photo is worth paper is a
  // judgement about the album, made once it is finished, so it belongs to the Prints tab's pass.
  // Printing is the default, hence a flag for the exception rather than one for the rule.
  saveOnly: boolean;
  ai?: AiHint;
  // 'device' marks a photo pulled from a local device folder rather than Lightroom; for those `album`
  // holds the folder name. Absent/'lightroom' for catalogue assets.
  source?: 'lightroom' | 'device';
  // A generated SVG scene to draw when there's no real preview (mock device photos).
  scene?: PhotoScene;
  // Set when this photo is a Lightroom edit written beside its original (e.g. an -Enhanced-NR DNG
  // next to the NEF it came from). The unit shows the edit — that is the version worth keeping —
  // and holds on to the original so the two can be compared before deciding.
  edit?: EditedFrom;
}

/** The untouched file a Lightroom edit was derived from. */
export interface EditedFrom {
  originalId: string;
  originalName: string; // without extension
  originalExt?: string;
}

/** A local device folder the user can opt into reviewing, with a (mock) photo count. */
export interface DeviceFolder {
  name: string;
  count: number;
  enabled: boolean;
}

/**
 * Mock device folders, standing in for the system folder picker a native build would use. The web PoC
 * can't read a real phone's albums, so these are fixed stand-ins whose enabled flags + the master
 * device toggle decide which {@link DEVICE_PHOTOS} join the review deck.
 */
export const DEVICE_FOLDERS: DeviceFolder[] = [
  { name: 'Camera', count: 1284, enabled: true },
  { name: 'WhatsApp Images', count: 3407, enabled: true },
  { name: 'Screenshots', count: 912, enabled: false },
  { name: 'Downloads', count: 236, enabled: false },
];

/** Mock on-device photos, added to the deck when their folder is enabled (see DEVICE_FOLDERS). */
export const DEVICE_PHOTOS: Photo[] = [
  {
    id: 'DEV_5304',
    name: '20260530_184412',
    album: 'Camera',
    taken: '2026-05-30',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    source: 'device',
    ai: { verdict: 'kept', reason: 'Decent snapshot — worth uploading' },
    scene: {
      variant: 'forest',
      sky: '#B8CCB4',
      far: '#33503C',
      near: '#26392E',
      sun: '#EBE4C0',
      sunX: 200,
      sunY: 88,
    },
  },
  {
    id: 'DEV_5305',
    name: '20260601_120301',
    album: 'Camera',
    taken: '2026-06-01',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    source: 'device',
    ai: { verdict: 'rejected', reason: 'Shaky — straight to trash' },
    scene: {
      variant: 'dunes',
      sky: '#DFB088',
      far: '#A87648',
      near: '#74502C',
      sun: '#F4DCA2',
      sunX: 100,
      sunY: 96,
      blur: true,
    },
  },
  {
    id: 'DEV_WA41',
    name: 'IMG-20260602-WA0041',
    album: 'WhatsApp Images',
    taken: '2026-06-02',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    source: 'device',
    ai: { verdict: 'toEdit', reason: 'Nice night scene — import to Lightroom' },
    scene: {
      variant: 'city',
      sky: '#34304A',
      far: '#1C1A2C',
      near: '#282436',
      sun: '#E6BE66',
      sunX: 226,
      sunY: 74,
    },
  },
  {
    id: 'DEV_SC18',
    name: 'Screenshot_20260603_0918',
    album: 'Screenshots',
    taken: '2026-06-03',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    source: 'device',
    ai: { verdict: 'rejected', reason: 'Screenshot — not a photo to keep' },
    scene: {
      variant: 'peaks',
      sky: '#9FB6C9',
      far: '#54657A',
      near: '#39455A',
      sun: '#EFEAD8',
      sunX: 60,
      sunY: 70,
    },
  },
  {
    id: 'DEV_DL07',
    name: 'download_sunset_4k',
    album: 'Downloads',
    taken: '2026-06-04',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    source: 'device',
    scene: {
      variant: 'coast',
      sky: '#E3B98C',
      far: '#B07F4E',
      near: '#7C5530',
      sun: '#F5E3B0',
      sunX: 90,
      sunY: 100,
      birds: true,
    },
  },
];

export interface AlbumGroup {
  album: string;
  photos: Photo[];
}

export const MOCK_PHOTOS: Photo[] = [
  {
    id: 'IMG_4021',
    name: 'IMG_4021',
    ext: 'CR2',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    ai: {
      verdict: 'kept',
      reason: 'Tack sharp, strong golden light',
    },
  },
  {
    id: 'IMG_4022',
    name: 'IMG_4022',
    ext: 'CR2',
    album: null,
    taken: '2026-03-15',
    status: 'backlog',
    kind: 'photo',
    starred: true,
    saveOnly: false,
  },
  {
    id: 'IMG_4038',
    name: 'IMG_4038',
    ext: 'CR2',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
    ai: {
      verdict: 'rejected',
      reason: 'Motion blur on subject, flat light',
    },
  },
  {
    id: 'IMG_4090',
    name: 'IMG_4090',
    ext: 'CR2',
    album: 'Lisbon, May',
    taken: '2026-05-10',
    status: 'kept',
    kind: 'photo',
    starred: false,
    saveOnly: true,
  },
];

export const MOCK_PANO: Pano = {
  id: 'pano1',
  name: 'Panorama · 4 frames',
  album: 'Peaks',
  taken: '2026-05-24',
  status: 'backlog',
  kind: 'pano',
  orientation: 'horizontal',
  frames: [
    { id: 'pn1', name: 'DSC_5001', ext: 'NEF' },
    { id: 'pn2', name: 'DSC_5002', ext: 'NEF' },
    { id: 'pn3', name: 'DSC_5003', ext: 'NEF', blur: true },
    { id: 'pn4', name: 'DSC_5004', ext: 'NEF' },
  ],
};

export interface StereoFrame {
  id: string;
  name: string; // without extension
  ext?: string; // original file extension without the dot, e.g. 'CR2'
}

export interface StereoBaseline {
  key: string;
  label: string;
  hint: string;
  frames: StereoFrame[];
}

export interface Stereo {
  id: string;
  name: string;
  album: string | null;
  taken: string;
  status: ReviewStatus;
  kind: 'stereo';
  left: StereoFrame[];
  baselines: StereoBaseline[];
  // Present only for a twin-DSLR rig: the two body serials, so the workbench can offer a left/right swap
  // (persisted per album). `leftSerial` is the body currently shown as the left eye. Absent for drone/cha-cha.
  rig?: { leftSerial: string; rightSerial: string };
}

export const MOCK_STEREO: Stereo = {
  id: 'stereo1',
  name: 'Stereo set · 7 frames',
  album: 'Field work',
  taken: '2026-05-24',
  status: 'backlog',
  kind: 'stereo',
  left: [
    { id: 's1', name: 'DSC_6001', ext: 'NEF' },
    { id: 's2', name: 'DSC_6002', ext: 'NEF' },
    { id: 's3', name: 'DSC_6003', ext: 'NEF' },
  ],
  baselines: [
    {
      key: '3m',
      label: '3 m',
      hint: '2 frames',
      frames: [
        { id: 's4', name: 'DSC_6004', ext: 'NEF' },
        { id: 's5', name: 'DSC_6005', ext: 'NEF' },
      ],
    },
    {
      key: '10m',
      label: '10 m',
      hint: '2 frames',
      frames: [
        { id: 's6', name: 'DSC_6006', ext: 'NEF' },
        { id: 's7', name: 'DSC_6007', ext: 'NEF' },
      ],
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
      ext: 'CR2',
      ai: { verdict: 'kept', reason: 'Best of burst — level horizon' },
    },
    { id: 'b2', name: 'IMG_4045', ext: 'CR2' },
    { id: 'b3', name: 'IMG_4046', ext: 'CR2', blur: true },
  ],
};
