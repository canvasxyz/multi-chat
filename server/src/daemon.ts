import assert from "node:assert"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import dns from "node:dns/promises"

import { StatusCodes } from "http-status-codes"
import express from "express"
import cors from "cors"
import stoppable from "stoppable"

import PQueue from "p-queue"
import client from "prom-client"

import { Canvas, Contract } from "@canvas-js/core"
import { createAPI } from "@canvas-js/core/api"

const { FLY_APP_NAME, START_PORT = "9000", END_PORT = "9999", CANVAS_HOME = "./data" } = process.env
const [startPort, endPort] = [parseInt(START_PORT), parseInt(END_PORT)]

console.log("[multi-chat-server] using data root", path.resolve(CANVAS_HOME))
if (!fs.existsSync(path.resolve(CANVAS_HOME))) {
	fs.mkdirSync(path.resolve(CANVAS_HOME))
}

export class Daemon {
	private sleepTimer: ReturnType<typeof setInterval>
	private sleepTimeout: number

	public readonly api = express()
	public readonly server: http.Server & stoppable.WithStop
	public readonly portMap = new Map<number, string>()
	public readonly apps = new Map<
		string,
		{
			port: number
			app: Canvas
			api: express.Express
			lastActive: number
			lastActiveTimer: ReturnType<typeof setInterval>
		}
	>()

	public bannedTopics: string[]

	public readonly queue: PQueue = new PQueue({ concurrency: 1 })

	public privateAddress: string | undefined

	#lastAllocatedPort = NaN

	public constructor(
		private readonly port: number,
		contract: Contract,
		config: {
			sleepTimeout: number
			bannedTopics?: string[]
		},
	) {
		this.api.use(express.json())
		this.api.use(express.text())
		this.api.use(cors())

		this.api.get("/topic/:topic", (req, res) => {
			const { app } = this.apps.get(req.params.topic) ?? {}
			if (app === undefined) {
				this.start(req.params.topic, contract).then(
					(app) => {
						// const controller = new DelayableController(30 * minute)
						res.json({ topic: app.topic, addrs: app.libp2p.getMultiaddrs().map((addr) => addr.toString()) })
					},
					(err) => res.status(StatusCodes.INTERNAL_SERVER_ERROR).end(`${err}`),
				)
			} else {
				res.json({ topic: app.topic, addrs: app.libp2p.getMultiaddrs().map((addr) => addr.toString()) })
			}
		})

		this.api.use("/api/:topic", (req, res, next) => {
			this.queue.add(() => {
				const app = this.apps.get(req.params.topic)
				if (app === undefined) {
					return void res.status(StatusCodes.NOT_FOUND).end()
				}

				return void app.api(req, res, next)
			})
		})

		this.api.get("/metrics", async (req, res) => {
			try {
				const result = await client.register.metrics()
				res.header("Content-Type", client.register.contentType)
				return void res.end(result)
			} catch (err) {
				if (err instanceof Error) {
					return void res.status(StatusCodes.INTERNAL_SERVER_ERROR).end(err.message)
				} else {
					return void res.status(StatusCodes.INTERNAL_SERVER_ERROR).end()
				}
			}
		})

		this.server = stoppable(http.createServer(this.api))

		this.server.listen(this.port, () => {
			console.log(`[multi-chat-server] listening on http://127.0.0.1:${this.port}/`)
			console.log(`[multi-chat-server] to start an app: http://127.0.0.1:${this.port}/topic/hello-world`)
			console.log(`[multi-chat-server] apps will sleep after ${this.sleepTimeout / 1000} seconds of inactivity`)
		})

		if (FLY_APP_NAME !== undefined) {
			dns.resolve6(`${FLY_APP_NAME}.internal`).then(
				(records) => void (this.privateAddress = records[0]),
				(err) => console.error(err),
			)
		}

		this.sleepTimer = setInterval(() => {
			this.checkSleepTimeouts()
		}, 1000)
		this.sleepTimeout = config.sleepTimeout

		this.bannedTopics = config.bannedTopics ?? []
	}

