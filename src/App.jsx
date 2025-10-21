import React, {useState} from 'react'
import Patient from './components/Patient'
import Doctor from './components/Doctor'


export default function App(){
    const [role, setRole] = useState(null)
    const [room, setRoom] = useState('1234')
    const [name, setName] = useState('User'+Math.floor(Math.random()*1000))


    return (
        <div className="app">
            <h1>WebRTC</h1>
            {!role ? (
                <div className="controls">
                    <label>Номер комнаты: <input value={room} onChange={e=>setRoom(e.target.value)} /></label>
                    <label>Ваше имя: <input value={name} onChange={e=>setName(e.target.value)} /></label>
                    <div className="buttons">
                        <button onClick={()=>setRole('patient')}>Войти как пациент</button>
                        <button onClick={()=>setRole('doctor')}>Войти как доктор</button>
                    </div>
                </div>
            ) : (
                <div>
                    <button className="back" onClick={()=>setRole(null)}>Выйти</button>
                    {role === 'patient'
                        ? <Patient roomId={parseInt(room,10)} display={name} />
                        : <Doctor roomId={parseInt(room,10)} display={name} />
                    }
                </div>
            )}
        </div>
    )
}