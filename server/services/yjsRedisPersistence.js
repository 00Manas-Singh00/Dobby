/**
 * services/yjsRedisPersistence.js
 * Shared storage for Yjs documents, so a document can be served by whichever
 * replica currently owns it.
 *
 * ADR-007 chose `y-leveldb`, and named its one real cost: LevelDB is embedded,
 * takes an exclusive lock on its directory, and therefore binds document state
 * to one process and one filesystem. Pointing two replicas at the same volume
 * does not work — the second one cannot open it — so the lease in
 * `documentRouter.js` is only half an answer on its own. It guarantees exactly
 * one node serves a document; without shared storage, that node also has to be
 * the same node forever, because the state is on its disk.
 *
 * ## The model
 *
 * A document is an append-only list of updates under one key, plus its name in
 * a set so retention can enumerate them. That mirrors what `y-leveldb` does,
 * and it is the shape Yjs wants: updates are commutative and idempotent, so
 * appending never needs a read, and loading is "apply everything in any order".
 *
 * ## Why the compaction is safe
 *
 * An append-only list grows forever, so past a threshold it is collapsed into a
 * single merged update. Read-merge-replace is normally a race — two writers
 * compacting concurrently would drop whatever the other appended in between —
 * and the usual fix is a lock. There is already one: a node only holds a
 * document open while it holds that document's lease, and the lease is
 * exclusive across the cluster. **The single-writer property the router
 * provides for correctness is what makes compaction cheap here**, which is the
 * main reason the two pieces are worth having together rather than either alone.
 *
 * Updates are stored base64-encoded. Redis values are binary-safe, but the
 * client is shared with the adapter and the state store and is in text mode;
 * a second connection purely to avoid an encode was not worth it.
 */

import { key } from './cluster.js';

/** Merge the update list once it grows past this many entries. */
const COMPACT_THRESHOLD = Number(process.env.YJS_REDIS_COMPACT_AFTER || 200);

const updatesKey = (name) => key('ydoc', name, 'updates');
const namesKey = () => key('ydoc', 'names');

/**
 * @param {object} redis a connected node-redis client
 * @param {typeof import('yjs')} Y the *same* Yjs instance y-socket.io uses —
 *   passed in rather than imported because its constructor checks are
 *   identity-based and a second copy of the module fails them
 */
export function createRedisDocumentPersistence(redis, Y) {
    async function readUpdates(name) {
        const encoded = await redis.lRange(updatesKey(name), 0, -1);
        return encoded.map((value) => new Uint8Array(Buffer.from(value, 'base64')));
    }

    async function compact(name) {
        const updates = await readUpdates(name);
        if (updates.length < 2) return;

        const merged = Y.mergeUpdates(updates);
        // Safe without a transaction because the lease makes this the only
        // writer. It is still done as one MULTI so a reader never observes the
        // window between the delete and the write.
        await redis
            .multi()
            .del(updatesKey(name))
            .rPush(updatesKey(name), Buffer.from(merged).toString('base64'))
            .exec();
    }

    const provider = {
        /** A fresh `Y.Doc` with every stored update applied. */
        async getYDoc(name) {
            const doc = new Y.Doc();
            const updates = await readUpdates(name);
            // One transaction for the whole replay: applying N updates
            // individually fires N observer passes for no benefit.
            doc.transact(() => {
                for (const update of updates) Y.applyUpdate(doc, update);
            });
            return doc;
        },

        async storeUpdate(name, update) {
            const length = await redis
                .multi()
                .sAdd(namesKey(), name)
                .rPush(updatesKey(name), Buffer.from(update).toString('base64'))
                .exec()
                .then((replies) => Number(replies[1]));

            if (length >= COMPACT_THRESHOLD) await compact(name);
        },

        async clearDocument(name) {
            await redis.multi().del(updatesKey(name)).sRem(namesKey(), name).exec();
        },

        /** Every document with stored state. Drives the retention sweep. */
        async getAllDocNames() {
            return redis.sMembers(namesKey());
        },
    };

    // The shape `YSocketIO` expects on `.persistence`. Setting it is also what
    // makes y-socket.io destroy a document when its last connection closes —
    // with no persistence it keeps every document in memory forever, which on a
    // long-lived replica is a leak as much as a correctness problem.
    return {
        provider,
        async bindState(name, doc) {
            const stored = await provider.getYDoc(name);
            // Push what this in-memory document already has into storage before
            // merging storage back in, so a document created locally and a
            // document loaded from Redis converge on the union rather than one
            // replacing the other.
            await provider.storeUpdate(name, Y.encodeStateAsUpdate(doc));
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(stored));
            stored.destroy();
            doc.on('update', (update) => {
                provider
                    .storeUpdate(name, update)
                    .catch((error) => console.error(`[Yjs] Redis write failed for ${name}:`, error.message));
            });
        },
        async writeState(name, doc) {
            // Updates are already written as they happen, so the final flush is
            // a compaction rather than a save: the document is closing, which is
            // the cheapest possible moment to collapse its history.
            try {
                await provider.storeUpdate(name, Y.encodeStateAsUpdate(doc));
                await compact(name);
            } catch (error) {
                console.error(`[Yjs] Redis flush failed for ${name}:`, error.message);
            }
        },
    };
}

export { COMPACT_THRESHOLD };
