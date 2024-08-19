import crypto from "node:crypto"

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

for (let i = 0; i < 10; i++) {
	const topic = `room-${i}.canvas.xyz`
	const app = await daemon.start(topic)
	console.log(`initializing ${topic}`)
	for (let i = 0; i < 200; i++) {
		await app.actions.createMessage({ content: crypto.pseudoRandomBytes(8).toString("hex") })
	}
	console.log(`done initializing ${topic}`)
}

controller.signal.addEventListener("abort", () => daemon.close())

// start the websocket proxy server
if (FLY_APP_NAME !== undefined && PROXY_PORT !== undefined) {
	const proxyServer = new ProxyServer(parseInt(PROXY_PORT), (originPort) => daemon.portMap.has(originPort))
	controller.signal.addEventListener("abort", () => proxyServer.close())
}

// sky strife: check the sky strife indexer for finished games, and ban them
const updateFinishedMatches = async () => {
	try {
		const request = await fetch("http://skystrife-indexer.internal:8000")
		const json = await request.json()
		const finishedMatches = json.finishedMatches as string[]
		console.log("[multi-chat-server] got finished sky strife matches:", finishedMatches)
		for (const match of finishedMatches) {
			daemon.ban(match)
		}
	} catch (err) {
		console.log("[multi-chat-server] could not reach sky strife indexer")
	}
}
setTimeout(() => updateFinishedMatches(), 0)
setInterval(updateFinishedMatches, 60 * 1000)
