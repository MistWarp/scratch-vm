const urlForLogs = url => (url.startsWith('data:') ? 'Custom extension' : url);

const loadScriptElement = url => new Promise((resolve, reject) => {
    const script = document.createElement('script');

    const handleWindowError = event => {
        if (document.currentScript !== script) return;
        if (event.error instanceof Error) {
            reject(new Error(`${urlForLogs(url)} encountered runtime error: ${event.error}`, {
                cause: event.error
            }));
        } else {
            reject(new Error(`${urlForLogs(url)} encountered runtime error: ${event.message}`));
        }
    };

    const removeWindowErrorHandler = () => {
        window.removeEventListener('error', handleWindowError);
    };
    window.addEventListener('error', handleWindowError);

    script.onload = () => {
        removeWindowErrorHandler();
        resolve();
    };

    script.onerror = () => {
        removeWindowErrorHandler();
        reject(new Error(`${urlForLogs(url)} could not be loaded, usually due to a network error`));
    };

    script.src = url;
    document.body.appendChild(script);
});

module.exports = loadScriptElement;
