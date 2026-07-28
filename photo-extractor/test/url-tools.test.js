import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidHttpUrl, isGooglePhotoUrl, isYelpPhotoUrl,
  parseGooglePhotoId, parseYelpPhotoId,
  toGoogleSize, toOriginalGoogle, toOriginalYelp, findYelpPhotoUrls,
} from '../core/url-tools.js';

const G_P = 'https://lh3.googleusercontent.com/p/AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ=w408-h306-k-no';
const G_GPS = 'https://lh5.googleusercontent.com/gps-cs-s/AC9h4noABCdef_12-3=s112-w112-h112-p-k-no';
const G_NOSUF = 'https://lh3.googleusercontent.com/p/AF1QipTOKEN';

test('isValidHttpUrl', () => {
  assert.equal(isValidHttpUrl('https://x.com/a'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('not a url'), false);
});

test('detects google photo urls', () => {
  assert.equal(isGooglePhotoUrl(G_P), true);
  assert.equal(isGooglePhotoUrl(G_GPS), true);
  assert.equal(isGooglePhotoUrl('https://example.com/x.jpg'), false);
});

test('parses google photo id from both prefixes', () => {
  assert.equal(parseGooglePhotoId(G_P), 'AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ');
  assert.equal(parseGooglePhotoId(G_GPS), 'AC9h4noABCdef_12-3');
});

test('toGoogleSize rewrites the suffix after the last =', () => {
  assert.equal(toOriginalGoogle(G_P), 'https://lh3.googleusercontent.com/p/AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ=s0');
  assert.equal(toOriginalGoogle(G_GPS), 'https://lh5.googleusercontent.com/gps-cs-s/AC9h4noABCdef_12-3=s0');
  assert.equal(toGoogleSize(G_P, 'w2048'), 'https://lh3.googleusercontent.com/p/AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ=w2048');
});

test('toGoogleSize appends = when no suffix present', () => {
  assert.equal(toOriginalGoogle(G_NOSUF), G_NOSUF + '=s0');
});

test('yelp detection + original upgrade', () => {
  const thumb = 'https://s3-media2.fl.yelpcdn.com/bphoto/CPc91bGzKBe95aM5edjhhQ/348s.jpg';
  assert.equal(isYelpPhotoUrl(thumb), true);
  assert.equal(parseYelpPhotoId(thumb), 'CPc91bGzKBe95aM5edjhhQ');
  assert.equal(toOriginalYelp(thumb), 'https://s3-media2.fl.yelpcdn.com/bphoto/CPc91bGzKBe95aM5edjhhQ/o.jpg');
});

test('findYelpPhotoUrls dedupes ids across srcset and script json, returns o.jpg', () => {
  const html = `
    <img srcset="https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/258s.jpg 1x,
                 https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/348s.jpg 1.3x">
    <script>{"photoUrl":"https://s3-media3.fl.yelpcdn.com/bphoto/ZZZ999zzz_yyy-XXX/ls.jpg"}</script>
    <img src="https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/o.jpg">`;
  const got = findYelpPhotoUrls(html).map((p) => p.url).sort();
  assert.deepEqual(got, [
    'https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/o.jpg',
    'https://s3-media3.fl.yelpcdn.com/bphoto/ZZZ999zzz_yyy-XXX/o.jpg',
  ]);
});