	public async start(topic: string, contract: Contract): Promise<Canvas> {
		const app = await this.queue.add(async () => {
			if (this.apps.has(topic)) {
				const { app } = this.apps.get(topic)!
				return app
			}

			if (this.bannedTopics.includes(topic)) {
				console.log(`[multi-chat-server] failed to start banned ${topic}`)
				throw new Error("banned topic")
			}

			const port = this.allocatePort()

			const directory = path.resolve(CANVAS_HOME, topic)
			if (!fs.existsSync(directory)) {
				fs.mkdirSync(directory)
			}

			const app = await Canvas.initialize({
				start: true,
				topic: topic,
				contract,
				path: directory,
				listen: this.getListenAddrs(port),
				announce: this.getAnnounceAddrs(port),
			})
			let peers: string[] = []

			console.log(`[multi-chat-server] started ${topic}`)

			const api = createAPI(app, { exposeMessages: true })

			app.libp2p.addEventListener("connection:open", ({ detail: connection }) => {
				peers = Array.from(new Set([...peers, connection.remotePeer.toString()]))
			})

			app.libp2p.addEventListener("connection:close", ({ detail: connection }) => {
				peers = peers.filter((peer: string) => peer !== connection.remotePeer.toString())
			})

			const status = {
				port,
				app,
				api,
				lastActive: new Date().getTime(),
				lastActiveTimer: setInterval(() => {
					if (peers.length > 0) {
						status.lastActive = new Date().getTime()
					}
				}, 1000),
			}
			this.apps.set(topic, status)
			this.portMap.set(port, topic)
			return app
		})

		return app!
	}

	public async stop(topic: string): Promise<void> {
		await this.queue.add(async () => {
			const app = this.apps.get(topic)
			assert(app !== undefined, "app not found")

			await app.app.stop()
			clearInterval(app.lastActiveTimer)

			this.apps.delete(topic)
			this.portMap.delete(app.port)
			console.log(`[multi-chat-server] Stopped ${topic}`)
		})
	}

	public async ban(topic: string) {
		if (this.bannedTopics.includes(topic)) return
		this.bannedTopics.push(topic)
		await this.stop(topic)
	}

	public async close() {
		console.log("[multi-chat-server] Waiting for queue to clear")
		await this.queue.onIdle()
		console.log("[multi-chat-server] Stopping running apps")
		clearInterval(this.sleepTimer)
		await Promise.all([...this.apps.values()].map(({ app: core }) => core.stop()))
		console.log("[multi-chat-server] Stopping Daemon API server")
		await new Promise<void>((resolve, reject) => this.server.stop((err) => (err ? reject(err) : resolve())))
	}

	private allocatePort(): number {
		let port: number | undefined = undefined

		port = this.#lastAllocatedPort || startPort
		let loop = false
		while (this.portMap.has(port)) {
			port += 1
			if (port > endPort) {
				if (loop) {
					throw new Error("could not assign port")
				} else {
					loop = true
					port = startPort
				}
			}
		}

		this.#lastAllocatedPort = port
		return port
	}

	getListenAddrs(port: number): string[] {
		const listen: string[] = []

		if (FLY_APP_NAME === undefined) {
			listen.push(`/ip4/127.0.0.1/tcp/${port}/ws`)
		} else {
			listen.push(`/ip6/::/tcp/${port}/ws`)
		}

		return listen
	}

	getAnnounceAddrs(port: number): string[] {
		const announce: string[] = []

		if (FLY_APP_NAME === undefined) {
			announce.push(`/ip4/127.0.0.1/tcp/${port}/ws`)
		} else {
			announce.push(`/dns4/${FLY_APP_NAME}.fly.dev/tcp/${port}/wss`)
			if (this.privateAddress !== undefined) {
				announce.push(`/ip6/${this.privateAddress}/tcp/${port}/ws`)
			}
		}

		return announce
	}

	private checkSleepTimeouts() {
		if (!this.sleepTimeout) {
			return
		}
		this.apps.forEach(({ app, lastActive }) => {
			const currentTime = new Date().getTime()
			console.log(currentTime, lastActive, this.sleepTimeout)
			if (currentTime - lastActive > this.sleepTimeout) {
				console.log(`[multi-chat-server] Stopping ${app.topic} due to inactivity`)
				this.stop(app.topic)
			}
		})
	}
}
