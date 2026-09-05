import VideoCall from '../VideoCall';

const VideoWorkspace = ({ socket, roomId, username }) => {
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
