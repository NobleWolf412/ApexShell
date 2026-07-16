// Apex — small, provider-neutral services offered to extension main modules.
// Keep this module Electron-free so path and picker behavior can be exercised
// headlessly without booting the shell.
'use strict';

const path = require('path');

function stateDirFor(root, folder) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new Error('Extension state root must be an absolute path.');
  if (typeof folder !== 'string' || !folder || folder === '.' || folder === '..' ||
      path.basename(folder) !== folder)
    throw new Error('Extension folder must be one path segment.');

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, folder);
  if (path.dirname(candidate) !== resolvedRoot)
    throw new Error('Extension state directory escaped its root.');
  return candidate;
}

async function chooseDirectory(dialog, options) {
  if (!dialog || typeof dialog.showOpenDialog !== 'function')
    throw new Error('Directory picker is unavailable.');

  const input = options && typeof options === 'object' ? options : {};
  const pickerOptions = {
    title: typeof input.title === 'string' && input.title.trim()
      ? input.title.trim()
      : 'Choose a folder',
    properties: ['openDirectory', 'createDirectory'],
  };
  if (typeof input.defaultPath === 'string' && path.isAbsolute(input.defaultPath))
    pickerOptions.defaultPath = input.defaultPath;

  const result = await dialog.showOpenDialog(pickerOptions);
  if (!result || result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0])
    return null;
  return path.resolve(result.filePaths[0]);
}

module.exports = { stateDirFor, chooseDirectory };

