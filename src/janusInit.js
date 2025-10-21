export function initJanus(server = 'ws://localhost:8188') {
    return new Promise((resolve, reject) => {
        if (!window.Janus) return reject(new Error('Janus не загрузился'));

        window.Janus.init({
            debug: true,
            callback: function() {
                console.log('Janus успешно инициализировался');

                const janus = new window.Janus({
                    server,
                    success: function() {
                        console.log('Janus подключился к серверу');
                        resolve(janus);
                    },
                    error: function(err) {
                        console.error('Janus ошибка подключения:', err);
                        reject(err);
                    },
                    destroyed: function() {
                        console.log('Janus разрушен');
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