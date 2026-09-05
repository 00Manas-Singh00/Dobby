/**
 * tests/helpers/replicaEntry.js
 * Entry point for a replica started by the cluster test. Not used anywhere else.
 *
 * The cluster test cannot build two servers inside one process, and the reason
 * is worth stating: `yjsService` keeps its `YSocketIO` in a module-level
 * variable and `cluster.js` derives `NODE_ID` once at import. Two
 * `createDobbyServer()` calls in one process would therefore share a document
 * registry and answer to the same node id — which is not a bug in production,
 * where a process *is* a node, but it makes the split-brain this test exists to
 * detect impossible to reproduce.
 *
 * So each replica is a real child process, exactly as it would be deployed.
 * It prints its port on stdout because it binds port 0; the parent waits for
 * that line.
 */

import { createDobbyServer } from '../../index.js';

const instance = await createDobbyServer({ retention: false, snapshots: false });

instance.server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`READY ${instance.server.address().port}\n`);
});

// The parent asks for a clean shutdown so leases are handed back promptly; a
// replica killed outright would hold its documents until the TTL lapsed, which
// is a real behaviour but a slow one to test around.
process.on('message', async (message) => {
    if (message !== 'shutdown') return;
    await instance.close();
    instance.server.close(() => process.exit(0));
});
