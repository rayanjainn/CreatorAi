import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// search(query, { limit? }) -> { query, results: [{ title, url, snippet }] }
export const getWebSearch = () => pick(real, fake);
