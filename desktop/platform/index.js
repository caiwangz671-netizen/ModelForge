const { createMacDriver } = require('./mac');
const { createWindowsDriver } = require('./windows');
const { createUnsupportedDriver } = require('./unsupported');

function createDesktopDriver(context = {}) {
  if (process.platform === 'darwin') {
    return createMacDriver(context);
  }

  if (process.platform === 'win32') {
    return createWindowsDriver(context);
  }

  return createUnsupportedDriver(context);
}

module.exports = {
  createDesktopDriver,
};
