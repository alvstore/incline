import { strict as assert } from 'node:assert';
import { BODY_GLOSSARY, POSTURE_GLOSSARY, zoneFor, parseSegments, round1 } from '../../src/lib/scans/glossary';
const g = (l: typeof BODY_GLOSSARY, k: string) => l.find((e) => e.key === k)!;
// Body lean -4.5 deg is outside 2 deg either side
assert.equal(zoneFor(g(POSTURE_GLOSSARY, 'body_slope'), -4.5, 'male'), 'high');
assert.equal(zoneFor(g(POSTURE_GLOSSARY, 'head_slant'), -1.3, 'male'), 'normal');
assert.equal(zoneFor(g(POSTURE_GLOSSARY, 'pelvis_forward'), 168.3, 'male'), 'low');
// Body fat bands are sex-specific
assert.equal(zoneFor(g(BODY_GLOSSARY, 'pbf'), 15.8, 'male'), 'normal');
assert.equal(zoneFor(g(BODY_GLOSSARY, 'pbf'), 15.8, 'female'), 'low');
assert.deepEqual(parseSegments('[0.4,0.3,7.3,1.7,1.7]'), [0.4, 0.3, 7.3, 1.7, 1.7]);
assert.equal(parseSegments('[1,2]'), null);
assert.equal(round1(0.96), 0.96);
assert.equal(round1(114.76145), 114.8);
console.log('scanGlossary ok');
