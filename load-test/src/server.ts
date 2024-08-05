import fs from "node:fs"
import puppeteer from "puppeteer"

import { Canvas } from "@canvas-js/core"

declare global {
	function log(...args: any[]): void
	function getClients(): { clients: number }
	var _Canvas: Canvas
	// @ts-ignore
	var _multiaddr: multiaddr
}

const clients = process.env.CLIENTS ? parseInt(process.env.CLIENTS) : 10
const runLoadTest = async () => {
	console.log(`starting load test with ${clients} clients`)

	const clientJs = fs.readFileSync("./lib/bundle-compiled.js", { encoding: "utf8" })
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
		if (request.method() === "GET") {
			const response = await fetch(request.url())
			const body = await response.arrayBuffer()
			const bodyString = new TextDecoder().decode(body)
			request.respond({
				status: response.status,
				contentType: response.headers.get("Content-Type") ?? "text/html",
				body: bodyString,
			})
		} else {
			request.abort()
			throw new Error("unhandled request method")
		}
	})

	console.log("setting up browser context...")
	await page.goto("http://localhost:3000")

	await page.exposeFunction("getClients", () => {
		return { clients }
	})

	await page.exposeFunction("log", (...args: any[]) => console.log(...args))

	await page.evaluate(clientJs)

	await page.evaluate(async () => {
		const peers: Record<string, string[]> = {}
		const apps: Record<string, Canvas> = {}
		const apiRoot = "http://localhost:3000"

		const { clients: N } = await getClients()

		for (let i = 0; i < N; i++) {
			try {
				const topic = `room-${i % 30}.canvas.xyz`
				const app = (await (_Canvas as any).initialize({
					contract: {
						topic,
						models: {},
						actions: {
							createMessage: () => {},
						},
					},
					start: false,
					bootstrapList: [],
				})) as Canvas

				app.libp2p.addEventListener("connection:open", ({ detail: connection }) => {
					peers[topic] = peers[topic] || []
					peers[topic] = Array.from(new Set([...peers[topic], connection.remotePeer.toString()]))
				})

				app.libp2p.addEventListener("connection:close", ({ detail: connection }) => {
					peers[topic] = peers[topic] || []
					peers[topic] = peers[topic].filter((peer: string) => peer !== connection.remotePeer.toString())
				})

				Promise.resolve(app.libp2p.start())
					.then(
						() =>
							fetch(`${apiRoot}/topic/${topic}`)
								.then((res) => res.json())
								.then(({ addrs }: { addrs: string[] }) => app.libp2p.dial(addrs.map((addr) => _multiaddr(addr))))
								.then(() => log("app started: " + topic)),
						(err) => log(err.stack),
					)
					.catch((err) => {
						log("error starting libp2p")
						log(err.message)
						log(err.stack)
					})

				apps[i.toString()] = app

				let j = 0
				setInterval(async () => {
					log(peers[topic], await app.messageLog.getClock())
					app.actions.createMessage({ content: j++ })
				}, 1000)
			} catch (err: any) {
				log("err", err.stack)
			}
		}

		let tick = 0
		setInterval(() => {
			log(tick++, "seconds elapsed")
			for (let i = 0; i < N; i++) {
				const connections = peers[i.toString()].length
				log(i, connections > 0 ? "🟢" : "🔴")
			}
		}, 1000)
	})
}

runLoadTest()

process.on("SIGINT", async () => {
	console.log("\nReceived SIGINT. Attempting to shut down gracefully.")
	process.exit(0)
})
