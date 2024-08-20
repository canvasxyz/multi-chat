import fs from "node:fs"
import crypto from "node:crypto"
import process from "node:process"

import puppeteer from "puppeteer"
import { Canvas } from "@canvas-js/core"

type Config = {
	topic: string
	numTopics: number
	cycleUp: number
	cycleDown: number
}

type Stats = {
	peerCount: number
	messageCount: number
	lastMessageCount: number
	clock: number
}

type Room = {
	start: () => void
	topic: string
} & Stats

declare global {
	function log(...args: any[]): void
	function getConfig(): Config
	function updateStats(stats: Stats): void
	// @ts-ignore
	var _multiaddr: multiaddr
	var _Canvas: Canvas
}

const numTopics = process.env.NUM_TOPICS ? parseInt(process.env.NUM_TOPICS) : 10
const cycleUp = process.env.UP ? parseInt(process.env.UP) : 120
const cycleDown = process.env.DOWN ? parseInt(process.env.DOWN) : 60

// loadTest is stringified and executed inside puppeteer, so all shadowed variables
const loadTest = async () => {
	const { topic, numTopics, cycleUp, cycleDown } = await getConfig()
	const apiRoot = "http://localhost:3000"

	let peers: string[] = []
	let lastMessages: number = 0

	try {
		const app = (await (_Canvas as any).initialize({
			topic,
			contract: {
				models: {},
				actions: {
					createMessage: () => {},
				},
			},
			start: false,
			bootstrapList: [],
		})) as Canvas

		app.libp2p.addEventListener("connection:open", ({ detail: connection }) => {
			peers = Array.from(new Set([...peers, connection.remotePeer.toString()]))
		})

		app.libp2p.addEventListener("connection:close", ({ detail: connection }) => {
			peers = peers.filter((peer: string) => peer !== connection.remotePeer.toString())
		})

		const connect = async (app: Canvas) => {
			try {
				const res = await fetch(`${apiRoot}/topic/${topic}`)
				const { addrs }: { addrs: string[] } = await res.json()
				await app.libp2p.dial(addrs.map((addr) => _multiaddr(addr)))
			} catch (err) {
				console.error(err)
			}
		}

		Promise.resolve(app.libp2p.start())
			.then(() => {
				connect(app)

				const interval = setInterval(() => {
					const peers = app.libp2p.getPeers()
					if (peers.length === 0) {
						connect(app)
					}
				}, 5000)

				app.libp2p.addEventListener("stop", () => clearInterval(interval), { once: true })
			})
			.catch((err) => {
				log(err.stack)
			})

		let j = 0
		setInterval(async () => {
			// send messages if online
			if (peers.length > 0) {
				await app.actions.createMessage({ content: (j++).toString() })
			}

			// pass stats up through puppeteer
			const messages = await app.messageLog.db.count("$messages")
			const [clock] = await app.messageLog.getClock()
			updateStats({
				peerCount: peers.length,
				messageCount: messages,
				lastMessageCount: lastMessages,
				clock,
			})
			lastMessages = messages
		}, 1000)
	} catch (err: any) {
		log(err.stack)
	}
}

const setupPage = async (page: puppeteer.Page, bundle: string, topic: string, updateStats: (room: Room) => void) => {
	await page.setRequestInterception(true)

	page.on("request", async (request) => {
		try {
			if (request.method() === "GET") {
				const response = await fetch(request.url()).catch(() => {})
				if (!response) return
				const body = await response.arrayBuffer()
				const bodyString = new TextDecoder().decode(body)
				request.respond({
					status: response.status,
					contentType: response.headers.get("Content-Type") ?? "text/html",
					body: bodyString,
				})
			} else {
				throw new Error("unhandled request method")
			}
		} catch (err) {
			request.abort()
			console.log("fetch failed")
		}
	})

	page.on("console", (msg) => {
		console.log(
			`[${topic} ${msg.type()}] ${msg.text()}`,
			// ...msg.args().map((arg) => arg.toString()),
		)
		if (msg.type() === "error") {
			console.error(`[${topic} error]`, ...msg.args().map((arg) => arg.jsonValue()))
		}
	})

	try {
		await page.goto("http://localhost:3000")
	} catch (err) {
		console.log("Could not reach server")
		throw err
	}

	await page.exposeFunction("getConfig", () => {
		return { numTopics, cycleUp, cycleDown, topic }
	})

	await page.exposeFunction("updateStats", (stats: Room) => {
		updateStats(stats)
	})

	await page.exposeFunction("log", (...args: any[]) => console.log(...args))

	if (process.env.CLIENT_DEBUG && typeof process.env.CLIENT_DEBUG === "string") {
		await page.evaluate(`localStorage.setItem("debug", ${JSON.stringify(process.env.CLIENT_DEBUG)})`)
	}

	await page.evaluate(bundle)

	return async () => {
		await page.evaluate(loadTest)
	}
}

const runner = async () => {
	console.log(`starting load test with ${numTopics} clients`)
	console.log(`cycling up ${cycleUp} sec, down ${cycleDown} sec`)

	const bundle = fs.readFileSync("./dist/bundle.js", { encoding: "utf8" })
	const browser = await puppeteer.launch({
		dumpio: true,
		userDataDir: `data/${crypto.pseudoRandomBytes(8).toString("hex")}`,
		headless: true,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-extensions",
			"--enable-chrome-browser-cloud-management",
		],
	})

	const roomIds = Array.from(Array(numTopics).keys())
	const roomTopics = roomIds.map((i) => `room-${i}.canvas.xyz`)
	const rooms: Room[] = await Promise.all(
		roomTopics.map(async (topic) => {
			const page = await browser.newPage()
			const room = { start: () => {}, topic, messageCount: 0, lastMessageCount: 0, clock: 0, peerCount: 0 }
			room.start = await setupPage(page, bundle, topic, (stats: Stats) => {
				room.messageCount = stats.messageCount
				room.lastMessageCount = stats.lastMessageCount
				room.clock = stats.clock
				room.peerCount = stats.peerCount
			})
			return room
		}),
	)

	rooms.map((room) => room.start())

	let elapsed = 0
	setInterval(async () => {
		console.log(`${elapsed++} seconds elapsed`)

		for (const room of rooms) {
			const online = room.peerCount > 0 ? "🟢" : "🔴"
			const { messageCount, lastMessageCount, clock, topic } = room
			console.log(
				`${online} ${topic}: ${messageCount} messages, ${messageCount - lastMessageCount} msgs/sec [${clock} clock]`,
			)
		}
	}, 1000)
}

runner()

process.on("SIGINT", async () => {
	console.log("\nReceived SIGINT. Attempting to shut down gracefully.")
	process.exit(0)
})
