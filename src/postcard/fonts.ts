/**
 * Old Standard — шрифт в духе русских книг и открыток 1900-х, с ятями (лицензия OFL).
 * Лежит рядом с сайтом, а не на чужих серверах.
 */
import cyr400 from '@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-400-normal.woff2?url';
import cyrExt400 from '@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-ext-400-normal.woff2?url';
import lat400 from '@fontsource/old-standard-tt/files/old-standard-tt-latin-400-normal.woff2?url';
import cyr400i from '@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-400-italic.woff2?url';
import cyrExt400i from '@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-ext-400-italic.woff2?url';
import lat400i from '@fontsource/old-standard-tt/files/old-standard-tt-latin-400-italic.woff2?url';
import cyr700 from '@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-700-normal.woff2?url';
import cyrExt700 from '@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-ext-700-normal.woff2?url';
import lat700 from '@fontsource/old-standard-tt/files/old-standard-tt-latin-700-normal.woff2?url';

export const OLD = '"Old Standard TT", Georgia, "Times New Roman", serif';

const CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const CYR_EXT = 'U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

let loading: Promise<void> | null = null;

export function loadOldStandard(): Promise<void> {
  if (loading) return loading;
  const faces: [string, string, string, string][] = [
    [cyr400, CYR, 'normal', '400'],
    [cyrExt400, CYR_EXT, 'normal', '400'],
    [lat400, LAT, 'normal', '400'],
    [cyr400i, CYR, 'italic', '400'],
    [cyrExt400i, CYR_EXT, 'italic', '400'],
    [lat400i, LAT, 'italic', '400'],
    [cyr700, CYR, 'normal', '700'],
    [cyrExt700, CYR_EXT, 'normal', '700'],
    [lat700, LAT, 'normal', '700'],
  ];
  loading = Promise.all(
    faces.map(([url, range, style, weight]) => {
      const f = new FontFace('Old Standard TT', `url(${url})`, { unicodeRange: range, style, weight });
      document.fonts.add(f);
      return f.load().catch(() => undefined);
    }),
  ).then(() => undefined);
  return loading;
}
