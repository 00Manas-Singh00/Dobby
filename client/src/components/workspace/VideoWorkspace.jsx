import React from 'react';
import VideoCall from '../VideoCall';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const VideoWorkspace = ({ moduleId, socket, roomId, username }) => {
    const { videoState } = useWorkspace();

    return (
        <div className="w-full h-full">
            <VideoCall
                socket={socket}
                roomId={roomId}
                username={username}
                isFullView={true}
            />
        </div>
    );
};

export default VideoWorkspace;
