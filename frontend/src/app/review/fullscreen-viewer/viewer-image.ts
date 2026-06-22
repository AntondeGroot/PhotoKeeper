import { SafeUrl } from '@angular/platform-browser';

/** One image shown in the full-screen viewer: its label (e.g. the filename, or "A"/"B" for a burst
 *  compare) and its preview URL (null/undefined until the rendition has loaded). */
export interface ViewerImage {
  label: string;
  url: SafeUrl | null | undefined;
}
