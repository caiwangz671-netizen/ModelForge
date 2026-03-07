const { buildLocalOcrHealth, extractOcrText } = require('./common');

function createUnsupportedDriver(context = {}) {
  const { captureDesktopImageToFile, getDisplayCoordinateSpace } = context;

  async function captureSnapshot(filePath, includeOcr, options = {}) {
    const capture = await captureDesktopImageToFile(filePath, options);
    if (!capture.ok) {
      return capture;
    }

    const ocrText = await extractOcrText(context, filePath, includeOcr);

    return {
      ...capture,
      ocr_text: ocrText,
      summary: ocrText ? ocrText.slice(0, 800) : 'Screenshot captured',
    };
  }

  async function createHealthPayload() {
    const ocr = await buildLocalOcrHealth(context, process.platform);
    return {
      ok: true,
      platform: process.platform,
      desktop_available: false,
      snapshot_available: true,
      controlled_browser_available: true,
      coordinate_space: getDisplayCoordinateSpace(),
      ocr,
      permissions: {
        accessibility: null,
        screen_recording: null,
      },
      limitations: [
        'Native desktop input automation is not available in this runtime.',
      ],
    };
  }

  function unsupported(action) {
    return {
      ok: false,
      platform: process.platform,
      error: `${action} is not available in this runtime`,
    };
  }

  return {
    platform: process.platform,
    createHealthPayload,
    captureSnapshot,
    queryState: async () => unsupported('query-state'),
    postMouseClick: async () => unsupported('click'),
    postScroll: async () => unsupported('scroll'),
    postType: async () => unsupported('type'),
    postKeypress: async () => unsupported('keypress'),
    openApp: async () => unsupported('open-app'),
    requestPermissions: async () => ({
      ok: true,
      permissions: {
        accessibility: null,
        screen_recording: null,
      },
      skipped: true,
    }),
  };
}

module.exports = {
  createUnsupportedDriver,
};
