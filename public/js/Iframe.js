class IframeApi {
    static DEFAULT_OPTIONS = {
        room: 'default-room',
        roomPassword: false,
        name: 'guest',
        audio: false,
        video: false,
        screen: false,
        chat: false,
        hide: false,
        notify: false,
        duration: 'unlimited',
        width: '100vw',
        height: '100vh',
        token: null,
        parentNode: null,
    };

    constructor(domain, options = {}) {
        if (!domain) {
            throw new Error('Domain is required');
        }

        this.domain = domain;
        this.protocol = 'https';
        this.options = { ...IframeApi.DEFAULT_OPTIONS, ...options };

        if (!this.isValidParentNode()) {
            throw new Error('Invalid parent node provided');
        }
        // Messaging state
        this._events = new Map();
        this._once = new Map();
        this._ready = false;
        this._queue = [];
        this._childOrigin = `${this.protocol}://${this.domain}`;
        this._onMessage = (ev) => this._handleMessage(ev);

        this.init();
    }

    init() {
        const params = this.buildParams();
        const iframe = this.createIframe(params);
        this.iframe = iframe;

        this.clearParentNode();
        this.appendIframeToParentNode(iframe);

        // Setup message listener once iframe is appended
        window.addEventListener('message', this._onMessage);
    }

    // ============= Public API: Events =============
    on(event, handler) {
        if (!this._events.has(event)) this._events.set(event, new Set());
        this._events.get(event).add(handler);
        return this;
    }

    off(event, handler) {
        if (this._events.has(event)) this._events.get(event).delete(handler);
        return this;
    }

    once(event, handler) {
        if (!this._once.has(event)) this._once.set(event, new Set());
        this._once.get(event).add(handler);
        return this;
    }

    send(name, payload = {}) {
        const msg = { type: 'mirotalk.iframe', scope: 'parent', action: 'command', name, payload, version: 1 };
        if (!this._ready) {
            this._queue.push(msg);
            return this;
        }
        try {
            this.iframe.contentWindow.postMessage(msg, this._childOrigin);
        } catch (err) {
            console.warn('[IframeApi] postMessage failed', err);
        }
        return this;
    }

    startAudio() { return this.send('audio.on'); }
    stopAudio() { return this.send('audio.off'); }
    startVideo() { return this.send('video.on'); }
    stopVideo() { return this.send('video.off'); }
    startScreen() { return this.send('screen.start'); }
    stopScreen() { return this.send('screen.stop'); }
    leave() { return this.send('leave'); }

    destroy() {
        window.removeEventListener('message', this._onMessage);
        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        this._events.clear();
        this._once.clear();
    }

    // ============= Internal =============
    _emit(event, payload) {
        if (this._events.has(event)) {
            for (const h of this._events.get(event).values()) {
                try { h(payload); } catch (e) { /* ignore */ }
            }
        }
        if (this._once.has(event)) {
            for (const h of this._once.get(event).values()) {
                try { h(payload); } catch (e) { /* ignore */ }
            }
            this._once.delete(event);
        }
    }

    _handleMessage(ev) {
        const { data, origin, source } = ev;
        if (!data || data.type !== 'mirotalk.iframe') return;
        if (!this.iframe || source !== this.iframe.contentWindow) return;
        // Allow only messages from the expected child origin
        if (origin !== this._childOrigin) return;

        if (data.action === 'handshake' && data.name === 'ready') {
            // Child is ready -> send ack and flush queue
            try {
                this.iframe.contentWindow.postMessage({ type: 'mirotalk.iframe', scope: 'parent', action: 'handshake', name: 'ack', version: 1 }, this._childOrigin);
            } catch (_) {}
            this._ready = true;
            // Flush queued commands
            while (this._queue.length) {
                const msg = this._queue.shift();
                try {
                    this.iframe.contentWindow.postMessage(msg, this._childOrigin);
                } catch (_) {}
            }
            this._emit('ready');

            return;
        }

        if (data.action === 'event') {
            // Forward child events to external listeners
            this._emit(data.name, data.payload);
        }
    }

    isValidParentNode() {
        return this.options.parentNode instanceof HTMLElement;
    }

    buildParams() {
        const params = new URLSearchParams({
            room: this.options.room,
            roomPassword: this.options.roomPassword,
            name: this.options.name,
            audio: this.options.audio ? 1 : 0,
            video: this.options.video ? 1 : 0,
            screen: this.options.screen ? 1 : 0,
            chat: this.options.chat ? 1 : 0,
            hide: this.options.hide ? 1 : 0,
            notify: this.options.notify ? 1 : 0,
            duration: this.options.duration,
        });

        if (this.options.token) {
            params.append('token', this.options.token);
        }

        return params;
    }

    createIframe(params) {
        const url = new URL(`${this.protocol}://${this.domain}/join`);
        url.search = params.toString();

        const iframe = document.createElement('iframe');
        iframe.src = url.toString();
        iframe.allow =
            'camera; microphone; display-capture; fullscreen; clipboard-read; clipboard-write; web-share; autoplay';
        iframe.style.width = this.options.width;
        iframe.style.height = this.options.height;
        iframe.style.border = '0px';

        // Optional: Add event listeners for loading and error states
        iframe.addEventListener('load', () => console.log('Iframe loaded successfully'));
        iframe.addEventListener('error', () => console.error('Iframe failed to load'));

        return iframe;
    }

    clearParentNode() {
        this.options.parentNode.innerHTML = '';
    }

    appendIframeToParentNode(iframe) {
        this.options.parentNode.appendChild(iframe);
    }

    getIframeNode() {
        return this.iframe;
    }
}
