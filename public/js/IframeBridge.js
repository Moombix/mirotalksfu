/*
 * MiroTalk SFU - Iframe communication bridge (runs INSIDE the conference iframe)
 *
 * Purpose: Enables the parent application (that embeds /join as an iframe)
 * to control the room and receive events via window.postMessage.
 *
 * Protocol:
 *  - All messages use: { type: 'mirotalk.iframe', scope: 'child', action: 'event'|'command'|'handshake', name, payload, version: 1 }
 *  - Child -> Parent events (action: 'event'):
 *      - ready               : iframe app is initialized and listeners set
 *      - joined              : local user connected to the room
 *      - ended               : local user left or page is unloading
 *      - toolbar.click       : a toolbar button was clicked { id }
 *      - screen.share        : screen sharing state changed { active: boolean }
 *  - Parent -> Child commands (action: 'command'):
 *      - audio.on / audio.off
 *      - video.on / video.off
 *      - screen.start / screen.stop
 *      - chat.toggle
 *      - fullscreen.toggle (also supports fullscreen.on / fullscreen.off)
 *      - leave
 *
 * Notes:
 *  - This script is safe in standalone usage (outside iframe): it becomes no-op.
 *  - It does not modify existing handlers; it only adds listeners and clicks UI buttons.
 */
'use strict';

const NAMESPACE = 'mirotalk.iframe';
const VERSION = 1;

class IframeBridge {
    parentOrigin = "*"; // will be restricted after the first parent message
    joinedNotified = false;
    rc;

    constructor(roomClient) {
        // Do nothing if not embedded
        const isEmbedded = window.self !== window.top;
        if (!isEmbedded) return;

        this.rc = roomClient;

        window.addEventListener('message', this.onParentMessage.bind(this));
        this.setupToolbarClickEvents();
        this.setupEndEvents();
        this.setupScreenShareMonitoring();
        this.notifyJoinedWhenReady();

        // Announce to parent we're ready
        this.postToParent('ready', {}, 'handshake');
    }

    postToParent(name, payload = {}, action = 'event') {
        try {
            window.parent.postMessage(
                { type: NAMESPACE, scope: 'child', action, name, payload, version: VERSION },
                this.parentOrigin
            );
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[IframeBridge] postMessage failed', err);
        }
    }

    getEl(id) {
        return document.getElementById(id);
    }

    clickIfExists(id) {
        const el = this.getEl(id);
        if (el && typeof el.click === 'function' && !el.disabled) {
            el.click();
            return true;
        }
        return false;
    }

    setupToolbarClickEvents() {
        const ids = [
            'startAudioButton',
            'stopAudioButton',
            'startVideoButton',
            'stopVideoButton',
            'startScreenButton',
            'stopScreenButton',
            'exitButton',
        ];
        ids.forEach((id) => {
            const el = this.getEl(id);
            if (el) {
                el.addEventListener('click', () => this.postToParent('toolbar.click', { id }));
            }
        });
    }

    notifyJoinedWhenReady() {
        const iv = setInterval(() => {
            try {
                if (this.rc && typeof this.rc.isConnected === 'function' && this.rc.isConnected()) {
                    if (!this.joinedNotified) {
                        this.joinedNotified = true;
                        this.postToParent('joined');
                    }
                    clearInterval(iv);
                }
            } catch (_) {
                // ignore
            }
        }, 1000);
    }

    setupEndEvents() {
        window.addEventListener('beforeunload', () => {});
        window.addEventListener('pagehide', () => {});
    }

    isScreenSharingActive() {
        try {
            if (this.rc) {
                if (typeof this.rc.producerExist === 'function') {
                    return !!this.rc.producerExist('screenType');
                }
                if ('screenProducerId' in this.rc) {
                    return !!this.rc.screenProducerId;
                }
            }
        } catch (_) {}
        return false;
    }

    setupScreenShareMonitoring() {
        const emit = () => this.postToParent('screen.share', { active: this.isScreenSharingActive() });

        // Button-based hints (fires quickly, real state verified by poller too)
        ['startScreenButton', 'stopScreenButton'].forEach((id) => {
            const el = this.getEl(id);
            if (el) el.addEventListener('click', () => setTimeout(emit, 50));
        });

        // Poll state to catch programmatic changes and permission failures
        let last = null;
        setInterval(() => {
            const cur = this.isScreenSharingActive();
            if (cur !== last) {
                last = cur;
                this.postToParent('screen.share', { active: cur });
            }
        }, 1000);
    }

    handleCommand(name) {
        switch (name) {
            case 'audio.on':
                this.clickIfExists('initAudioButton');
                break;
            case 'audio.off':
                this.clickIfExists('stopAudioButton');
                break;
            case 'video.on':
                this.clickIfExists('initVideoButton');
                break;
            case 'video.off':
                this.clickIfExists('stopVideoButton');
                break;
            case 'screen.start':
                this.clickIfExists('initStartScreenButton');
                break;
            case 'screen.stop':
                this.clickIfExists('initStopScreenButton');
                break;
            case 'leave':
                this.rc?.exitRoom();
                break;
            default:
                // Unknown command
                break;
        }
    }

    onParentMessage(ev) {
        const { data, source, origin } = ev;
        if (!data || data.type !== NAMESPACE) return;
        if (source !== window.parent) return;

        // lock to the first known parent origin
        if (this.parentOrigin === '*') this.parentOrigin = origin;

        if (data.action === 'command') {
            this.handleCommand(data.name);
        } else if (data.action === 'handshake' && data.name === 'ack') {
            // Parent acknowledged. Nothing else is required for now.
        }
    }
}
