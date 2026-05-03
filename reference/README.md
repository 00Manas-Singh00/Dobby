# Dobby

**Dobby** is a multifaceted project developed by Team Neofetch. It integrates various advanced features to provide an all-in-one platform catering to modern web needs.

## Features

- **Online IDE**: A robust Integrated Development Environment accessible directly from your browser.
- **Video Conferencing**: Seamless video communication for meetings, classes, and collaborations.
- **Chat Application**: Real-time messaging for effective and instant communication.
- **Chatbot (Front Page)**: An interactive chatbot to assist and guide users right from the homepage.

## Getting Started
steps of installation and project setup

## Usage

### Online IDE

1. Open the IDE from the main dashboard.
2. Write, edit, and run your code directly in the browser.

### Video Conferencing

1. Navigate to the Video Conferencing section.
2. Start or join a meeting with a unique meeting ID.

### Chat Application

1. Open the Chat application.
2. Communicate in real-time with team members or other users.

### Chatbot

1. Interact with the chatbot on the front page.
2. Get assistance and guidance on using the platform.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Thanks to the Open Source community for their valuable tools and resources.
- Special thanks to Team Neofetch for their dedication and hard work.

## Contact

For any inquiries or feedback, please reach out to us at contact@neofetch.com.

# Collabarative Code Editor
* multiple users can join a room for simultaneous editing in realtime.
* single user creates a room.
* user who created/joined the room can share the room ID for invite.

## Tech Stack
* websockets used for realtime data streaming.
* React used in frontend and Node.js in backend.
* react-hot-toast used for notification.
* uuid library for generating random long string for using as Room ID.

## Instructions
### Development
* cd client && npm start (on terminal 1)
* cd server && npm run server (on terminal 2)
* Development document: https://docs.google.com/document/d/1gjXxgH9DGwMUQQZSMpqzwCpN3zbNdG8Ua1ElxFBQg5w/edit?usp=sharing

### Production
* first add the env variable value to platform used for deployment of client code.
* use "REACT_APP_WEB_SOCKET_URL" key name and assign server code production url as value.
* in client, run "npm run build" for test run.
* in deployment platform for client code, select the client as "root folder".
* NOTE: above step is not required in case if manually hosting on server


