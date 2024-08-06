import { ProxyServer } from "./proxy.js"
import { Daemon } from "./daemon.js"

const { PORT = "3000", PROXY_PORT, FLY_APP_NAME, TIMEOUT } = process.env

const controller = new AbortController()
let stopping = false
process.on("SIGINT", async () => {
	if (stopping) {
		process.exit(1)
	} else {
		stopping = true
		process.stdout.write(`\n${"Received SIGINT, attempting to exit gracefully. ^C again to force quit."}\n`)
		controller.abort()
	}
})

const daemon = new Daemon(
	parseInt(PORT),
	{
		models: {
			message: {
				id: "primary",
				content: "string",
				address: "string",
				timestamp: "integer",
			},
		},
		actions: {
			createMessage: (db, { content }, { id, address, timestamp }) => {
				db.set("message", { id, content, address, timestamp })
			},
		},
	},
	{
		sleepTimeout: TIMEOUT ? parseInt(TIMEOUT) : 15 * 1000,
	},
)

controller.signal.addEventListener("abort", () => daemon.close())

// start the websocket proxy server
if (FLY_APP_NAME !== undefined && PROXY_PORT !== undefined) {
	const proxyServer = new ProxyServer(parseInt(PROXY_PORT), (originPort) => daemon.portMap.has(originPort))
	controller.signal.addEventListener("abort", () => proxyServer.close())
}

// sky strife: check the sky strife indexer for finished games, and ban them
const updateFinishedMatches = async () => {
	const request = await fetch("http://skystrife-indexer.internal:8000")
	const json = await request.json()
	const finishedMatches = json.finishedMatches as string[]
	for (const match of finishedMatches) {
		daemon.ban(match)
	}
}
setTimeout(() => updateFinishedMatches(), 0)
setInterval(updateFinishedMatches, 60 * 1000)
