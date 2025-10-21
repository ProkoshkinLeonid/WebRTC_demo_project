import React, { useEffect, useRef, useState } from 'react';
import { initJanus } from '../janusInit';

export default function Patient({ roomId, display }) {
    const localRef = useRef();
    const [status, setStatus] = useState('Initializing...');
    const [localStream, setLocalStream] = useState(null);
    const [availableDoctors, setAvailableDoctors] = useState([]);
    const [activeDoctors, setActiveDoctors] = useState({});

    const janusRef = useRef(null);
    const handleRef = useRef(null);
    const subscriberHandlesRef = useRef({});
    const doctorStreamsRef = useRef({});
    const participantsMonitorRef = useRef(null);
    const discoveryAttemptsRef = useRef(0);

    useEffect(() => {
        let mounted = true;

        const initialize = async () => {
            try {
                setStatus('Connecting to Janus...');
                const janusInstance = await initJanus();

                if (!mounted) return;
                janusRef.current = janusInstance;

                await setupPublisher(janusInstance);

            } catch (err) {
                console.error('❌ Patient initialization error', err);
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
            console.log('🎥 Setting patient stream to video element');
            localRef.current.srcObject = localStream;
            localRef.current.play().catch(e => console.log('Patient play error:', e));
        }
    }, [localStream]);

    // Эффект для обновления видео элементов врачей
    useEffect(() => {
        Object.entries(activeDoctors).forEach(([doctorId, doctorData]) => {
            const videoElement = document.getElementById(doctorData.elementId);
            if (videoElement && doctorData.stream) {
                console.log('🎥 Setting doctor stream to video:', doctorId);
                videoElement.srcObject = doctorData.stream;
                videoElement.play().catch(e => console.log('Doctor video play error:', e));
            }
        });
    }, [activeDoctors]);

    async function setupPublisher(janusInstance) {
        try {
            setStatus('Setting up publisher...');

            const handle = await new Promise((resolve, reject) => {
                janusInstance.attach({
                    plugin: 'janus.plugin.videoroom',
                    opaqueId: 'patient-publisher-' + Date.now(),
                    success: function(handle) {
                        console.log('✅ Patient plugin attached');
                        resolve(handle);
                    },
                    error: function(err) {
                        reject(err);
                    }
                });
            });

            handleRef.current = handle;

            handle.onmessage = (msg, jsep) => {
                console.log('📨 Patient message:', msg);

                if (msg.videoroom === 'joined') {
                    setStatus('✅ Joined room as patient');
                    console.log('Patient ID:', handle.getId());

                    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Получаем publishers из joined сообщения
                    if (msg.publishers && msg.publishers.length > 0) {
                        console.log('👥 Found existing publishers on join:', msg.publishers);
                        updateDoctorsList(msg.publishers);
                    }

                    // Публикуем наш поток
                    publishPatientStream(handle);

                    // Запускаем расширенное обнаружение
                    startEnhancedDoctorDiscovery(handle);

                } else if (msg.videoroom === 'event') {
                    console.log('🔄 Room event:', msg);

                    // Новые издатели
                    if (msg.publishers && msg.publishers.length > 0) {
                        console.log('👥 New publishers detected:', msg.publishers);
                        updateDoctorsList(msg.publishers);
                    }

                    // Участники вышли
                    if (msg.unpublished) {
                        console.log('🚪 Participant unpublished:', msg.unpublished);
                        removeDoctor(msg.unpublished);
                    }

                    if (msg.leaving) {
                        console.log('🚪 Participant leaving:', msg.leaving);
                        removeDoctor(msg.leaving);
                    }

                    // Обрабатываем ответ на listparticipants
                    if (msg.participants) {
                        console.log('👥 Participants list received:', msg.participants);
                        processParticipantsList(msg.participants);
                    }
                }

                if (jsep) {
                    console.log('🔧 Handling patient JSEP');
                    handle.handleRemoteJsep({ jsep });
                }
            };

            // Входим в комнату
            console.log('🚪 Patient joining room...');
            handle.send({
                message: {
                    request: 'join',
                    room: roomId,
                    ptype: 'publisher',
                    display: display || 'Patient'
                }
            });

        } catch (error) {
            console.error('❌ Patient setup error:', error);
            setStatus('Error setting up patient');
        }
    }

    // РАСШИРЕННОЕ ОБНАРУЖЕНИЕ ВРАЧЕЙ
    function startEnhancedDoctorDiscovery(handle) {
        console.log('🔍 Starting enhanced doctor discovery...');
        discoveryAttemptsRef.current = 0;

        const maxAttempts = 8;

        const attemptDiscovery = () => {
            discoveryAttemptsRef.current++;
            console.log(`🎯 Discovery attempt ${discoveryAttemptsRef.current}/${maxAttempts}`);

            // Метод 1: Запрос списка участников
            handle.send({
                message: {
                    request: 'listparticipants',
                    room: roomId
                }
            });

            // Метод 2: Отправляем ping для активации событий
            setTimeout(() => {
                handle.send({
                    message: {
                        request: 'ping'
                    }
                });
            }, 300);

            // Метод 3: Пытаемся переподключиться к комнате (иногда помогает)
            if (discoveryAttemptsRef.current === 3) {
                setTimeout(() => {
                    console.log('🔄 Attempting room reconnection...');
                    handle.send({
                        message: {
                            request: 'join',
                            room: roomId,
                            ptype: 'publisher',
                            display: display || 'Patient'
                        }
                    });
                }, 1000);
            }

            // Метод 4: Пробуем создать временного подписчика
            if (discoveryAttemptsRef.current >= 4 && availableDoctors.length === 0) {
                tryTemporarySubscriber();
            }

            if (discoveryAttemptsRef.current < maxAttempts) {
                participantsMonitorRef.current = setTimeout(attemptDiscovery, 2000);
            } else {
                console.log('⏹️ Stopped enhanced discovery');
                if (availableDoctors.length === 0) {
                    setStatus('❌ No doctors found. Ask them to rejoin room.');
                } else {
                    setStatus(`✅ Found ${availableDoctors.length} doctor(s)`);
                }
            }
        };

        participantsMonitorRef.current = setTimeout(attemptDiscovery, 1000);
    }

    // ВРЕМЕННЫЙ ПОДПИСЧИК ДЛЯ АКТИВАЦИИ СОБЫТИЙ
    function tryTemporarySubscriber() {
        if (!janusRef.current) return;

        console.log('🎯 Trying temporary subscriber for event activation...');

        const tempId = `temp-${Date.now()}`;

        janusRef.current.attach({
            plugin: 'janus.plugin.videoroom',
            opaqueId: tempId,
            success: function(tempHandle) {
                tempHandle.onmessage = function(msg) {
                    console.log('🔍 Temp subscriber message:', msg);

                    // Детально анализируем все сообщения
                    if (msg.videoroom === 'event' && msg.publishers) {
                        console.log('🎯 Temp subscriber found publishers:', msg.publishers);
                        updateDoctorsList(msg.publishers);
                    }

                    // Всегда отключаем временный handle
                    setTimeout(() => {
                        try {
                            tempHandle.detach();
                        } catch (e) {}
                    }, 1000);
                };

                // Пытаемся подписаться на несуществующий feed
                tempHandle.send({
                    message: {
                        request: 'join',
                        room: roomId,
                        ptype: 'subscriber',
                        feed: 9999999999 // Несуществующий ID
                    }
                });

                // Автоматическое отключение через 2 секунды
                setTimeout(() => {
                    try {
                        tempHandle.detach();
                    } catch (e) {}
                }, 2000);

            },
            error: function(err) {
                console.log('🔍 Temp subscriber error (expected):', err);
            }
        });
    }

    // ОБРАБОТКА СПИСКА УЧАСТНИКОВ
    function processParticipantsList(participants) {
        if (!participants || !Array.isArray(participants)) {
            console.log('❌ Invalid participants list:', participants);
            return;
        }

        console.log('👥 Processing participants list:', participants);

        const doctors = participants
            .filter(participant => {
                const isNotSelf = participant.id !== handleRef.current?.getId();
                const isPublisher = participant.publisher === true;

                console.log(`Participant: ${participant.id}, display: ${participant.display}, self: ${!isNotSelf}, publisher: ${isPublisher}`);

                return isNotSelf && isPublisher;
            })
            .map(participant => ({
                id: participant.id,
                display: participant.display || `Doctor-${participant.id.substring(0, 6)}`,
                isActive: activeDoctors[participant.id] !== undefined
            }));

        console.log('👥 Processed doctors from participants:', doctors);

        if (doctors.length > 0) {
            updateDoctorsList(doctors);
        }
    }

    function updateDoctorsList(doctors) {
        console.log('🔄 Updating doctors list with:', doctors);

        if (!doctors || doctors.length === 0) {
            console.log('ℹ️ No doctors to update');
            return;
        }

        setAvailableDoctors(prev => {
            // Объединяем старых и новых врачей
            const doctorMap = new Map();

            // Добавляем существующих
            prev.forEach(doctor => doctorMap.set(doctor.id, doctor));

            // Добавляем/обновляем новых
            doctors.forEach(doctor => doctorMap.set(doctor.id, doctor));

            const uniqueDoctors = Array.from(doctorMap.values());
            console.log('✅ Final doctors list:', uniqueDoctors);

            return uniqueDoctors;
        });

        setStatus(`✅ ${doctors.length} doctor(s) available`);

        // Останавливаем мониторинг если нашли врачей
        if (doctors.length > 0 && participantsMonitorRef.current) {
            clearTimeout(participantsMonitorRef.current);
            console.log('⏹️ Stopped discovery - doctors found');
        }
    }

    // Подключаемся к врачу
    async function connectToDoctor(doctorId, doctorDisplay) {
        if (activeDoctors[doctorId]) {
            console.log('⚠️ Already connected to doctor:', doctorDisplay);
            return;
        }

        if (!janusRef.current) {
            console.error('❌ Janus not available');
            return;
        }

        console.log('🔗 Connecting to doctor:', doctorDisplay);
        setStatus(`Connecting to ${doctorDisplay}...`);

        // Создаем поток для врача
        doctorStreamsRef.current[doctorId] = new MediaStream();

        janusRef.current.attach({
            plugin: 'janus.plugin.videoroom',
            opaqueId: `patient-to-doctor-${doctorId}-${Date.now()}`,
            success: function(remoteHandle) {
                subscriberHandlesRef.current[doctorId] = remoteHandle;
                console.log('✅ Subscriber to doctor attached');

                // Перехватываем создание ответа
                const originalCreateAnswer = remoteHandle.createAnswer.bind(remoteHandle);
                remoteHandle.createAnswer = function(options) {
                    console.log('🔧 Intercepted createAnswer for doctor');

                    return originalCreateAnswer(options).then(() => {
                        if (remoteHandle.webrtcStuff && remoteHandle.webrtcStuff.pc) {
                            const pc = remoteHandle.webrtcStuff.pc;
                            console.log('📡 PeerConnection captured for doctor');

                            pc.ontrack = (event) => {
                                console.log('🎯 PeerConnection ontrack event for doctor:', event.track?.kind);
                                if (event.track) {
                                    handleDoctorTrack(doctorId, doctorDisplay, event.track);
                                }
                                if (event.streams && event.streams[0]) {
                                    event.streams[0].getTracks().forEach(track => {
                                        handleDoctorTrack(doctorId, doctorDisplay, track);
                                    });
                                }
                            };

                            startDoctorTrackMonitoring(doctorId, doctorDisplay, pc);
                        }
                    });
                };

                remoteHandle.onmessage = function(msg, jsep) {
                    console.log('📨 Doctor subscriber message:', msg);

                    if (msg.videoroom === 'attached') {
                        console.log('✅ Successfully attached to doctor:', msg.display);
                    }

                    if (jsep) {
                        remoteHandle.createAnswer({
                            jsep: jsep,
                            media: {
                                audio: true,
                                video: true,
                                receiveVideo: true,
                                receiveAudio: true
                            },
                            success: function(jsep) {
                                console.log('✅ Doctor answer created');
                                remoteHandle.send({
                                    message: { request: 'start', room: roomId },
                                    jsep: jsep
                                });
                                setStatus(`✅ Connected to ${doctorDisplay} - waiting for video...`);
                            },
                            error: function(error) {
                                console.error('❌ CreateAnswer error with doctor:', error);
                                setStatus(`Error connecting to ${doctorDisplay}`);
                            }
                        });
                    }
                };

                remoteHandle.webrtcState = function(on) {
                    console.log('📡 WebRTC state with doctor:', on);
                    if (on && remoteHandle.webrtcStuff && remoteHandle.webrtcStuff.pc) {
                        const pc = remoteHandle.webrtcStuff.pc;
                        console.log('✅ WebRTC established with doctor');
                        startDoctorTrackMonitoring(doctorId, doctorDisplay, pc);
                    }
                };

                remoteHandle.oncleanup = function() {
                    console.log('🧹 Doctor subscriber cleanup');
                    removeDoctor(doctorId);
                };

                // Входим как подписчик к врачу
                console.log('🚪 Joining as subscriber to doctor:', doctorId);
                remoteHandle.send({
                    message: {
                        request: 'join',
                        room: roomId,
                        ptype: 'subscriber',
                        feed: doctorId
                    }
                });

            },
            error: function(error) {
                console.error('❌ Doctor subscriber attach error:', error);
                setStatus(`Error connecting to ${doctorDisplay}`);
                delete doctorStreamsRef.current[doctorId];
            }
        });
    }

    // Обработка трека от врача
    function handleDoctorTrack(doctorId, doctorDisplay, track) {
        if (!doctorStreamsRef.current[doctorId].getTracks().includes(track)) {
            console.log('✅ Adding doctor track:', track.kind, track.readyState);
            doctorStreamsRef.current[doctorId].addTrack(track);

            if (track.kind === 'video') {
                setActiveDoctors(prev => ({
                    ...prev,
                    [doctorId]: {
                        stream: doctorStreamsRef.current[doctorId],
                        display: doctorDisplay,
                        elementId: `doctor-${doctorId}`
                    }
                }));

                setAvailableDoctors(prev =>
                    prev.map(doc =>
                        doc.id === doctorId
                            ? {...doc, isActive: true}
                            : doc
                    )
                );

                setStatus(`✅ ${doctorDisplay} video received!`);

                setTimeout(() => {
                    const videoElement = document.getElementById(`doctor-${doctorId}`);
                    if (videoElement && doctorStreamsRef.current[doctorId]) {
                        videoElement.srcObject = doctorStreamsRef.current[doctorId];
                        videoElement.play().catch(e => console.log('Doctor video play error:', e));
                    }
                }, 100);
            }
        }
    }

    // Мониторинг треков врача
    function startDoctorTrackMonitoring(doctorId, doctorDisplay, pc) {
        let checkCount = 0;
        const maxChecks = 30;

        const checkTracks = () => {
            checkCount++;

            const receivers = pc.getReceivers();
            const videoTracks = doctorStreamsRef.current[doctorId].getVideoTracks();

            console.log(`🔍 Doctor ${doctorDisplay} check ${checkCount}, receivers: ${receivers.length}, video tracks: ${videoTracks.length}`);

            receivers.forEach((receiver, index) => {
                if (receiver.track && receiver.track.readyState === 'live') {
                    console.log(`🎯 Doctor ${doctorDisplay} receiver ${index}:`, receiver.track.kind);
                    handleDoctorTrack(doctorId, doctorDisplay, receiver.track);
                }
            });

            if (videoTracks.length > 0) {
                console.log('✅ Doctor video tracks found:', videoTracks.length);
                return;
            }

            if (checkCount < maxChecks) {
                setTimeout(checkTracks, 500);
            } else {
                console.log('❌ No doctor video tracks received after monitoring');
                setStatus(`❌ No video from ${doctorDisplay}`);
            }
        };

        setTimeout(checkTracks, 1000);
    }

    function disconnectFromDoctor(doctorId) {
        const doctorDisplay = activeDoctors[doctorId]?.display || 'Unknown';

        if (subscriberHandlesRef.current[doctorId]) {
            try {
                subscriberHandlesRef.current[doctorId].detach();
            } catch (e) {
                console.error('Error detaching doctor:', e);
            }
            delete subscriberHandlesRef.current[doctorId];
        }

        if (doctorStreamsRef.current[doctorId]) {
            doctorStreamsRef.current[doctorId].getTracks().forEach(track => track.stop());
            delete doctorStreamsRef.current[doctorId];
        }

        removeDoctor(doctorId);
        console.log('🚪 Disconnected from doctor:', doctorDisplay);
        setStatus(`Disconnected from ${doctorDisplay}`);
    }

    function removeDoctor(doctorId) {
        setActiveDoctors(prev => {
            const newState = {...prev};
            delete newState[doctorId];
            return newState;
        });

        setAvailableDoctors(prev =>
            prev.map(doc =>
                doc.id === doctorId
                    ? {...doc, isActive: false}
                    : doc
            )
        );
    }

    async function publishPatientStream(handle) {
        try {
            setStatus('🎥 Starting patient camera...');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { width: 640, height: 480 }
            });

            setLocalStream(stream);

            handle.createOffer({
                media: {
                    audio: true,
                    video: true,
                    streams: [stream],
                    sendVideo: true,
                    sendAudio: true
                },
                success: function(jsep) {
                    console.log('✅ Patient offer created');
                    handle.send({
                        message: {
                            request: 'configure',
                            audio: true,
                            video: true
                        },
                        jsep: jsep
                    });
                    setStatus('✅ Patient stream published - Searching for doctors...');
                },
                error: function(error) {
                    console.error('❌ Patient CreateOffer error:', error);
                }
            });

        } catch (error) {
            console.error('❌ Patient media error:', error);
            setStatus('Error accessing camera');
        }
    }

    // Функция для принудительного обновления списка врачей
    const refreshDoctorsList = () => {
        if (handleRef.current) {
            console.log('🔄 Force refreshing doctors list...');
            setStatus('Force searching for doctors...');
            discoveryAttemptsRef.current = 0;

            // Останавливаем текущий мониторинг
            if (participantsMonitorRef.current) {
                clearTimeout(participantsMonitorRef.current);
            }

            // Перезапускаем расширенное обнаружение
            startEnhancedDoctorDiscovery(handleRef.current);
        }
    };

    function cleanup() {
        console.log('🧹 Patient cleanup');

        if (participantsMonitorRef.current) {
            clearTimeout(participantsMonitorRef.current);
        }

        Object.keys(subscriberHandlesRef.current).forEach(disconnectFromDoctor);

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        if (handleRef.current) {
            handleRef.current.detach();
        }

        if (janusRef.current) {
            try {
                janusRef.current.destroy();
            } catch (e) {}
        }

        setStatus('Disconnected');
    }

    return (
        <div className="room">
            <h2>Пациент: {display}</h2>
            <div className="status" style={{
                padding: '10px',
                background: '#f0f0f0',
                borderRadius: '5px',
                margin: '10px 0',
                fontFamily: 'monospace',
                fontSize: '14px'
            }}>
                {status}
                <button
                    onClick={refreshDoctorsList}
                    style={{
                        marginLeft: '10px',
                        padding: '2px 6px',
                        background: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px'
                    }}
                >
                    🔍 Find Doctors
                </button>
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
                            width: 480,
                            height: 360,
                            background: '#000',
                            border: '2px solid #28a745',
                            borderRadius: '8px'
                        }}
                    />
                    <p>Доктора видят Вашу трансляцию</p>
                </div>

                <div>
                    <h4>Доступные трансляции ({availableDoctors.length})</h4>
                    <div style={{
                        marginBottom: '20px',
                        padding: '10px',
                        background: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #dee2e6'
                    }}>
                        {availableDoctors.length === 0 ? (
                            <div>
                                <p style={{ fontSize: '12px', color: '#6c757d' }}>
                                    Ожидаем докторов..
                                </p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {availableDoctors.map(doctor => (
                                    <div key={doctor.id} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '8px',
                                        background: doctor.isActive ? '#d4edda' : '#fff',
                                        border: `1px solid ${doctor.isActive ? '#c3e6cb' : '#dee2e6'}`,
                                        borderRadius: '4px'
                                    }}>
                                        <span>
                                            <strong>{doctor.display}</strong>
                                            {doctor.isActive && <span style={{color: '#28a745', marginLeft: '5px'}}>✅ Подключён</span>}
                                        </span>
                                        <div>
                                            {!doctor.isActive &&
                                                <button
                                                    onClick={() => connectToDoctor(doctor.id, doctor.display)}
                                                    style={{
                                                        padding: '4px 8px',
                                                        background: '#007bff',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Подключиться
                                                </button>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <h4>Подключённые трансляции ({Object.keys(activeDoctors).length})</h4>
                    <div
                        className="doctors-grid"
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '15px',
                            minHeight: '200px',
                            padding: '15px',
                            border: '1px dashed #ccc',
                            borderRadius: '8px',
                            background: '#fafafa'
                        }}
                    >
                        {Object.keys(activeDoctors).length === 0 ? (
                            <p style={{ color: '#6c757d', fontStyle: 'italic' }}>
                                Нет подключённых докторов
                            </p>
                        ) : (
                            Object.entries(activeDoctors).map(([doctorId, doctorData]) => (
                                <div key={doctorId} style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center'
                                }}>
                                    <video
                                        id={doctorData.elementId}
                                        autoPlay
                                        playsInline
                                        style={{
                                            width: 240,
                                            height: 180,
                                            background: '#000',
                                            border: '2px solid #007acc',
                                            borderRadius: '8px'
                                        }}
                                    />
                                    <div style={{
                                        marginTop: '5px',
                                        textAlign: 'center'
                                    }}>
                                        <strong>{doctorData.display}</strong>
                                        <br />
                                        <button
                                            onClick={() => disconnectFromDoctor(doctorId)}
                                            style={{
                                                marginTop: '5px',
                                                padding: '2px 6px',
                                                background: '#dc3545',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '3px',
                                                cursor: 'pointer',
                                                fontSize: '12px'
                                            }}
                                        >
                                            Отключиться
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}