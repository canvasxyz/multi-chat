import fs from "node:fs"
import puppeteer from "puppeteer"

import { Canvas } from "@canvas-js/core"

declare global {
	function log(...args: any[]): void
	function getConfig(): { numTopics: number; cycleUp: number; cycleDown: number }
	// @ts-ignore
	var _multiaddr: multiaddr
	var _Canvas: Canvas
}

const numTopics = process.env.NUM_TOPICS ? parseInt(process.env.NUM_TOPICS) : 10
const cycleUp = process.env.UP ? parseInt(process.env.UP) : 120
const cycleDown = process.env.DOWN ? parseInt(process.env.DOWN) : 60

const loadTest = async () => {
	const { numTopics, cycleUp, cycleDown } = await getConfig()
	const apiRoot = "http://localhost:3000"

	let sending = true

	/*
	 * Set up `apps` and `peers`, and initialize `numTopics` apps
	 * (always one app for each topic) and connect them to the server
	 */
	const peers: Record<string, string[]> = {}
	const apps: Record<string, Canvas> = {}

	for (let i = 0; i < numTopics; i++) {
		try {
			const topic = `room-${i}.canvas.xyz`
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
			apps[i] = app

			app.libp2p.addEventListener("connection:open", ({ detail: connection }) => {
				peers[i] = peers[i] || []
				peers[i] = Array.from(new Set([...peers[i], connection.remotePeer.toString()]))
			})

			app.libp2p.addEventListener("connection:close", ({ detail: connection }) => {
				peers[i] = peers[i] || []
				peers[i] = peers[i].filter((peer: string) => peer !== connection.remotePeer.toString())
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

			apps[i] = app

			let j = 0
			setInterval(async () => {
				if (sending) {
					await app.actions.createMessage({ content: (j++).toString() })
				}
			}, 1000)
		} catch (err: any) {
			log(err.stack)
		}
	}

	let elapsed = 0
	setInterval(async () => {
		log(`${elapsed++} seconds elapsed`)

		for (let i = 0; i < numTopics; i++) {
			const online = peers[i].length > 0 ? "🟢" : "🔴"
			const topic = `room-${i}.canvas.xyz`
			const msgs = await apps[i].messageLog.db.count("$messages")
			const [clock] = await apps[i].messageLog.getClock()
			log(`${online} ${topic}: ${msgs} messages, ${clock} clock`)
		}
		log(`active: ${sending}`)

		if (elapsed % (cycleUp + cycleDown) <= cycleUp) {
			sending = true
		} else {
			sending = false
		}
	}, 1000)
}

const runner = async () => {
	console.log(`starting load test with ${numTopics} clients`)
	console.log(`cycling up ${cycleUp} sec, down ${cycleDown} sec`)

	const bundle = fs.readFileSync("./lib/bundle-compiled.js", { encoding: "utf8" })
	const browser = await puppeteer.launch({
		dumpio: true,
		headless: true,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-extensions",
			"--enable-chrome-browser-cloud-management",
		],
	})
	const page = await browser.newPage()

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
		console.log(`[${msg.type()}] ${msg.text()}`)
	})

	await page.goto("http://localhost:3000")

	await page.exposeFunction("getConfig", () => {
		return { numTopics, cycleUp, cycleDown }
	})

	await page.exposeFunction("log", (...args: any[]) => console.log(...args))

	// await page.evaluate('localStorage.setItem("debug", "canvas:*")')

	await page.evaluate(bundle)
	await page.evaluate(loadTest)
}

runner()

process.on("SIGINT", async () => {
	console.log("\nReceived SIGINT. Attempting to shut down gracefully.")
	process.exit(0)
})
