import Whiteboard from '../Whiteboard';

const WhiteboardWorkspace = ({ socket, roomId }) => {
    return (
        <div className="w-full h-full">
            <Whiteboard socket={socket} roomId={roomId} />
        </div>
    );
};

export default WhiteboardWorkspace;
