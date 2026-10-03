import { z } from 'zod';

export const embeddingsOutput = (dim) => z.array(z.array(z.number().finite()).length(dim));
