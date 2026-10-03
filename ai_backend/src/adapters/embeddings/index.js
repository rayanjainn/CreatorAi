import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// embedTexts(texts[]) -> number[EMBED_DIM][]
// embedImages(urls[]) -> number[EMBED_DIM][]
export const getEmbeddings = () => pick(real, fake);
