import React, {useEffect, useRef, useState} from 'react'
import { initJanus } from '../janusInit'

export default function Doctor({roomId, display}){
    const localRef = useRef()
    const remoteRef = useRef()
    const [status, setStatus] = useState('Initializing...')
    const [patientFeed, setPatientFeed] = useState(null)
    const [localStream, setLocalStream] = useState(null)

    const janusRef = useRef(null)
    const publisherHandleRef = useRef(null)
    const subscriberHandleRef = useRef(null)
    const remoteStreamRef = useRef(new MediaStream())

    useEffect(() => {
        let mounted = true;

        const initialize = async () => {
            try {
                setStatus('Connecting to Janus...');
                const janusInstance = await initJanus();

                if (!mounted) return;

                janusRef.current = janusInstance;
                console.log('✅ Janus connected');

                await setupPublisher(janusInstance);

            } catch (err) {
                console.error('❌ Initialization error', err);
                setStatus('Error: ' + err.message);
            }
        };

        initialize();

        return () => {
            mounted = false;
            cleanup();
        };
    }, [roomId, display]);

    // Эффект для локального потока
    useEffect(() => {
        if (localStream && localRef.current) {
            console.log('🎥 Setting local stream to video element');
            localRef.current.srcObject = localStream;
            localRef.current.play().catch(e => console.log('Local play error:', e));
        }
    }, [localStream]);

    // Эффект для удаленного потока
    useEffect(() => {
        if (remoteRef.current && remoteStreamRef.current.getTracks().length > 0) {
            console.log('📡 Setting remote stream to video element');
            remoteRef.current.srcObject = remoteStreamRef.current;
            remoteRef.current.play().catch(e => console.log('Remote play error:', e));
        }
    }, [patientFeed]);

    async function setupPublisher(janusInstance) {
        try {
            setStatus('Setting up publisher...');

            const handle = await new Promise((resolve, reject) => {
                janusInstance.attach({
                    plugin: 'janus.plugin.videoroom',
                    opaqueId: 'doctor-publisher-' + Date.now(),
                    success: function(handle) {
                        console.log('✅ Publisher plugin attached');
                        resolve(handle);
                    },
                    error: function(err) {
                        reject(err);
                    }
                });
            });

            publisherHandleRef.current = handle;

            handle.onmessage = (msg, jsep) => {
                console.log('📨 Publisher message:', msg);

                if(msg.videoroom === 'joined'){
                    setStatus('✅ Joined room as publisher');
                    console.log('Publisher ID:', handle.getId());

                    const pubs = msg.publishers || [];
                    console.log('📹 Available publishers:', pubs);

                    if(pubs.length > 0){
                        pubs.forEach(pub => {
                            if(pub.id !== handle.getId()) {
                                setupSubscriber(janusInstance, pub.id);
                            }
                        });
                    } else {
                        setStatus('⏳ Waiting for patient...');
                    }
                }
                else if(msg.videoroom === 'event'){
                    console.log('🔄 Room event:', msg);
                    if(msg.publishers){
                        msg.publishers.forEach(p => {
                            if(p.id !== handle.getId()) {
                                setupSubscriber(janusInstance, p.id);
                            }
                        });
                    }
                }

                if(jsep){
                    console.log('🔧 Handling publisher JSEP');
                    handle.handleRemoteJsep({ jsep });
                }
            };

            // Входим в комнату
            console.log('🚪 Joining room as publisher...');
            handle.send({
                message: {
                    request: 'join',
                    room: roomId,
                    ptype: 'publisher',
                    display: display || 'Doctor'
                }
            });

        } catch (error) {
            console.error('❌ Publisher setup error:', error);
            setStatus('Error setting up publisher');
        }
    }

    function setupSubscriber(janusInstance, feedId) {
        if(subscriberHandleRef.current) {
            console.log('🔄 Subscriber already exists, cleaning up...');
            subscriberHandleRef.current.detach();
            remoteStreamRef.current = new MediaStream();
        }

        console.log('🔍 Setting up subscriber for feed:', feedId);
        setStatus('🔗 Connecting to patient...');

        janusInstance.attach({
            plugin: 'janus.plugin.videoroom',
            opaqueId: 'doctor-subscriber-' + Date.now(),
            success: function(remoteHandle) {
                subscriberHandleRef.current = remoteHandle;
                console.log('✅ Subscriber attached');

                // ПЕРЕХВАТЫВАЕМ СОЗДАНИЕ PEERCONNECTION через webrtcState
                remoteHandle.webrtcState = function(on) {
                    console.log('📡 WebRTC state changed:', on);
                    if (on && remoteHandle.webrtcStuff && remoteHandle.webrtcStuff.pc) {
                        const pc = remoteHandle.webrtcStuff.pc;
                        console.log('✅ PeerConnection established');

                        // СЛУШАЕМ СОБЫТИЯ ТРЕКОВ
                        pc.ontrack = (event) => {
                            console.log('🎯 PeerConnection ontrack event fired');
                            console.log('📡 Event streams:', event.streams);
                            console.log('🎯 Event track:', event.track);

                            if (event.track) {
                                console.log('✅ Adding track to remote stream:', event.track.kind);
                                if (!remoteStreamRef.current.getTracks().includes(event.track)) {
                                    remoteStreamRef.current.addTrack(event.track);
                                    setPatientFeed(feedId);
                                    setStatus('✅ Patient video track received!');
                                }
                            }

                            if (event.streams && event.streams[0]) {
                                console.log('✅ Stream from event:', event.streams[0]);
                                const stream = event.streams[0];
                                stream.getTracks().forEach(track => {
                                    if (!remoteStreamRef.current.getTracks().includes(track)) {
                                        console.log('🎯 Adding track from stream:', track.kind);
                                        remoteStreamRef.current.addTrack(track);
                                    }
                                });
                                setPatientFeed(feedId);
                                setStatus('✅ Patient video stream received!');
                            }
                        };

                        // Также добавляем существующие треки
                        setTimeout(() => {
                            const receivers = pc.getReceivers();
                            console.log('🎯 Checking existing receivers:', receivers.length);
                            receivers.forEach((receiver, index) => {
                                if (receiver.track && receiver.track.readyState === 'live') {
                                    console.log(`🎯 Existing receiver track ${index}:`, receiver.track.kind);
                                    if (!remoteStreamRef.current.getTracks().includes(receiver.track)) {
                                        remoteStreamRef.current.addTrack(receiver.track);
                                        console.log('✅ Added existing track from receiver');
                                        setPatientFeed(feedId);
                                        setStatus('✅ Patient video from existing track!');
                                    }
                                }
                            });
                        }, 1000);
                    }
                };

                remoteHandle.onmessage = function(msg, jsep) {
                    console.log('📨 Subscriber message:', msg);

                    if (jsep) {
                        console.log('🔧 Creating answer for subscriber');
                        remoteHandle.createAnswer({
                            jsep: jsep,
                            media: {
                                audio: true,
                                video: true,
                                receiveVideo: true,
                                receiveAudio: true
                            },
                            success: function(jsep) {
                                console.log('✅ Subscriber answer created');
                                remoteHandle.send({
                                    message: { request: 'start', room: roomId },
                                    jsep: jsep
                                });
                                setPatientFeed(feedId);
                                setStatus('✅ Subscribed to patient - waiting for tracks...');

                                // Запускаем мониторинг треков
                                startTrackMonitoring();
                            },
                            error: function(error) {
                                console.error('❌ CreateAnswer error:', error);
                            }
                        });
                    }
                };

                // Стандартный обработчик
                remoteHandle.onremotestream = function(stream) {
                    console.log('🎥 REMOTE STREAM in onremotestream:', stream);
                    if (stream) {
                        stream.getTracks().forEach(track => {
                            if (!remoteStreamRef.current.getTracks().includes(track)) {
                                console.log('🎯 Adding track from onremotestream:', track.kind);
                                remoteStreamRef.current.addTrack(track);
                            }
                        });
                        setPatientFeed(feedId);
                        setStatus('✅ Patient video via onremotestream!');
                    }
                };

                remoteHandle.mediaState = function(medium, on) {
                    console.log('🎥 Media state:', medium, on);
                    if (medium === 'video' && on) {
                        console.log('✅ Video is flowing');
                    }
                };

                remoteHandle.oncleanup = function() {
                    console.log('🧹 Subscriber cleanup');
                    remoteStreamRef.current.getTracks().forEach(track => track.stop());
                    remoteStreamRef.current = new MediaStream();
                    setPatientFeed(null);
                };

                // Входим как подписчик
                console.log('🚪 Joining as subscriber to feed:', feedId);
                remoteHandle.send({
                    message: {
                        request: 'join',
                        room: roomId,
                        ptype: 'subscriber',
                        feed: feedId
                    }
                });

            },
            error: function(error) {
                console.error('❌ Subscriber attach error:', error);
            }
        });
    }

    // Мониторинг треков
    function startTrackMonitoring() {
        let checkCount = 0;
        const maxChecks = 30; // 15 секунд

        const checkTracks = () => {
            checkCount++;

            const trackCount = remoteStreamRef.current.getTracks().length;
            console.log('🔍 Track check', checkCount, 'Tracks:', trackCount);

            if (trackCount > 0) {
                console.log('✅ Tracks found in remote stream:', trackCount);
                setStatus('✅ Patient video received!');
                return;
            }

            if (checkCount < maxChecks) {
                // Проверяем PeerConnection на наличие треков
                if (subscriberHandleRef.current && subscriberHandleRef.current.webrtcStuff && subscriberHandleRef.current.webrtcStuff.pc) {
                    const pc = subscriberHandleRef.current.webrtcStuff.pc;
                    const receivers = pc.getReceivers();

                    receivers.forEach((receiver, index) => {
                        if (receiver.track && receiver.track.readyState === 'live') {
                            console.log(`🎯 Live track in receiver ${index}:`, receiver.track.kind);
                            if (!remoteStreamRef.current.getTracks().includes(receiver.track)) {
                                remoteStreamRef.current.addTrack(receiver.track);
                                console.log('✅ Added track from receiver monitoring');
                                setPatientFeed(patientFeed);
                                setStatus('✅ Patient video received via monitoring!');
                            }
                        }
                    });
                }

                setTimeout(checkTracks, 500);
            } else {
                console.log('❌ No tracks received after monitoring');
                setStatus('❌ Failed to receive patient video');
            }
        };

        setTimeout(checkTracks, 1000);
    }

    // Функция для ручной публикации потока
    const publishStream = async () => {
        if (!publisherHandleRef.current) return;

        try {
            setStatus('🎥 Publishing local stream...');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { width: 320, height: 240 }
            });

            setLocalStream(stream);

            publisherHandleRef.current.createOffer({
                media: {
                    audio: true,
                    video: true,
                    streams: [stream],
                    sendVideo: true,
                    sendAudio: true
                },
                success: function(jsep) {
                    console.log('✅ Publisher offer created');
                    publisherHandleRef.current.send({
                        message: {
                            request: 'configure',
                            audio: true,
                            video: true
                        },
                        jsep: jsep
                    });
                    setStatus('✅ Local stream published');
                },
                error: function(error) {
                    console.error('❌ CreateOffer error:', error);
                }
            });

        } catch (error) {
            console.error('❌ Media access error:', error);
            setStatus('Error accessing camera');
        }
    };

    // Функция для диагностики
    const diagnose = () => {
        console.log('🔍 DIAGNOSTICS:');
        console.log('📹 Remote stream tracks:', remoteStreamRef.current.getTracks().length);
        remoteStreamRef.current.getTracks().forEach((track, index) => {
            console.log(`🎯 Track ${index}:`, track.kind, track.readyState, track.muted);
        });

        if (subscriberHandleRef.current && subscriberHandleRef.current.webrtcStuff && subscriberHandleRef.current.webrtcStuff.pc) {
            const pc = subscriberHandleRef.current.webrtcStuff.pc;
            const receivers = pc.getReceivers();
            console.log('📡 PeerConnection receivers:', receivers.length);
            receivers.forEach((receiver, index) => {
                if (receiver.track) {
                    console.log(`🎯 Receiver ${index}:`, receiver.track.kind, receiver.track.readyState);
                } else {
                    console.log(`🎯 Receiver ${index}: no track`);
                }
            });
        } else {
            console.log('❌ No PeerConnection available');
        }
    };

    // Принудительное добавление тестового трека (для отладки)
    const addTestTrack = async () => {
        try {
            const testStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const testTrack = testStream.getVideoTracks()[0];
            remoteStreamRef.current.addTrack(testTrack);
            console.log('✅ Added test track');
            setPatientFeed('test');
            setStatus('✅ Test video added');

            // Останавливаем остальные треки тестового потока
            testStream.getTracks().forEach(track => {
                if (track !== testTrack) track.stop();
            });
        } catch (error) {
            console.error('❌ Test track error:', error);
        }
    };

    function cleanup(){
        console.log('🧹 Cleaning up...');

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        remoteStreamRef.current.getTracks().forEach(track => track.stop());

        if (publisherHandleRef.current) {
            publisherHandleRef.current.detach();
        }

        if (subscriberHandleRef.current) {
            subscriberHandleRef.current.detach();
        }

        if(janusRef.current) {
            try {
                janusRef.current.destroy();
            } catch(e) {
                console.error('Cleanup error:', e);
            }
        }

        setStatus('Disconnected');
    }

    return (
        <div className="room">
            <h2>Доктор: {display}</h2>
            <div className="status" style={{
                padding: '10px',
                background: '#f0f0f0',
                borderRadius: '5px',
                margin: '10px 0',
                fontFamily: 'monospace',
                fontSize: '14px'
            }}>
                {status}
                <div style={{ marginTop: '10px' }}>
                    <button
                        onClick={publishStream}
                        style={{ marginRight: '10px', padding: '5px 10px' }}
                    >
                        Запустить камеру
                    </button>
                    <button
                        onClick={diagnose}
                        style={{ marginRight: '10px', padding: '5px 10px' }}
                    >
                        Диагностика
                    </button>
                    {/*<button*/}
                    {/*    onClick={addTestTrack}*/}
                    {/*    style={{ marginRight: '10px', padding: '5px 10px' }}*/}
                    {/*>*/}
                    {/*    */}
                    {/*</button>*/}
                    <button
                        onClick={() => patientFeed && setupSubscriber(janusRef.current, patientFeed)}
                        style={{ padding: '5px 10px' }}
                    >
                        Повторить
                    </button>
                </div>
            </div>

            <div className="videos">
                <div>
                    <h4>Ваша камера</h4>
                    <video
                        ref={localRef}
                        autoPlay
                        muted
                        playsInline
                        style={{
                            width: 320,
                            height: 240,
                            background: '#000',
                            border: '2px solid #333',
                            borderRadius: '8px'
                        }}
                    />
                </div>

                <div>
                    <h4>Камера пациента</h4>
                    <video
                        ref={remoteRef}
                        autoPlay
                        playsInline
                        style={{
                            width: 480,
                            height: 360,
                            background: '#000',
                            border: remoteStreamRef.current.getTracks().length > 0 ? '2px solid #28a745' : '2px solid #dc3545',
                            borderRadius: '8px'
                        }}
                    />
                    <p>Участников: {remoteStreamRef.current.getTracks().length}</p>
                </div>
            </div>
        </div>
    )
}