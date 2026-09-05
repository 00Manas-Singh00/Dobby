/**
 * services/roomService.js
 * Client-side wrapper over the room ownership API.
 *
 * Rooms are created by the server now, not by the client generating a UUID —
 * so that a room has an owner from the moment it exists.
 */

import { getJson, postJson, deleteJson } from '@/services/apiClient';

/** Rooms the signed-in user owns or has been invited to. */
export const listRooms = async () => (await getJson('/api/rooms')).rooms;

export const createRoom = async (name) => (await postJson('/api/rooms', { name })).room;

/** Room plus its members. Throws with status 404 if the user is not a member. */
export const getRoom = (roomId) => getJson(`/api/rooms/${roomId}`);

export const createInvite = async (roomId) =>
    (await postJson(`/api/rooms/${roomId}/invites`)).invite;

export const listInvites = async (roomId) =>
    (await getJson(`/api/rooms/${roomId}/invites`)).invites;

export const revokeInvite = (roomId, token) =>
    deleteJson(`/api/rooms/${roomId}/invites/${encodeURIComponent(token)}`);

/** Redeem an invite token, joining the room as a guest. */
export const redeemInvite = (token) => postJson('/api/rooms/join', { token });

export const leaveRoom = (roomId, userId) =>
    deleteJson(`/api/rooms/${roomId}/members/${userId}`);

export const deleteRoom = (roomId) => deleteJson(`/api/rooms/${roomId}`);

/** The shareable URL for an invite token. */
export const inviteUrl = (token) =>
    `${window.location.origin}/invite/${encodeURIComponent(token)}`;
