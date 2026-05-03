# Dobby Workspace

This is the sandboxed workspace directory where all user-created files and terminal operations are isolated.

## Structure

Each collaboration room gets its own isolated workspace:
```
workspace/
├── {room-id-1}/
│   └── (user files for room 1)
├── {room-id-2}/
│   └── (user files for room 2)
└── README.md (this file)
```

## Security

- Terminal operations are restricted to the room's workspace directory
- Users cannot access files outside their room's workspace
- Each room has complete isolation from other rooms

## Usage

When you join a room and open the terminal, you'll be placed in that room's workspace directory. All files you create, edit, or delete will be stored here.
