'use strict';

importScripts('logic-gen.js', 'typical-core.js');

let result = null;
let download = null;

self.onmessage = ({ data }) => {
  const { id, action } = data;
  try {
    if (action === 'generate') {
      result = null;
      download = null;
      const generated = ICTypical.generate(data.config, new Set(data.lib), data.gateInputs, data.dffSelected);
      const rendered = ICLogic.renderSvg(generated.builder, generated.roots, generated.inNames, { netAliases: generated.feedback });
      result = generated;
      self.postMessage({ id, result: { ...generated, builder: { nodes: generated.builder.nodes } }, rendered });
    } else if (action === 'export') {
      if (!result) throw new Error('Generate a circuit before exporting.');
      if (!download) {
        download = ICLogic.renderSvg(result.builder, result.roots, result.inNames, { forDownload: true, netAliases: result.feedback });
      }
      self.postMessage({ id, rendered: download });
    } else {
      throw new Error('Unknown circuit worker request.');
    }
  } catch (error) {
    self.postMessage({ id, error: { message: error.message || String(error), reasons: error.reasons } });
  }
};
