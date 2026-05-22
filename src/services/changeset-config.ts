/**
 * Silk `ChangesetConfig` service — re-exported from `@savvy-web/silk-effects`.
 *
 * The implementation now lives in the shared library; this module remains as the
 * stable local import path used by `changesets.ts` and `layers/app.ts`.
 * `ChangesetConfigLive` is composed with the library's `ChangesetConfigReader`
 * here so consumers only need to provide a platform `FileSystem`
 * (`NodeContext.layer`, provided by `makeAppLayer` and the integration tests).
 *
 * @module services/changeset-config
 */

import { ChangesetConfigReaderLive, ChangesetConfigLive as LibChangesetConfigLive } from "@savvy-web/silk-effects";
import { Layer } from "effect";

export type { ChangesetMode } from "@savvy-web/silk-effects";
export { ChangesetConfig } from "@savvy-web/silk-effects";

/**
 * Live `ChangesetConfig`, composed with its `FileSystem`-backed reader. Leaves a
 * `FileSystem` requirement to be satisfied where this layer is provided.
 */
export const ChangesetConfigLive = LibChangesetConfigLive.pipe(Layer.provide(ChangesetConfigReaderLive));
