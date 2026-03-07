const TESSERACT_NAME = 'Tesseract OCR';

function getLocalOcrInstallHint(platform = process.platform) {
  if (platform === 'darwin') {
    return 'brew install tesseract';
  }
  if (platform === 'win32') {
    return 'Install Tesseract OCR and add the tesseract command to PATH.';
  }
  return 'Install Tesseract OCR and ensure the tesseract command is available in PATH.';
}

async function extractOcrText(context = {}, filePath, includeOcr = true) {
  const { commandAvailable, runCommand } = context;
  const available = await commandAvailable('tesseract');
  if (!includeOcr || !available) {
    return '';
  }

  try {
    const ocrResult = await runCommand('tesseract', [filePath, 'stdout', '--psm', '6'], { timeoutMs: 20000 });
    if (ocrResult.code === 0) {
      return String(ocrResult.stdout || '').trim();
    }
  } catch {
    return '';
  }

  return '';
}

async function buildLocalOcrHealth(context = {}, platform = process.platform) {
  const { commandAvailable } = context;
  const available = await commandAvailable('tesseract');
  return {
    available,
    recommended: TESSERACT_NAME,
    install_hint: getLocalOcrInstallHint(platform),
  };
}

module.exports = {
  TESSERACT_NAME,
  buildLocalOcrHealth,
  extractOcrText,
  getLocalOcrInstallHint,
};
