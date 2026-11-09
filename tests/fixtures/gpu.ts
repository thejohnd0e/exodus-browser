import { it } from 'vitest';

// GitHub's windows-latest runner exposes only "Microsoft Hyper-V Video" and no GPU, so WebGL
// reports a null renderer there. Tests that assert real GPU vendor/renderer values run only where
// a GPU exists. The integration workflow sets EXODUS_TEST_GPU=none; locally the tests always run.
export const hasTestGpu = process.env.EXODUS_TEST_GPU !== 'none';
export const itWithGpu = hasTestGpu ? it : it.skip;
