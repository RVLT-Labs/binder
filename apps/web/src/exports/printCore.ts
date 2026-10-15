/**
 * The print half of core, behind one module so it can be imported dynamically: stamping pulls in
 * pdf-lib, which belongs in a chunk of its own, loaded when somebody prints, not in the main bundle.
 */
export { buildStampItems, layerSelectionLabel, stampScript } from '@binder/core'
