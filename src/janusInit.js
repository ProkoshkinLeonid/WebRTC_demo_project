export function initJanus(server = 'ws://localhost:8188') {
    return new Promise((resolve, reject) => {
        if (!window.Janus) return reject(new Error('Janus not loaded'));

        window.Janus.init({
            debug: true,
            callback: function() {
                console.log('Janus initialized successfully');

                const janus = new window.Janus({
                    server,
                    success: function() {
                        console.log('Janus connected to server');
                        resolve(janus);
                    },
                    error: function(err) {
                        console.error('Janus connection error:', err);
                        reject(err);
                    },
                    destroyed: function() {
                        console.log('Janus destroyed');
                    },
                    // Добавляем обработчики для отладки
                    iceState: function(state) {
                        console.log('ICE state changed:', state);
                    },
                    webrtcState: function(on) {
                        console.log('WebRTC state:', on ? 'up' : 'down');
                    },
                    mediaState: function(medium, on) {
                        console.log('Media state:', medium, on ? 'on' : 'off');
                    },
                    slowLink: function(uplink, lost) {
                        console.log('Slow link:', uplink ? 'uplink' : 'downlink', lost);
                    }
                });
            }
        });
    });
}