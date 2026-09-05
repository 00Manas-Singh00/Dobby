/**
 * services/yjsProvider.js
 * Shared wiring for the two Yjs providers — the editor's and the whiteboard's.
 *
 * Both connect to `/yjs|<roomId>:<fileId>`, and both now have to cope with the
 * server running as more than one process. Two things are needed for that, and
 * neither belongs in a React hook.
 *
 * ## 1. Telling the load balancer which document this is
 *
 * A Yjs document is state held in one server process, so exactly one replica
 * may serve it (see `server/services/documentRouter.js`). For a balancer to
 * route on that it has to know the document name — and the name lives in the
 * Socket.IO namespace, which is inside the payload, not in the URL. So the name
 * is repeated as a query parameter: `?doc=<roomId>:<fileId>`. It is a routing
 * hint and nothing more. **The server never trusts it** — authorization and
 * ownership both come from the namespace the client actually connected to — so
 * a client that lies about it gets routed badly, not privileged.
 *
 * ## 2. Reconnecting when the hint was wrong
 *
 * If a client still lands on the wrong replica, the server refuses the
 * handshake with `DOCUMENT_MOVED` rather than serving a second copy of the
 * document. A Socket.IO client does not retry a middleware rejection on its own
 * — `socket.active` is false and reconnection is off — so without the retry
 * below a single misroute would leave the editor permanently disconnected, and
 * the fail-loud design would be worse for the user than the silent divergence
 * it replaced.
 *
 * The backoff is capped and the retry is unconditional, because the condition
 * is always transient: either the balancer will land the next attempt on the
 * owner, or the owner's lease will lapse and this node will take it.
 */

const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 5000;

/**
 * The `socketIoOptions` argument for `SocketIOProvider` — its fifth parameter,
 * spread over the client's own options.
 *
 * @param {string} docName `<roomId>:<fileId>`
 */
export function documentSocketOptions(docName) {
    return { query: { doc: docName } };
}

/**
 * Retry a handshake the server refused because another node owns the document.
 *
 * Only `DOCUMENT_MOVED` is retried. Every other refusal — an expired token, a
 * room the user is not a member of — is permanent, and retrying it would turn
 * one clear error in the console into an infinite loop of them.
 *
 * @param {import('y-socket.io').SocketIOProvider} provider
 * @param {string} docName for the log line, so a misroute is identifiable
 * @returns {() => void} cleanup, to be called when the provider is destroyed
 */
export function retryOnDocumentMoved(provider, docName) {
    let attempt = 0;
    let timer = null;
    let stopped = false;

    const onError = (error) => {
        if (error?.data?.code !== 'DOCUMENT_MOVED' || stopped) return;

        const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
        attempt += 1;
        console.warn(
            `[Yjs] ${docName} is served by node ${error.data.owner?.nodeId ?? 'unknown'}; ` +
                `retrying in ${delay}ms`
        );

        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!stopped) provider.socket.connect();
        }, delay);
    };

    // Reset on success, so a document that moves again later gets the full
    // backoff budget rather than resuming from where the last incident left it.
    const onConnect = () => {
        attempt = 0;
    };

    provider.socket.on('connect_error', onError);
    provider.socket.on('connect', onConnect);

    return () => {
        stopped = true;
        clearTimeout(timer);
        provider.socket.off('connect_error', onError);
        provider.socket.off('connect', onConnect);
    };
}
