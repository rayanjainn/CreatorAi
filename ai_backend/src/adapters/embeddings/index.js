import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// embedTexts(texts[]) -> number[EMBED_DIM][]
// embedImages(urls[]) -> number[EMBED_DIM][]  (rejects with code 'unsupported' when the
//                                              model cannot embed images)
// supportsImages()    -> boolean
// fake only: seed(input, vector), setImageSupport(bool), failNext(...errors), calls, reset()
export const getEmbeddings = () => pick(real, fake);
