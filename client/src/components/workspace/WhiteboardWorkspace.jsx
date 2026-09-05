import Whiteboard from '../Whiteboard';

// No socket prop: the board is a Yjs document now, and opens its own provider.
const WhiteboardWorkspace = ({ roomId }) => {
    return (
        <div className="w-full h-full">
            <Whiteboard roomId={roomId} />
        </div>
    );
};

export default WhiteboardWorkspace;
