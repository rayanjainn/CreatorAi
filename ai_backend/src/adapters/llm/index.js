import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// completeJson({ system?, prompt, model?, temperature?, images?, timeoutMs? })
//   -> { json, text, provider, model, usage }
export const getLlm = () => pick(real, fake);
