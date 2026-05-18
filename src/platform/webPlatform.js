function asBlob(content, mimeType = 'application/octet-stream') {
  if (content instanceof Blob) return content;
  return new Blob([content ?? ''], { type: mimeType });
}

function readWithFileReader(file, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader[method](file);
  });
}

async function downloadFile({ filename, mimeType = 'application/octet-stream', content }) {
  const blob = asBlob(content, mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function pickFile({ accept = '', multiple = false, inputElement = null } = {}) {
  if (inputElement) {
    inputElement.accept = accept || inputElement.accept || '';
    inputElement.multiple = !!multiple;
    inputElement.click();
    return [];
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    }, { once: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    }, { once: true });
    document.body.appendChild(input);
    try {
      input.click();
    } catch (err) {
      input.remove();
      reject(err);
    }
  });
}

async function shareFile({ filename, mimeType = 'application/octet-stream', content }) {
  const blob = asBlob(content, mimeType);
  if (navigator.canShare && navigator.share && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: mimeType });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  }
  await downloadFile({ filename, mimeType, content: blob });
}

function getCurrentPosition(options) {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('Geolocation is not supported'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export const webPlatform = {
  name: 'web',
  isNative: false,
  openExternalUrl(url) {
    window.open(url, '_blank', 'noopener');
  },
  downloadFile,
  pickFile,
  shareFile,
  readFileAsText(file) {
    return readWithFileReader(file, 'readAsText');
  },
  readFileAsArrayBuffer(file) {
    return readWithFileReader(file, 'readAsArrayBuffer');
  },
  getCurrentPosition,
  vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  },
  getNetworkStatus() {
    return {
      connected: navigator.onLine,
      connectionType: navigator.connection?.effectiveType || 'unknown',
    };
  },
  getUserAgent() {
    return navigator.userAgent || '';
  },
};
