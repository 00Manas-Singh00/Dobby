import React from 'react';
import Chat from '../Chat';

const ChatWorkspace = ({ moduleId, socket, roomId, username }) => {
    return (
        <div className="w-full h-full">
            <Chat socket={socket} roomId={roomId} username={username} />
        </div>
    );
};

export default ChatWorkspace;
